/**
 * The advisory per-ref tip claim reaching `flume loop`/`flume
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

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { Baton } from "../src/Baton.ts";
import { currentRefPath, gitCommonDir, tipClaimPath } from "../src/git.ts";
import { parsePidClaim } from "../src/pidClaim.ts";
import { deadPid } from "./helpers/deadPid.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { hermeticEnv } from "./helpers/gitEnv.ts";
import { minimalChainSrc, writeRepoConfig } from "./helpers/repoChain.ts";
import { CLI, TSX_CLI, exec, runCli } from "./helpers/subprocess.ts";
import { fileWithContent, pidClaimIn, waitFor } from "./helpers/waitFor.ts";

/**
 * Scratch git repo on a chosen branch. The engine has no opinion on branch
 * names — every fixture below runs on whatever branch it was given.
 */
async function makeRepo(branch: string): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkTempDir("flume-tip-claim-");
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
 * The claim path the engine itself would key on for the ref `dir`'s HEAD is
 * on — `currentRefPath` + `tipClaimPath` (src/git.ts), never a second
 * spelling of the tip-claims layout here. Every assertion below that reads
 * "no claim was left behind" is an absence over this path, so a hand-copied
 * layout that drifted from the accessor would leave those tests permanently
 * green over a path nothing ever writes (`.claude/rules/engineering.md`, "A
 * green verdict is proven non-vacuous").
 *
 * A HEAD that names no ref throws rather than returning a path: a fixture
 * that detached before deriving has no claim path to assert against, and
 * silently substituting one is the same false green a hand copy is
 * ("Loud or nothing").
 */
async function headClaimPath(dir: string): Promise<string> {
  const ref = await currentRefPath(dir);
  if (ref.kind !== "ref") {
    throw new Error(
      `fixture: HEAD in ${dir} names no ref (${ref.kind}) — derive the ` +
        `claim path while it still does`,
    );
  }
  return tipClaimPath(await gitCommonDir(dir), ref.path);
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

describe("flume loop/tick — tip claim wiring", () => {
  it(
    "two loops against different state roots on one branch: the second refuses, naming the claim's holder pid",
    async () => {
      const repo = await makeRepo("main");
      try {
        const claimPath = await headClaimPath(repo.dir);
        await mkdir(dirname(claimPath), { recursive: true });
        // The vitest worker itself plays the live first loop's holder.
        await writeFile(claimPath, String(process.pid), "utf8");

        // A different state root than the planted claim's holder — only the
        // tip claim can refuse this pair; loop.pid never collides.
        const other = join(repo.dir, "other-state");
        await mkdir(other, { recursive: true });
        const r = await runCli(repo.dir, ["loop", "--max", "0"], {
          ...hermeticEnv(),
          FLUME_DIR: other,
        });

        expect(r.code).toBe(1);
        expect(r.out).toContain(`refs/heads/main claimed by pid ${process.pid}`);
        expect(r.out).toContain(claimPath);
        // Refused before ever taking its own loop.pid — nothing left behind
        // in the contender's own state root.
        expect(existsSync(join(other, "loop.pid"))).toBe(false);
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
      const repo = await makeRepo("main");
      const wtParent = await mkTempDir("flume-tip-claim-wt-");
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
    "a bare flume tick with no other live claim-holder acquires and releases a claim around its single tick",
    async () => {
      const repo = await makeRepo("main");
      try {
        await writeRepoConfig(repo.dir, slowAgentChainSrc("probe"));
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const child = spawn(process.execPath, [TSX_CLI, CLI, "tick"], {
          cwd: repo.dir,
          env: hermeticEnv(),
        });

        // The event the assertion is about: the bare tick's own claim, taken
        // before the slow agent's sleep. The wait's refusal names the claim
        // path, so the mid-tick presence this case exists to prove no longer
        // rests on a fixed guess at how long a `node`+`tsx` startup takes.
        const claimPath = await headClaimPath(repo.dir);
        await waitFor(
          `the bare tick's tip claim at ${claimPath}`,
          () => fileWithContent(claimPath),
        );

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
    "a signalled bare flume tick releases its tip claim on POSIX; on win32 (TerminateProcess, no handler runs) it survives and is stale-reclaimable",
    async () => {
      const repo = await makeRepo("main");
      try {
        await writeRepoConfig(repo.dir, slowAgentChainSrc("probe"));
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const child = spawn(process.execPath, [TSX_CLI, CLI, "tick"], {
          cwd: repo.dir,
          env: hermeticEnv(),
        });

        // tsx re-execs itself into a second node process to run the ESM
        // loader, so `child.pid` is the bootstrapper's, not the process that
        // acquired the claim and wrote its own pid into it — read the real
        // holder back off disk and signal it directly, matching what an
        // operator's SIGTERM targets in production. Waiting on the file also
        // proves the handler this case tests is installed: it precedes the
        // acquisition that wrote the file.
        const claimPath = await headClaimPath(repo.dir);
        const recorded = await waitFor(
          `the bare tick's tip claim at ${claimPath}`,
          () => pidClaimIn(claimPath),
        );

        const exited = new Promise<void>((resolveExit) => {
          child.on("exit", () => resolveExit());
        });
        process.kill(recorded.pid, "SIGTERM");
        await exited;

        if (process.platform === "win32") {
          // Release-on-signal is a POSIX guarantee only (spec/loop.md); the
          // cross-platform guarantee is stale-reclaim, so the claim survives
          // naming a now-dead holder.
          expect(existsSync(claimPath)).toBe(true);
          expect(parsePidClaim(await readFile(claimPath, "utf8"))).toEqual(recorded);

          const status = await runCli(repo.dir, ["status"]);
          expect(status.code).toBe(0);
          expect(status.out).toContain(
            "tip claim present, process dead — stale",
          );
        } else {
          expect(existsSync(claimPath)).toBe(false);
        }
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "a bare flume tick refuses exit 1 when a live process already holds the claim",
    async () => {
      const repo = await makeRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());

        const claimPath = await headClaimPath(repo.dir);
        await mkdir(dirname(claimPath), { recursive: true });
        // The vitest worker itself plays the live holder.
        await writeFile(claimPath, String(process.pid), "utf8");

        const r = await runCli(repo.dir, ["tick"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain(`refs/heads/main claimed by pid ${process.pid}`);
        // A refused bare tick released nothing — it never held the claim.
        expect(await readFile(claimPath, "utf8")).toBe(
          String(process.pid),
        );
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "claim file (and loop.pid) are gone after SIGTERM on POSIX; on win32 (TerminateProcess, no handler runs) both survive and the claim is stale-reclaimable — the amended tip-claim outcome",
    async () => {
      const repo = await makeRepo("main");
      try {
        await writeRepoConfig(repo.dir, slowAgentChainSrc("probe"));
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const child = spawn(
          process.execPath,
          [TSX_CLI, CLI, "loop", "--max", "1"],
          { cwd: repo.dir, env: hermeticEnv() },
        );
        let out = "";
        child.stdout?.on("data", (d: Buffer) => (out += d));
        child.stderr?.on("data", (d: Buffer) => (out += d));

        const claimPath = await headClaimPath(repo.dir);
        const pidPath = join(repo.dir, ".flume", "loop.pid");
        // The event this case needs is not "a file appeared" but "the
        // supervisor is mid-run": its child tick announcing itself proves the
        // loop is past acquiring both locks *and* past installing the
        // SIGTERM handler whose release this case asserts, with the child
        // parked in the slow agent's sleep. A fixed sleep guessed at that,
        // and a wait on the claim file alone would land a hair earlier than
        // the handler it is about to test.
        await waitFor(
          "the loop's child tick to announce its phase",
          () => (/tick → probe \(singleton\)/.test(out) ? out : undefined),
        );
        expect(existsSync(pidPath)).toBe(true);
        // tsx re-execs itself into a second node process to run the ESM
        // loader, so the spawned `child`'s own pid is the bootstrapper's,
        // not the one that actually acquired the locks and wrote its own
        // pid into both files — read the real holder back off disk and
        // signal that process directly, matching what an operator's
        // SIGTERM/taskkill targets in production (no tsx wrapper there).
        const recorded = await waitFor(
          `the loop supervisor's tip claim at ${claimPath}`,
          () => pidClaimIn(claimPath),
        );

        const exited = new Promise<void>((resolveExit) => {
          child.on("exit", () => resolveExit());
        });
        process.kill(recorded.pid, "SIGTERM");
        await exited;

        if (process.platform === "win32") {
          // Tip claim, amended: SIGTERM maps to TerminateProcess on win32,
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
          expect(parsePidClaim(await readFile(claimPath, "utf8"))).toEqual(recorded);

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
      const repo = await makeRepo("main");
      try {
        // Derived while HEAD still names a ref: once detached there is no
        // ref to key a claim on, so the path this loop *would* have claimed
        // is only readable from here.
        const claimPath = await headClaimPath(repo.dir);
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
        expect(existsSync(claimPath)).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "flume tick exits 1 on detached HEAD without invoking the agent",
    async () => {
      const repo = await makeRepo("main");
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
      const dir = await mkTempDir("flume-non-repo-");
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
      const repo = await makeRepo("main");
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
      const repo = await makeRepo("main");
      try {
        const claimPath = await headClaimPath(repo.dir);
        await mkdir(dirname(claimPath), { recursive: true });
        // The vitest worker itself plays the live holder.
        await writeFile(claimPath, String(process.pid), "utf8");

        const live = await runCli(repo.dir, ["status"]);
        expect(live.code).toBe(0);
        expect(live.out).toContain(`tip claimed by pid ${process.pid}`);

        await writeFile(claimPath, String(deadPid()), "utf8");

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
      const repo = await makeRepo("main");
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
