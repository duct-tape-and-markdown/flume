/**
 * v0.11 §4 — the advisory per-ref tip claim reaching `flume loop`/`flume
 * tick` end-to-end through the real CLI. `tests/git.test.ts` already proves
 * `acquireTipClaim`'s own acquire/refuse/reclaim mechanics in isolation;
 * this suite proves the CLI wiring: the claim is taken alongside `loop.pid`,
 * released on the same exit/SIGINT/SIGTERM hooks, and a detached HEAD
 * refuses before either command runs a tick.
 *
 * Real subprocesses throughout (real `flume tick`/`loop` through `tsx`,
 * real `git`) — the integration lane, not the default `vitest run` gate
 * (spec/worktrees.md, "The default test lane must stay fast").
 */

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { Baton } from "../src/Baton.ts";
import { CLI, TSX_CLI, gitOut, hermeticEnv, runCli } from "./helpers/subprocess.ts";

const exec = promisify(execFile);

/**
 * Scratch git repo on a chosen branch. The engine has no opinion on branch
 * names (v0.11 §2) — some fixtures below pin `job/foo` merely as a
 * distinctive label, proven inert by running job resolution on `main`
 * instead.
 */
async function makeJobRepo(branch: string): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "flume-job-"));
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", branch], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Materialize the repo-resident config (v0.6 §2): `chain.ts` at
 * `<root>/.flume/` with its sibling `prompts/` dir — the shape every chain
 * fixture in this suite loads from, job resolution or not. `promptPath`
 * stays a plain configDir-relative join (§3: the shared-prompts case).
 */
async function writeRepoConfig(
  root: string,
  chainSrc: string,
  promptContent = "job probe prompt\n",
): Promise<string> {
  const cfg = join(root, ".flume");
  await mkdir(join(cfg, "prompts"), { recursive: true });
  await writeFile(join(cfg, "chain.ts"), chainSrc, "utf8");
  await writeFile(join(cfg, "prompts", "prompt.md"), promptContent, "utf8");
  return cfg;
}

/**
 * A minimal, otherwise-valid chain — loaded for its declared fields, never
 * ticked past the detached-HEAD/tick refusal it is used for below.
 */
function minimalChainSrc(friction?: string): string {
  return (
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: "probe",\n` +
    `    description: "",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    (friction !== undefined
      ? `  friction: ${JSON.stringify(friction)},\n`
      : ``) +
    `} });\n`
  );
}

/**
 * A chain whose singleton phase's agent sleeps before returning — used to
 * hold a real `flume loop`/`flume tick` process open long enough to land
 * mid-tick, rather than racing the process's own startup and near-instant
 * completion.
 */
