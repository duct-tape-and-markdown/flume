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

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Baton } from "../src/Baton.ts";
import { EX_MOUNT_DEAD, EX_TERMINAL_MISCONFIG } from "../src/Dispatcher.ts";
import { CLI, TSX_CLI, gitOut, hermeticEnv } from "./helpers/subprocess.ts";

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

/**
 * A chain.ts whose singleton phase `<name>` hands off to itself — so, absent
 * a stop, the baton stays awake and a fresh child tick would run again next
 * iteration — and whose `agent` writes `<FLUME_DIR>/stop` from *inside* the
 * child tick process, before returning cleanly with no commit. This
 * simulates a stop flag appearing while a tick is in flight: the write lands
 * on disk mid-child, but nothing rechecks it until the supervisor's own
 * post-child boundary (`spec/loop.md`, "Graceful stop — the stop flag" —
 * "Checked between children only").
 */
function midRunStopChainSrc(phaseName: string): string {
  return (
    `import { writeFileSync } from "node:fs";\n` +
    `import { join } from "node:path";\n` +
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "mid-run stop probe",\n` +
    `    promptPath: "prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [${JSON.stringify(phaseName)}],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `},\n` +
    `agent: {\n` +
    `  name: "mid-run-stop",\n` +
    `  async invoke() {\n` +
    `    writeFileSync(join(process.env.FLUME_DIR ?? "", "stop"), "");\n` +
    `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
    `  },\n` +
    `} });\n`
  );
}

/**
 * A chain.ts whose singleton phase `<name>` exports an `agent` that sleeps
 * briefly, then records the `FLUME_TIP_CLAIM_HELD` it observed *inside the
 * child tick process* to `<FLUME_DIR>/observed-tip-claim.json`. The sleep
 * gives the test a window to read the tip-claim file directly, off disk,
 * while the child is still mid-tick — spec/loop.md "The loop lock and the
 * tip claim": a loop-spawned child trusts the supervisor's claim via this
 * env var rather than acquiring (and colliding on) its own.
 */
function tipClaimProbeChainSrc(phaseName: string): string {
  return (
    `import { writeFileSync } from "node:fs";\n` +
    `import { join } from "node:path";\n` +
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "tip claim probe",\n` +
    `    promptPath: "prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `},\n` +
    `agent: {\n` +
    `  name: "tip-claim-probe",\n` +
    `  async invoke() {\n` +
    `    await new Promise((r) => setTimeout(r, 1500));\n` +
    `    writeFileSync(\n` +
    `      join(process.env.FLUME_DIR ?? "", "observed-tip-claim.json"),\n` +
    `      JSON.stringify({\n` +
    `        FLUME_TIP_CLAIM_HELD: process.env.FLUME_TIP_CLAIM_HELD ?? null,\n` +
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

describe("Graceful stop — real `flume loop` over a stop flag written mid-run (spec/loop.md \"Graceful stop — the stop flag\")", () => {
  it(
    "the in-flight tick finishes uninterrupted, the run ends after it rather than continuing to --max, and the lock/claim are released",
    async () => {
      await writeFile(
        join(repo.dir, ".flume", "chain.ts"),
        midRunStopChainSrc("alpha"),
        "utf8",
      );
      const flumeDir = join(repo.dir, ".flume");
      const baton = new Baton(flumeDir);
      baton.wake("alpha");

      // The phase hands off to itself every tick, so absent the stop flag
      // the loop would run all 5 iterations. The agent writes the flag from
      // inside the first child tick, before that tick returns.
      const loop = await runLoop(repo.dir, hermeticEnv(), 5);

      expect(loop.code).toBe(0);
      // Exactly one child tick ran — the in-flight one that wrote the flag —
      // never a second, which --max 5 would otherwise have allowed.
      expect(loop.out.match(/tick → alpha \(singleton\)/g)).toHaveLength(1);
      expect(loop.out).not.toMatch(/reached --max/);
      expect(loop.out).not.toMatch(/hibernating after/);
      // The completion summary names the stop flag as why iteration ended.
      expect(loop.out).toMatch(/stop flag/);

      // The flag stays on disk untouched — there is no unstop verb; removing
      // it is the operator's own acknowledgement.
      expect(existsSync(join(flumeDir, "stop"))).toBe(true);
      // The run ended by the stop flag, not by hibernation: the self-loop
      // handoff re-woke "alpha" before the tick's process exited.
      expect(baton.isAwake("alpha")).toBe(true);

      // The loop lock and tip claim were released on the normal exit path —
      // proven by a fresh loop (after the operator acks by removing the
      // flag) not being refused by a leftover lock or claim.
      expect(existsSync(join(flumeDir, "loop.pid"))).toBe(false);
      await rm(join(flumeDir, "stop"));
      const second = await runLoop(repo.dir, hermeticEnv(), 1);
      expect(second.code).toBe(0);
      expect(second.out).not.toContain("refusing");
      expect(second.out).not.toContain("already runs");
      expect(second.out).not.toContain("claimed by pid");
    },
    30_000,
  );
});

describe(
  'spec/loop.md "The loop lock and the tip claim" — a loop-spawned child trusts the supervisor\'s claim',
  () => {
    it(
      "a loop child's FLUME_TIP_CLAIM_HELD names exactly the pid holding the tip-claim file — it never attempts its own acquire",
      async () => {
        await writeFile(
          join(repo.dir, ".flume", "chain.ts"),
          tipClaimProbeChainSrc("probe"),
          "utf8",
        );
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const branch = await gitOut(repo.dir, ["symbolic-ref", "--short", "HEAD"]);
        const commonDir = resolve(
          repo.dir,
          await gitOut(repo.dir, ["rev-parse", "--git-common-dir"]),
        );
        const claimPath = join(
          commonDir,
          "flume",
          "tip-claims",
          "refs",
          "heads",
          branch,
        );

        const child = spawn(
          process.execPath,
          [TSX_CLI, CLI, "loop", "--max", "1"],
          { cwd: repo.dir, env: hermeticEnv() },
        );
        let out = "";
        child.stdout?.on("data", (d: Buffer) => (out += d));
        child.stderr?.on("data", (d: Buffer) => (out += d));

        // Long enough for the supervisor to acquire the tip claim, spawn its
        // child tick, and land that child mid-sleep inside the probe agent's
        // `invoke()` — well inside the window the claim file exists.
        await new Promise((r) => setTimeout(r, 800));

        expect(existsSync(claimPath)).toBe(true);
        const recordedPid = await readFile(claimPath, "utf8");

        const exitCode = await new Promise<number | null>((resolveExit) => {
          child.on("exit", (code) => resolveExit(code));
        });
        expect(exitCode).toBe(0);
        expect(out).toMatch(/tick → probe \(singleton\)/);

        const observed = JSON.parse(
          await readFile(
            join(repo.dir, ".flume", "observed-tip-claim.json"),
            "utf8",
          ),
        ) as { FLUME_TIP_CLAIM_HELD: string | null };

        // The child trusted the supervisor's claim instead of acquiring its
        // own: its FLUME_TIP_CLAIM_HELD names exactly the pid that was
        // holding the (single) claim file while it read it. Had the child
        // instead called `acquireTipClaim` itself, that call would have hit
        // the same claim file (EEXIST), probed the still-live supervisor,
        // and refused the tick outright — `observed-tip-claim.json` would
        // never have been written and this run would have exited non-zero.
        expect(observed.FLUME_TIP_CLAIM_HELD).toBe(recordedPid);
      },
      30_000,
    );
  },
);
