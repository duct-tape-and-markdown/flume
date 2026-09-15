#!/usr/bin/env node
/**
 * scripts/smoke-install.mjs — pack -> install -> generated shim -> chain load.
 *
 * Exercises the *installed* package through npm's *generated* bin shims
 * (`node_modules/.bin/flume.cmd` on win32, `node_modules/.bin/flume`
 * elsewhere) — the exact surface that shipped broken in 0.6.0
 * (spec/cli.md § Distribution, "Install acceptance is exercised, not
 * asserted"). Nothing else ran the installed package through a generated
 * shim before this existed.
 *
 * Steps: npm pack the repo -> npm install the tarball into a scratch dir ->
 * run the shim `--version` -> resolve both `exports` subpaths from the
 * installed package -> scaffold a minimal chain-load fixture -> run the shim
 * through a verb that refuses on a chain that does not load
 * (`CHAIN_LOAD_VERB` below). Each step prints what it ran; the first failing
 * step aborts the run and is named in the error.
 *
 * The subpath step is here rather than in the suite because it is the only
 * place `@dtmd/flume/harness` is resolved by a real installer's node_modules
 * layout against the packed `files` allowlist (`spec/harness.md`, *Where it
 * lives*): in-repo, `harness/` resolves relatively whether the map names it
 * or not.
 *
 * Usage: `node scripts/smoke-install.mjs [--scratch <dir>]`. Both CI lanes
 * run this one script rather than a second spelling of it; the POSIX lane
 * passes `--scratch` because its consumer type-resolution gate typechecks
 * against the tarball and installed consumer this run leaves behind.
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

/**
 * The verb the scaffolded chain-load fixture is driven through.
 *
 * It has to **refuse** on a chain that does not load, or the step asserts
 * nothing: the claim is that the installed CLI reaches the `.flume/chain.ts`
 * this script writes at the literal path below, and a verb that proceeds
 * over a failed load answers 0 whether or not the fixture is where the CLI
 * looks for it. `status` — what this step used to run — takes the
 * best-effort observational load (`src/cliChainLoad.ts`): by contract it
 * reports the failure on stderr and leaves the exit code alone. `check`
 * refuses that same load with EX_MOUNT_DEAD, and exits 0 over an absent
 * queue, so the success path stays one step.
 *
 * Named here, and read back out of this file by tests/bin.test.ts, which
 * drives the real CLI through this verb over a directory holding no chain —
 * the refusal this step depends on, checked where the smoke itself is not
 * (`.claude/rules/engineering.md`, "A green verdict is proven non-vacuous").
 */
const CHAIN_LOAD_VERB = "check";

// Both entries of the exports map, by bare specifier, exactly as a consumer
// writes them. Values rather than types: a type-only import would erase and
// prove nothing about the emitted .js the map points at.
const SUBPATH_PROBE = `import { Dispatcher } from "@dtmd/flume";
import { vitestRunner } from "@dtmd/flume/harness";

for (const [specifier, value] of [
  ["@dtmd/flume", Dispatcher],
  ["@dtmd/flume/harness", vitestRunner],
]) {
  if (typeof value !== "function") {
    throw new Error(\`\${specifier} resolved, but its entry point exported \${typeof value}\`);
  }
}
console.log("both exports subpaths resolved from the installed package");
`;

/**
 * Where the run works, and who owns the cleanup.
 *
 * Default: a fresh `mkdtemp`, removed on the way out — a local run leaves
 * nothing behind. With `--scratch <dir>` the caller has named the directory
 * and keeps it: what this run packs and installs there is the next step's
 * input, and deleting it would delete that. The two cases differ in
 * ownership only; every step below runs identically either way.
 */
const SCRATCH_FLAG = process.argv.indexOf("--scratch");
const SUPPLIED_SCRATCH = SCRATCH_FLAG === -1 ? null : process.argv[SCRATCH_FLAG + 1];
if (SCRATCH_FLAG !== -1 && !SUPPLIED_SCRATCH) {
  console.error("[smoke-install] usage: smoke-install.mjs [--scratch <dir>]");
  process.exit(2);
}

let scratch;
try {
  if (SUPPLIED_SCRATCH) {
    scratch = resolve(SUPPLIED_SCRATCH);
    mkdirSync(scratch, { recursive: true });
  } else {
    scratch = mkdtempSync(join(tmpdir(), "flume-smoke-"));
  }
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

  writeFileSync(join(consumerDir, "subpaths.mjs"), SUBPATH_PROBE);
  run("exports subpaths", process.execPath, ["subpaths.mjs"], {
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

  run(`generated shim ${CHAIN_LOAD_VERB}`, shimPath, [CHAIN_LOAD_VERB], {
    cwd: consumerDir,
  });

  console.log(
    `[smoke-install] OK — pack, install, shim --version, exports subpaths, and shim ${CHAIN_LOAD_VERB} all passed`,
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
  if (scratch && !SUPPLIED_SCRATCH) {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; a held file handle shouldn't fail the run
    }
  } else if (scratch) {
    console.log(`[smoke-install] kept caller-supplied scratch dir: ${scratch}`);
  }
}