function slowAgentChainSrc(phaseName: string): string {
  return (
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "sigterm probe",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `},\n` +
    `agent: {\n` +
    `  name: "slow",\n` +
    `  async invoke() {\n` +
    `    await new Promise((r) => setTimeout(r, 3000));\n` +
    `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
    `  },\n` +
    `} });\n`
  );
}

describe("flume loop/tick — tip claim wiring (v0.11 §4)", () => {
  it(
    "two loops against different state roots on one branch: the second refuses, naming the claim's holder pid",
    async () => {
      const repo = await makeJobRepo("main");
      try {
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
          "main",
        );
        await mkdir(dirname(claimPath), { recursive: true });
        // The vitest worker itself plays the live first loop's holder.
        await writeFile(claimPath, String(process.pid), "utf8");

        // A different state root (--job other) than the planted claim's
        // holder — only the tip claim can refuse this pair; loop.pid never
        // collides. Pre-existing per CLI-JOB-FLAG-REFUSES-NONEXISTENT-STATE-ROOT:
        // --job now refuses a name with no state root before reaching the
        // tip-claim contention this test exercises.
        await mkdir(join(repo.dir, ".flume", "jobs", "other"), {
          recursive: true,
        });
        const r = await runCli(repo.dir, ["--job", "other", "loop", "--max", "0"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain(`refs/heads/main claimed by pid ${process.pid}`);
        expect(r.out).toContain(claimPath);
        // Refused before ever taking its own loop.pid — nothing left behind
        // for the job's own state root.
        expect(
          existsSync(join(repo.dir, ".flume", "jobs", "other", "loop.pid")),
        ).toBe(false);
        // The live holder's claim survives the refused contender untouched.
        expect(await readFile(claimPath, "utf8")).toBe(String(process.pid));
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "two loops from two worktrees on different branches: both run (keyed per-ref, not per-checkout)",
    async () => {
      const repo = await makeJobRepo("main");
      const wtParent = await mkdtemp(join(tmpdir(), "flume-tip-claim-wt-"));
      const wtDir = join(wtParent, "wt");
      try {
        await exec("git", ["worktree", "add", "-b", "other", wtDir], {
          cwd: repo.dir,
        });

        const [main, other] = await Promise.all([
          runCli(repo.dir, ["loop", "--max", "0"]),
          runCli(wtDir, ["loop", "--max", "0"]),
        ]);

        expect(main.code).toBe(0);
        expect(main.out).toContain("reached --max 0");
        expect(other.code).toBe(0);
        expect(other.out).toContain("reached --max 0");
      } finally {
        await rm(wtParent, { recursive: true, force: true });
        await exec("git", ["worktree", "prune"], { cwd: repo.dir }).catch(
          () => {},
        );
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "claim file is gone after a clean exit",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const r = await runCli(repo.dir, ["loop", "--max", "0"]);
        expect(r.code).toBe(0);

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
          "main",
        );
        expect(existsSync(claimPath)).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "a bare flume tick with no other live claim-holder acquires and releases a claim around its single tick",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, slowAgentChainSrc("probe"));
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const child = spawn(process.execPath, [TSX_CLI, CLI, "tick"], {
          cwd: repo.dir,
          env: hermeticEnv(),
        });

        // Long enough for the bare tick to acquire its own claim and reach
        // the slow agent's sleep — mid-tick, not racing the process's own
        // startup.
        await new Promise((r) => setTimeout(r, 1500));

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
          "main",
        );
        expect(existsSync(claimPath)).toBe(true);

        const exitCode = await new Promise<number | null>((resolveExit) => {
          child.on("exit", (code) => resolveExit(code));
        });

        expect(exitCode).toBe(0);
        expect(existsSync(claimPath)).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "a bare flume tick refuses exit 1 when a live process already holds the claim",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());

        const commonDir = resolve(
          repo.dir,
          await gitOut(repo.dir, ["rev-parse", "--git-common-dir"]),
        );
        const claimDir = join(commonDir, "flume", "tip-claims", "refs", "heads");
        await mkdir(claimDir, { recursive: true });
        // The vitest worker itself plays the live holder.
        await writeFile(join(claimDir, "main"), String(process.pid), "utf8");

        const r = await runCli(repo.dir, ["tick"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain(`refs/heads/main claimed by pid ${process.pid}`);
        // A refused bare tick released nothing — it never held the claim.
        expect(await readFile(join(claimDir, "main"), "utf8")).toBe(
          String(process.pid),
        );
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "claim file (and loop.pid) are gone after SIGTERM on POSIX; on win32 (TerminateProcess, no handler runs) both survive and the claim is stale-reclaimable — the amended v0.11 §4 outcome",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, slowAgentChainSrc("probe"));
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const child = spawn(
          process.execPath,
          [TSX_CLI, CLI, "loop", "--max", "1"],
          { cwd: repo.dir, env: hermeticEnv() },
        );

        // Long enough for the loop to acquire both locks, load the chain,
        // and spawn its child tick — now mid-sleep inside `invoke()`, well
        // inside the process's lifetime rather than racing its startup.
        await new Promise((r) => setTimeout(r, 1500));

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
          "main",
        );
        const pidPath = join(repo.dir, ".flume", "loop.pid");
        expect(existsSync(claimPath)).toBe(true);
        expect(existsSync(pidPath)).toBe(true);
        // tsx re-execs itself into a second node process to run the ESM
        // loader, so the spawned `child`'s own pid is the bootstrapper's,
        // not the one that actually acquired the locks and wrote its own
        // pid into both files — read the real holder back off disk and
        // signal that process directly, matching what an operator's
        // SIGTERM/taskkill targets in production (no tsx wrapper there).
        const recordedPid = await readFile(claimPath, "utf8");

        const exited = new Promise<void>((resolveExit) => {
          child.on("exit", () => resolveExit());
        });
        process.kill(Number(recordedPid), "SIGTERM");
        await exited;

        if (process.platform === "win32") {
          // v0.11 §4 (amended): SIGTERM maps to TerminateProcess on win32,
          // which runs no handler — dropLock (src/cli.ts) never fires, so
          // both the tip claim and loop.pid survive the kill exactly as a
          // `kill -9` would. Release-on-signal is a POSIX guarantee only;
          // the cross-platform guarantee is stale-reclaim — the claim's
          // recorded pid now names the dead holder, so the next acquirer's
          // liveness probe (exercised end-to-end via `flume status`, which
          // already asserts this wording elsewhere in this suite) reclaims
          // it rather than refusing.
          expect(existsSync(claimPath)).toBe(true);
          expect(existsSync(pidPath)).toBe(true);
          expect(await readFile(claimPath, "utf8")).toBe(recordedPid);

          const status = await runCli(repo.dir, ["status"]);
          expect(status.code).toBe(0);
          expect(status.out).toContain(
            "tip claim present, process dead — stale",
          );
        } else {
          expect(existsSync(claimPath)).toBe(false);
          expect(existsSync(pidPath)).toBe(false);
        }
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "flume loop exits 1 on detached HEAD before any tick, taking neither loop.pid nor the tip claim",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await exec("git", ["checkout", "--detach"], { cwd: repo.dir });
        await writeRepoConfig(repo.dir, minimalChainSrc());
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const r = await runCli(repo.dir, ["loop", "--max", "1"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain("HEAD is detached");
        // No tick ran — the awake flag survives untouched, and neither lock
        // was ever written.
        expect(existsSync(join(repo.dir, ".flume", "awake", "probe"))).toBe(
          true,
        );
        expect(existsSync(join(repo.dir, ".flume", "loop.pid"))).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "flume tick exits 1 on detached HEAD without invoking the agent",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await exec("git", ["checkout", "--detach"], { cwd: repo.dir });
        await writeRepoConfig(repo.dir, minimalChainSrc());
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const r = await runCli(repo.dir, ["tick"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain("HEAD is detached");
        expect(existsSync(join(repo.dir, ".flume", "awake", "probe"))).toBe(
          true,
        );
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    // spec/loop.md, "The loop lock and the tip claim": `currentRefPath`
    // returned `null` for a detached HEAD, a non-repository cwd, and a
    // failing git invocation alike, so the refusal printed "HEAD is
    // detached" even when the caller was never in a repository at all.
    'flume tick outside a git repository reports that, not "HEAD is detached"',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-non-repo-"));
      try {
        const r = await runCli(dir, ["tick"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain("not a git repository");
        expect(r.out).not.toContain("HEAD is detached");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    // spec/loop.md, "The tick verdict — one facts artifact": the
    // detached-HEAD refusal must clear a prior tick's stale verdict before
    // returning, not leave it for a loop's supervisor to misread as this
    // tick's own on every subsequent iteration.
    "flume tick on detached HEAD clears a stale tick-verdict.json before refusing",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const flumeDir = join(repo.dir, ".flume");
        await mkdir(flumeDir, { recursive: true });
        const verdictPath = join(flumeDir, "tick-verdict.json");
        await writeFile(
          verdictPath,
          JSON.stringify({
            phaseName: "probe",
            tags: [],
            committed: false,
            gateResults: [],
            shippedTags: [],
            mergeOutcomes: [],
            summary: "stale verdict from a prior tick",
          }),
          "utf8",
        );

        await exec("git", ["checkout", "--detach"], { cwd: repo.dir });
        new Baton(flumeDir).wake("probe");

        const r = await runCli(repo.dir, ["tick"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain("HEAD is detached");
        expect(existsSync(verdictPath)).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "flume status reports the tip claim alongside supervisor liveness",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const commonDir = resolve(
          repo.dir,
          await gitOut(repo.dir, ["rev-parse", "--git-common-dir"]),
        );
        const claimDir = join(commonDir, "flume", "tip-claims", "refs", "heads");
        await mkdir(claimDir, { recursive: true });
        // The vitest worker itself plays the live holder.
        await writeFile(join(claimDir, "main"), String(process.pid), "utf8");

        const live = await runCli(repo.dir, ["status"]);
        expect(live.code).toBe(0);
        expect(live.out).toContain(`tip claimed by pid ${process.pid}`);

        // Harvest a genuinely dead pid: spawn a no-op node child and wait
        // for it to exit before recording its pid as the stale holder.
        const probe = exec(process.execPath, ["-e", ""]);
        const deadPid = probe.child.pid;
        await probe;
        await writeFile(join(claimDir, "main"), String(deadPid), "utf8");

        const stale = await runCli(repo.dir, ["status"]);
        expect(stale.code).toBe(0);
        expect(stale.out).toContain("tip claim present, process dead — stale");
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "flume status prints nothing extra with no claim file, or on a detached HEAD",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const clean = await runCli(repo.dir, ["status"]);
        expect(clean.code).toBe(0);
        expect(clean.out).not.toContain("tip claim");

        await exec("git", ["checkout", "--detach"], { cwd: repo.dir });
        const detached = await runCli(repo.dir, ["status"]);
        expect(detached.code).toBe(0);
        expect(detached.out).not.toContain("tip claim");
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );
});
