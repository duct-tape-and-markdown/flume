#!/usr/bin/env node
/**
 * scripts/smoke-install.mjs — pack -> install -> generated shim -> chain load.
 *
 * Exercises the *installed* package through npm's *generated* bin shims
 * (`node_modules/.bin/flume.cmd` on win32, `node_modules/.bin/flume`
 * elsewhere) — the exact surface that shipped broken in 0.6.0
 * (spec/RELEASE-v0.6.1.md §1/§3). Nothing else ran the installed package
 * through a generated shim before this existed.
 *
 * Steps: npm pack the repo -> npm install the tarball into a scratch dir ->
 * run the shim `--version` -> scaffold a minimal chain-load fixture -> run
 * the shim `render <phase>`. Each step prints what it ran; the first
 * failing step aborts the run and is named in the error.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const IS_WIN = process.platform === "win32";

// Strip FLUME_* from the child env: this script itself may run under a
// flume tick (flume-on-flume dogfooding), which sets FLUME_DIR /
// FLUME_CONFIG_DIR pointing at *this repo's* real .flume dir. Left
// inherited, the shim under test would resolve chain state there instead
// of the scratch consumer fixture, silently invalidating the smoke test.
const CHILD_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("FLUME_")),
);

class SmokeStepError extends Error {}

/**
 * Windows requires shell:true to invoke .cmd/.bat targets (npm itself, and
 * the generated flume.cmd shim under test) — Node no longer auto-invokes
 * cmd.exe for them. Node quotes the argv array for us when shell:true is
 * combined with an args array, so this stays injection-safe for the
 * fixed, non-user-controlled args this script passes.
 */
function run(step, cmd, args, opts = {}) {
  console.log(`[smoke-install] ${step}: ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    shell: IS_WIN,
    cwd: opts.cwd,
    env: CHILD_ENV,
    encoding: "utf8",
  });
  if (result.error) {
    throw new SmokeStepError(`${step}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new SmokeStepError(`${step}: exited ${result.status}`);
  }
  return result.stdout ?? "";
}

const CHAIN_FIXTURE = `import type { Chain, ChainFactory, Phase } from "@dtmd/flume";

const factory: ChainFactory = (api) => {
  const { shellGate } = api;

  const notes: Phase = {
    name: "notes",
    description: "install smoke test",
    promptPath: "prompts/notes.md",
    concurrency: "singleton",
    writablePaths: ["notes/**"],
    gates: [shellGate({ name: "noop", when: "afterCommit", cmd: "true", args: [] })],
    handoff: () => [],
  };

  const chain: Chain = { phases: [notes], humanOnly: [] };
  return { chain };
};

export default factory;
`;

const PROMPT_FIXTURE = "Append a dated line to notes/journal.md.\n";

let scratch;
try {
  scratch = mkdtempSync(join(tmpdir(), "flume-smoke-"));
  console.log(`[smoke-install] scratch dir: ${scratch}`);

  const packOut = run(
    "npm pack",
    "npm",
    ["pack", "--pack-destination", scratch],
    { cwd: REPO_ROOT, capture: true },
  );
  const tarballName = packOut.trim().split(/\r?\n/).pop();
  if (!tarballName) {
    throw new SmokeStepError("npm pack: no tarball name in output");
  }
  const tarballPath = join(scratch, tarballName);
  console.log(`[smoke-install] packed: ${tarballPath}`);

  const consumerDir = join(scratch, "consumer");
  mkdirSync(consumerDir, { recursive: true });

  run("npm init", "npm", ["init", "-y"], { cwd: consumerDir });
  // ESM consumer context: flume is ESM-only and chain.ts is loaded as ESM;
  // without type:module the consumer's nearest package.json marks .ts as
  // CJS and the chain load fails before touching the package under test.
  run("npm pkg set type=module", "npm", ["pkg", "set", "type=module"], {
    cwd: consumerDir,
  });
  run(
    "npm install tarball",
    "npm",
    // --no-save: without it npm records a file: pin in the consumer's
    // package.json, and the v0.7 §10 handshake (arm 2) then refuses every
    // command against the unprovisioned pin — same class as ci.yml's
    // Consumer-install smoke fix (7ee70ed). A consumer-install smoke tests
    // "works when installed", not "works when pinned".
    ["install", "--no-audit", "--no-fund", "--no-save", tarballPath],
    { cwd: consumerDir },
  );

  const shimName = IS_WIN ? "flume.cmd" : "flume";
  const shimPath = join(consumerDir, "node_modules", ".bin", shimName);

  run("generated shim --version", shimPath, ["--version"], {
    cwd: consumerDir,
  });

  console.log("[smoke-install] scaffold chain-load fixture");
  run("git init", "git", ["init"], { cwd: consumerDir });
  mkdirSync(join(consumerDir, ".flume", "prompts"), { recursive: true });
  writeFileSync(join(consumerDir, ".flume", "chain.ts"), CHAIN_FIXTURE);
  writeFileSync(
    join(consumerDir, ".flume", "prompts", "notes.md"),
    PROMPT_FIXTURE,
  );

  run("generated shim render notes", shimPath, ["render", "notes"], {
    cwd: consumerDir,
  });

  console.log(
    "[smoke-install] OK — pack, install, shim --version, and shim render notes all passed",
  );
} catch (err) {
  if (err instanceof SmokeStepError) {
    console.error(`[smoke-install] FAILED: ${err.message}`);
  } else {
    console.error("[smoke-install] FAILED with unexpected error:");
    console.error(err);
  }
  process.exitCode = 1;
} finally {
  if (scratch) {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; a held file handle shouldn't fail the run
    }
  }
}
