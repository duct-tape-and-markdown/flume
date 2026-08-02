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
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Baton } from "../src/Baton.ts";
import { EX_MOUNT_DEAD, EX_TERMINAL_MISCONFIG } from "../src/Dispatcher.ts";
import { CLI, TSX_CLI, hermeticEnv } from "./helpers/subprocess.ts";

const exec = promisify(execFile);

/**
 * A chain.ts that declares one singleton phase `<name>` and exports a no-op
 * `agent`, so a real `flume tick` never invokes Claude. The test rewrites
 * `<name>` between the two subprocess invocations.
 */
function chainSrc(phaseName: string): string {
  return (
    `export default () => ({ chain: {\n` +
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
    `},\n` +
    `agent: {\n` +
    `  name: "noop",\n` +
    `  async invoke() { return { exitCode: 0, stdout: "", stderr: "" }; },\n` +
    `} });\n`
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
    `export default () => ({ chain: {\n` +
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
    `},\n` +
    `agent: {\n` +
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
    `} });\n`
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
    const { stdout, stderr } = await exec(process.execPath, [TSX_CLI, CLI, "tick"], {
      cwd,
      env: hermeticEnv(),
    });
    return { out: stdout + stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.code ?? 1 };
  }
}

/**
 * Spawn one real `flume loop --max <max>` with an explicit `env`; collect
 * combined output and exit code. The supervisor process inside this invocation
 * spawns the child `flume tick` itself (`defaultTickRunner`, no `env:`
 * override), so the boundary under test is real, not stubbed.
 */
async function runLoop(
  cwd: string,
  env: NodeJS.ProcessEnv,
  max = 1,
): Promise<{ out: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [TSX_CLI, CLI, "loop", "--max", String(max)],
      { cwd, env },
    );
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
      // does not have — so tick #1 classifies an Axis-C terminal
      // misconfiguration (§3): exit 78, and the orphaned "beta" flag is left
      // on disk, which is exactly what lets tick #2 pick it up after the
      // chain rewrite below.
      await writeFile(chainPath, chainSrc("alpha"), "utf8");
      new Baton(join(repo.dir, ".flume")).wake("beta");

      const t1 = await runTick(repo.dir);
      expect(t1.code).toBe(EX_TERMINAL_MISCONFIG);
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

describe("§14 FLUME_JOB leak — hermeticEnv keeps a job resolution from leaking into a real tick", () => {
  it(
    "with FLUME_JOB stubbed on the vitest process, a real `flume tick` still resolves the temp repo's own .flume",
    async () => {
      // Same alpha/beta misconfiguration fixture as §2 above: chain declares
      // only "alpha", the awake flag names "beta". Read alone this always
      // exits 78 (Axis-C, unknown phase). But if `runTick`'s env leaked
      // FLUME_JOB from this vitest process, `resolveStateDirs` would treat
      // that leaked value as a job resolution (src/cli.ts's `job` var), and
      // the wrong-branch guard fires *before* dispatch ever reaches phase
      // resolution — the temp repo's HEAD is "main", never "job/<leaked>" —
      // exiting 1 instead of 78. `hermeticEnv()` stripping FLUME_JOB is what
      // keeps this test on the real, intended failure mode.
      await writeFile(join(repo.dir, ".flume", "chain.ts"), chainSrc("alpha"), "utf8");
      new Baton(join(repo.dir, ".flume")).wake("beta");

      const prior = process.env.FLUME_JOB;
      process.env.FLUME_JOB = "outer-job";
      try {
        const t = await runTick(repo.dir);
        expect(t.code).toBe(EX_TERMINAL_MISCONFIG);
        expect(t.out).toMatch(/unknown phases: beta/);
        expect(t.out).not.toMatch(/refusing tick/);
      } finally {
        if (prior === undefined) delete process.env.FLUME_JOB;
        else process.env.FLUME_JOB = prior;
      }
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
        ...hermeticEnv(),
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

describe("§3 Axis-C fail-fast — real `flume loop` over an orphaned awake flag", () => {
  it(
    "supervisor stops on the child's 78 after one tick, names the orphaned phase, leaves the flag; loop exits 78",
    async () => {
      // The chain declares only "alpha"; the awake flag names "beta". Every
      // child tick would exit 78 forever — before §3 this hot-spun to --max
      // as a parade of "clean" hibernation reports.
      await writeFile(join(repo.dir, ".flume", "chain.ts"), chainSrc("alpha"), "utf8");
      const baton = new Baton(join(repo.dir, ".flume"));
      baton.wake("beta");

      const loop = await runLoop(repo.dir, hermeticEnv(), 3);

      // Fail-fast: one child, then stop — never --max, never "hibernating".
      expect(loop.code).toBe(EX_TERMINAL_MISCONFIG);
      expect(loop.out).toMatch(/terminal misconfiguration/);
      expect(loop.out).toMatch(/beta/);
      expect(loop.out).not.toMatch(/reached --max/);
      expect(loop.out).not.toMatch(/hibernating after/);
      expect(loop.out.match(/tick exited 78/g)).toHaveLength(1);

      // The orphaned flag survives supervisor and child alike — the human
      // inspects, then `flume sleep beta` or fixes the chain.
      expect(baton.isAwake("beta")).toBe(true);
    },
    30_000,
  );
});

describe("§4 mount-dead fail-fast — real `flume loop` over an unloadable chain.ts", () => {
  it(
    "supervisor aborts on the first mount-dead tick instead of burning to --max; loop exits 69 (EX_MOUNT_DEAD)",
    async () => {
      // chain.ts throws at module-evaluation time — every child tick's
      // chainLoader would reject identically forever. Before v0.7 §4 this
      // hot-spun to --max as a parade of exit-1 "failed" ticks that never
      // surfaced non-zero to CI.
      await writeFile(
        join(repo.dir, ".flume", "chain.ts"),
        `throw new Error("simulated broken chain.ts");\n` +
          `export default () => ({ chain: { phases: [], humanOnly: [] } });\n`,
        "utf8",
      );

      const loop = await runLoop(repo.dir, hermeticEnv(), 3);

      // Fail-fast: one child, then stop — never --max.
      expect(loop.code).toBe(EX_MOUNT_DEAD);
      expect(loop.out).toMatch(/mount-dead/);
      expect(loop.out).not.toMatch(/reached --max/);
      expect(loop.out.match(/tick exited 69/g)).toHaveLength(1);
    },
    30_000,
  );
});
