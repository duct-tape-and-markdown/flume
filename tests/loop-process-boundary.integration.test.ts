/**
 * §2 acceptance bullet 1 — the process-boundary chain-reload guarantee.
 *
 * This is deliberately NOT a `Dispatcher` unit test with an injected loader:
 * a fake/closure loader cannot exercise the real guarantee (Node's ESM module
 * registry is keyed by resolved URL and non-evictable, so the only thing that
 * re-evaluates a rewritten `.flume/chain.ts` is a fresh OS process). It spawns
 * two *real* `flume tick` subprocesses against a real on-disk chain.ts mutated
 * between them and asserts the second process is governed by the new chain.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Baton } from "../src/Baton.ts";

const exec = promisify(execFile);

// Run the source CLI through the project's own `tsx` shim (no build step in
// this repo). The shim is an absolute path so cwd can be the temp repo; tsx
// resolves cli.ts's own imports relative to cli.ts, independent of cwd.
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

/**
 * A chain.ts that declares one singleton phase `<name>` and exports a no-op
 * `agent`, so a real `flume tick` never invokes Claude. The test rewrites
 * `<name>` between the two subprocess invocations.
 */
function chainSrc(phaseName: string): string {
  return (
    `export default {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "boundary probe",\n` +
    `    promptPath: "prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `};\n` +
    `export const agent = {\n` +
    `  name: "noop",\n` +
    `  async invoke() { return { exitCode: 0, stdout: "", stderr: "" }; },\n` +
    `};\n`
  );
}

/**
 * A chain.ts whose singleton phase `<name>` exports an `agent` that records the
 * `FLUME_DIR`/`FLUME_CONFIG_DIR` it observes *inside the child tick process* to
 * `<FLUME_DIR>/observed-env.json`. The supervisor (`flume loop`) spawns this
 * tick with no `env:` override, so the values written here are whatever the
 * child inherited across the process boundary — the §11/§14 inheritance claim
 * made observable end-to-end.
 */
function envProbeChainSrc(phaseName: string): string {
  return (
    `import { writeFileSync } from "node:fs";\n` +
    `import { join } from "node:path";\n` +
    `export default {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "env probe",\n` +
    `    promptPath: "prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `};\n` +
    `export const agent = {\n` +
    `  name: "env-probe",\n` +
    `  async invoke() {\n` +
    `    writeFileSync(\n` +
    `      join(process.env.FLUME_DIR ?? "", "observed-env.json"),\n` +
    `      JSON.stringify({\n` +
    `        FLUME_DIR: process.env.FLUME_DIR,\n` +
    `        FLUME_CONFIG_DIR: process.env.FLUME_CONFIG_DIR,\n` +
    `      }),\n` +
    `    );\n` +
    `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
    `  },\n` +
    `};\n`
  );
}

interface Repo {
  dir: string;
  cleanup: () => Promise<void>;
}

async function makeRepo(): Promise<Repo> {
  const dir = await mkdtemp(join(tmpdir(), "flume-loop-boundary-"));
  const opts = { cwd: dir };
  await exec("git", ["init", "-q"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  // Byte-exact checkout on Windows: revert-path assertions compare file
  // content, and a host-level autocrlf=true would rewrite LF on reset.
  await exec("git", ["config", "core.autocrlf", "false"], opts);
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  await mkdir(join(dir, ".flume"), { recursive: true });
  await writeFile(join(dir, ".flume", "prompt.md"), "probe prompt\n", "utf8");
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Spawn one real `flume tick`; collect combined stdout+stderr and exit code. */
async function runTick(cwd: string): Promise<{ out: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(TSX, [CLI, "tick"], { cwd });
    return { out: stdout + stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.code ?? 1 };
  }
}

/**
 * Spawn one real `flume loop --max 1` with an explicit `env`; collect combined
 * output and exit code. The supervisor process inside this invocation spawns
 * the child `flume tick` itself (`defaultTickRunner`, no `env:` override), so
 * the boundary under test is real, not stubbed.
 */
async function runLoop(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ out: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(TSX, [CLI, "loop", "--max", "1"], {
      cwd,
      env,
    });
    return { out: stdout + stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.code ?? 1 };
  }
}

let repo: Repo;

beforeEach(async () => {
  repo = await makeRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

describe("§2 process-boundary chain reload — real `flume tick` ×2", () => {
  it(
    "a chain.ts rewritten on disk between two real tick processes governs the second",
    async () => {
      const chainPath = join(repo.dir, ".flume", "chain.ts");

      // v1 declares only phase "alpha". The baton wakes "beta" — a phase v1
      // does not have — so tick #1 finds no matching phase and hibernates
      // without scheduling anything. The unknown-phase path does not touch
      // the baton, so the "beta" flag persists for tick #2.
      await writeFile(chainPath, chainSrc("alpha"), "utf8");
      new Baton(join(repo.dir, ".flume")).wake("beta");

      const t1 = await runTick(repo.dir);
      expect(t1.code).toBe(0);
      expect(t1.out).not.toMatch(/tick → beta/);
      expect(t1.out).toMatch(/unknown phases: beta/);

      // Rewrite chain.ts on disk: v2 renames the phase to "beta". A fresh
      // `flume tick` *process* is the only thing that can pick this up —
      // Node's ESM registry is non-evictable in-process.
      await writeFile(chainPath, chainSrc("beta"), "utf8");

      const t2 = await runTick(repo.dir);
      // The SECOND process resolved the rewritten on-disk chain and
      // scheduled "beta", a phase v1 never had. This is the §2 guarantee
      // that an injected/fake loader cannot exercise.
      expect(t2.code).toBe(0);
      expect(t2.out).toMatch(/tick → beta \(singleton\)/);
      expect(t2.out).not.toMatch(/unknown phases/);
    },
    30_000,
  );
});

describe("§14 process-boundary env inheritance — supervisor → child tick", () => {
  it(
    "a child `flume tick` spawned by `flume loop` observes the supervisor's canonical FLUME_DIR/FLUME_CONFIG_DIR",
    async () => {
      // Relocate state and config OUTSIDE `<repoRoot>/.flume` (the default), in
      // separate dirs (the attach-work-detach posture, §10/§13). If the child
      // did NOT inherit the supervisor's env it would fall back to the default
      // and never see these paths — so observing them end-to-end *is* the
      // inheritance proof, distinct from a child re-deriving the default.
      const stateDir = await mkdtemp(join(tmpdir(), "flume-state-"));
      const configDir = await mkdtemp(join(tmpdir(), "flume-config-"));

      // chain.ts + prompt live under configDir; the agent it exports writes the
      // env it observes to `<FLUME_DIR>/observed-env.json` inside the child.
      await writeFile(join(configDir, "chain.ts"), envProbeChainSrc("probe"), "utf8");
      await writeFile(join(configDir, "prompt.md"), "probe prompt\n", "utf8");

      // Wake the phase in the relocated state dir — the supervisor reads the
      // baton from FLUME_DIR, so the awake flag must live there, not under
      // `<repoRoot>/.flume`.
      new Baton(stateDir).wake("probe");

      const env = {
        ...process.env,
        FLUME_DIR: stateDir,
        FLUME_CONFIG_DIR: configDir,
      };
      const loop = await runLoop(repo.dir, env);
      expect(loop.code).toBe(0);
      expect(loop.out).toMatch(/tick → probe \(singleton\)/);

      // The child wrote this file under FLUME_DIR — its mere presence there
      // proves the child resolved FLUME_DIR to the relocated state dir.
      const observed = JSON.parse(
        await readFile(join(stateDir, "observed-env.json"), "utf8"),
      ) as { FLUME_DIR: string; FLUME_CONFIG_DIR: string };

      // The child saw the supervisor's canonical roots — absolute, and exactly
      // the relocated dirs — confirming loop → tick env inheritance end-to-end.
      expect(observed.FLUME_DIR).toBe(stateDir);
      expect(observed.FLUME_CONFIG_DIR).toBe(configDir);
      expect(isAbsolute(observed.FLUME_DIR)).toBe(true);
      expect(isAbsolute(observed.FLUME_CONFIG_DIR)).toBe(true);

      await rm(stateDir, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    },
    30_000,
  );
});
