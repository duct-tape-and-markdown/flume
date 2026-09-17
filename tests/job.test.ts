/**
 * The state-root primitives `src/job.ts` holds: the runtime ignore set and
 * the merge that applies it, the chain-less pending read, the loop pidfile's
 * two-line claim and the friction-file count. The `flume job` verbs that used
 * to live beside them are gone (spec/jobs.md, *The checkout is the unit of
 * isolation*), so every case here drives one primitive directly — the ignore
 * cases through the real reader, git.
 */

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  countFrictionFiles,
  ensureRuntimeIgnores,
  liveLoopClaim,
  liveLoopPid,
  readPendingLoose,
  RUNTIME_IGNORES,
} from "../src/job.ts";
import {
  loopLockPath,
  mergingMarkerPath,
  STATE_ROOT_NAMES,
} from "../src/paths.ts";
import { renderPidClaim } from "../src/pidClaim.ts";
import { denyDirectory, denyFile } from "./helpers/denial.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, exec, gitOut } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/** Scratch git repo on `main` with one seed commit. */
async function makeRepo(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkTempDir("flume-ignores-repo-");
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", "main"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("ensureRuntimeIgnores — create-or-merge", () => {
  it("creates .gitignore with exactly the runtime entries when absent", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      await ensureRuntimeIgnores(dir);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content).toBe(RUNTIME_IGNORES.join("\n") + "\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent: a second run leaves the file byte-identical", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      await ensureRuntimeIgnores(dir);
      const first = await readFile(join(dir, ".gitignore"), "utf8");
      await ensureRuntimeIgnores(dir);
      expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves template lines and order, appending only the missing entries", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      // Template already ignores one runtime entry and carries its own
      // chain-convention lines — merge must not duplicate or reorder.
      const template = "# harness scratch\nsessions/\nnode_modules/\n";
      await writeFile(join(dir, ".gitignore"), template, "utf8");
      await ensureRuntimeIgnores(dir);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content.startsWith(template)).toBe(true);
      expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
      for (const entry of RUNTIME_IGNORES) {
        expect(content).toContain(entry);
      }
      expect(content.match(/^node_modules\/$/gm)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("folds caller-supplied extra entries (a declared friction dir) alongside RUNTIME_IGNORES into a fresh .gitignore", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      await ensureRuntimeIgnores(dir, ["friction/"]);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content).toBe([...RUNTIME_IGNORES, "friction/"].join("\n") + "\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent with extra entries: a second run with the same extra list leaves the file byte-identical", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      await ensureRuntimeIgnores(dir, ["friction/"]);
      const first = await readFile(join(dir, ".gitignore"), "utf8");
      await ensureRuntimeIgnores(dir, ["friction/"]);
      expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not duplicate an extra entry already present in a template, and preserves the template verbatim", async () => {
    const dir = await mkTempDir("flume-ignores-");
    try {
      const template = "# harness scratch\nfriction/\n";
      await writeFile(join(dir, ".gitignore"), template, "utf8");
      await ensureRuntimeIgnores(dir, ["friction/"]);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content.startsWith(template)).toBe(true);
      expect(content.match(/^friction\/$/gm)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Mechanism pin (RUNTIME-IGNORES-NAMES-THE-TICK-ARTIFACTS, per spec/jobs.md
// "Runtime ignores"): the seeded set covered the dirs and the loop lock but
// stopped short of the three runtime *files* a tick drops beside them — the
// stop flag and the two tick-verdict artifacts — so every state root the
// merge touched left them trackable, and the first `git add -A` after a tick
// committed harness runtime state. The names are the state root's own
// (`STATE_ROOT_NAMES`, `src/paths.ts`), so this drives the real ignore file
// through the real reader — git — rather than asserting the set against a
// list respelled here.
describe("ensureRuntimeIgnores — the runtime files a tick drops", () => {
  it("RUNTIME_IGNORES names the stop flag, the latest-tick verdict and the verdict log", async () => {
    // Vacuity (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): an empty set would leave `check-ignore` below judging
    // nothing.
    expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
    const tickArtifacts = [
      STATE_ROOT_NAMES.stopFlag,
      STATE_ROOT_NAMES.tickVerdict,
      STATE_ROOT_NAMES.tickVerdictsLog,
    ];
    for (const name of tickArtifacts) {
      expect(RUNTIME_IGNORES).toContain(name);
    }

    const repo = await makeRepo();
    try {
      const stateRoot = join(repo.dir, ".flume");
      await mkdir(stateRoot, { recursive: true });
      await ensureRuntimeIgnores(stateRoot);
      // The artifacts as a tick leaves them: git only reports an ignore for
      // a path it would otherwise see, so write each one first.
      for (const name of tickArtifacts) {
        await writeFile(join(stateRoot, name), "");
      }
      // git's own verdict on what it would track under the state root: the
      // merged `.gitignore` and nothing else.
      const seen = await gitOut(repo.dir, [
        "status",
        "--porcelain",
        "-uall",
        "--",
        ".flume",
      ]);
      expect(seen).toBe("?? .flume/.gitignore");
    } finally {
      await repo.cleanup();
    }
  });
});

// Mechanism pin (RUNTIME-IGNORES-NAMES-MERGING, per spec/jobs.md "Runtime
// ignores"): the merge stage stakes `<stateRoot>/merging/<slug>.json` before
// each pick and clears it after, so a crash mid-merge leaves the marker on
// disk — exactly the moment an operator reaches for `git add`. The seed
// covered every other runtime dir but not this one, so the crash artifact the
// next `loop` start refuses on was untracked-visible and addable. The name is
// the state root's own (`STATE_ROOT_NAMES`, `src/paths.ts`) and the marker
// path is built by the real accessor, so this drives the real writer through
// the real reader — git — rather than respelling either side here.
describe("ensureRuntimeIgnores — the crash-surviving merge marker", () => {
  it("RUNTIME_IGNORES names the merging-marker dir", async () => {
    // Vacuity (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): an empty set would leave `status` below judging nothing.
    expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
    expect(RUNTIME_IGNORES).toContain(`${STATE_ROOT_NAMES.merging}/`);

    const repo = await makeRepo();
    try {
      const stateRoot = join(repo.dir, ".flume");
      await mkdir(stateRoot, { recursive: true });
      await ensureRuntimeIgnores(stateRoot);
      // The marker as an interrupted merge leaves it: git only reports an
      // ignore for a path it would otherwise see, so write it first.
      const marker = mergingMarkerPath(stateRoot, "some-entry-tag");
      await mkdir(dirname(marker), { recursive: true });
      await writeFile(marker, "{}\n");

      const seen = await gitOut(repo.dir, [
        "status",
        "--porcelain",
        "-uall",
        "--",
        ".flume",
      ]);
      expect(seen).toBe("?? .flume/.gitignore");
    } finally {
      await repo.cleanup();
    }
  });
});

// ---------- the chain-less pending read ----------

/**
 * `readPendingLoose` is the one probe `flume status` reads its count
 * through, and the split it gives a failed read is the whole claim: absent
 * is the empty queue, anything else escapes rather than reading as empty
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 */
describe("readPendingLoose — the ENOENT/other split", () => {
  it("readPendingLoose reads an absent (ENOENT) pending.json as the empty, valid list", async () => {
    const dir = await mkTempDir("flume-job-status-");
    try {
      const pendingPath = join(dir, "plan", "pending.json");
      expect(readPendingLoose(pendingPath)).toEqual({
        ok: true,
        entries: [],
        errors: [],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("readPendingLoose rethrows a non-ENOENT stat/read failure instead of reading it as absent — existsSync collapses any stat error, not just ENOENT, to false (JOB-READPENDINGLOOSE-NARROW-ENOENT)", async () => {
    const dir = await mkTempDir("flume-job-status-");
    try {
      const planDir = join(dir, "plan");
      await mkdir(planDir, { recursive: true });
      const pendingPath = join(planDir, "pending.json");
      await writeFile(pendingPath, "[]");
      // Non-vacuity: the queue reads before it is denied.
      expect(readPendingLoose(pendingPath).ok).toBe(true);

      // Deny the queue file structurally (`tests/helpers/denial.ts`): the
      // path is still there to a stat, and the read fails EISDIR — not
      // ENOENT (`.claude/rules/engineering.md`, "Loud or nothing"). Denying
      // the *parent* would not arm this on every host: win32 reports a path
      // through a non-directory as ENOENT, so the gate would take its absent
      // arm there (`tests/helpers/denial.ts`, *deny the exact path*).
      denyFile(pendingPath);

      let caught: NodeJS.ErrnoException | undefined;
      try {
        readPendingLoose(pendingPath);
      } catch (err) {
        caught = err as NodeJS.ErrnoException;
      }
      expect(caught).toBeDefined();
      expect(caught?.code).not.toBe("ENOENT");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });});


// ---------- the friction-file count ----------

/**
 * `countFrictionFiles` gives a failed read the same three-way reading: `0`
 * for an absent dir, a real count for a readable one, and `null` — never a
 * zero — for a dir that is there and cannot be listed
 * (`.claude/rules/engineering.md`, "Loud or nothing"). `flume status` and
 * the loop-end summary both render that reading (`src/friction.ts`).
 */
describe("countFrictionFiles — the ENOENT/other split", () => {
  it("counts an absent dir as 0 and an unlistable one as null", async () => {
    const base = await mkTempDir("flume-friction-count-");
    const dir = join(base, "friction");
    try {
      expect(countFrictionFiles(dir)).toBe(0);

      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "a.md"), "x\n");
      await writeFile(join(dir, "b.md"), "y\n");
      // A dot-prefixed name is not a note, and a subdir is not a file.
      await writeFile(join(dir, ".gitkeep"), "");
      await mkdir(join(dir, "nested"), { recursive: true });
      // Non-vacuity: the dir counts before it is denied.
      expect(countFrictionFiles(dir)).toBe(2);

      // Deny structurally (`tests/helpers/denial.ts`): readdir now fails
      // ENOTDIR — the path is there but is not a dir to read — not ENOENT.
      denyDirectory(dir);
      expect(countFrictionFiles(dir)).toBeNull();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

/**
 * JOB-EXISTSSYNC-NARROW-ENOENT — `existsSync` collapses every stat error to
 * `false`, so each gate it guarded in `src/job.ts` read a present-but-
 * unreachable path as an absent one: a live loop read dead, an unreadable
 * baton read hibernating (or threw out of the enumeration and took every
 * sibling job with it), and an unreadable jobs root read "no jobs" — a
 * correct-looking answer that is a lie about what was there
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * The denial is structural, not a permission bit (`tests/helpers/denial.ts`):
 * a plain file where the reader wants a directory, a directory where it wants
 * a file. Same fixture shape `readPendingLoose` and `countFrictionFiles` are
 * pinned with above, and it denies on win32 and under a root-run, where a
 * mode denies nothing. Each test reads the fixture once *before* denying it,
 * so the assertion afterwards is judged against a populated subject rather
 * than a mistyped path (`.claude/rules/engineering.md`, "A green verdict is
 * proven non-vacuous").
 */
/**
 * The loop lock's statement, through the readers that key on it. `flume loop`
 * writes the holder's pid on the first line and the instant it took the lock
 * on the second (spec/loop.md, "The loop lock and the tip claim"), and the
 * fixture below is the writer's own rendering rather than that shape spelled
 * again here (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*).
 *
 * Which line each reader takes is the whole compatibility claim: liveness
 * reads line one, where every reader has always looked, so the second line
 * costs a pid-only caller nothing.
 */
describe("liveLoopClaim / liveLoopPid — the loop lock's two-line statement", () => {
  it("a two-line loop lock still reports its holder live", async () => {
    const base = await mkTempDir("flume-loop-claim-");
    const root = join(base, "state");
    try {
      await mkdir(root, { recursive: true });
      // The vitest worker plays the live supervisor — its pid is alive for
      // the duration of the call, the convention every liveness test here
      // uses.
      const at = new Date(Date.now() - 60_000);
      await writeFile(
        loopLockPath(root),
        renderPidClaim(process.pid, at),
        "utf8",
      );

      // Non-vacuity: the subject really is a two-line lock. Read as one line,
      // every assertion below would be about a file the fix never changed.
      const raw = await readFile(loopLockPath(root), "utf8");
      expect(raw.split("\n").filter((l) => l !== "")).toHaveLength(2);
      expect(Number(raw)).toBeNaN();

      // Liveness takes the first line, so the holder reads live exactly as it
      // did when the file held a bare pid and nothing else.
      expect(await liveLoopPid(root)).toBe(process.pid);
      // ...and the instant rides back with it, for the one reader that needs
      // the run's start.
      expect(await liveLoopClaim(root)).toEqual({
        pid: process.pid,
        atMs: at.getTime(),
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("a loop lock stating no instant still names its holder", async () => {
    const base = await mkTempDir("flume-loop-claim-bare-");
    const root = join(base, "state");
    try {
      await mkdir(root, { recursive: true });
      // What a flume before 0.17 left behind: a pid and nothing else. The pid
      // still decides liveness — refusing it over a missing second line
      // would reclaim a live supervisor's state root
      // (`docs/MIGRATING-0.17.md`).
      await writeFile(loopLockPath(root), String(process.pid), "utf8");

      expect(await liveLoopPid(root)).toBe(process.pid);
      expect(await liveLoopClaim(root)).toEqual({ pid: process.pid });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

/**
 * JOB-EXISTSSYNC-NARROW-ENOENT — `existsSync` collapses every stat error to
 * `false`, so a gate built on it reads a present-but-unreachable path as an
 * absent one: a live loop read dead, an unreadable ignore file rewritten
 * from "" — a correct-looking answer that is a lie about what was there
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * The denial is structural, not a permission bit (`tests/helpers/denial.ts`):
 * a plain file where the reader wants a directory, a directory where it wants
 * a file. Same fixture shape `readPendingLoose` and `countFrictionFiles` are
 * pinned with above, and it denies on win32 and under a root-run, where a
 * mode denies nothing. Each test reads the fixture once *before* denying it,
 * so the assertion afterwards is judged against a populated subject rather
 * than a mistyped path (`.claude/rules/engineering.md`, "A green verdict is
 * proven non-vacuous").
 */
describe("job.ts existence gates — the ENOENT/EACCES split (JOB-EXISTSSYNC-NARROW-ENOENT)", () => {
  it("liveLoopPid rethrows a non-ENOENT stat failure instead of reading the pidfile as absent", async () => {
    const base = await mkTempDir("flume-job-pid-");
    const root = join(base, "state");
    try {
      await mkdir(root, { recursive: true });
      // The vitest worker plays the live loop — its pid is alive for the
      // duration of the call.
      await writeFile(loopLockPath(root), String(process.pid), "utf8");
      expect(await liveLoopPid(root)).toBe(process.pid);

      // Deny the pidfile structurally: the path is still there to a stat,
      // and reading it now fails EISDIR, not ENOENT.
      denyFile(loopLockPath(root));

      let caught: NodeJS.ErrnoException | undefined;
      try {
        await liveLoopPid(root);
      } catch (err) {
        caught = err as NodeJS.ErrnoException;
      }
      expect(caught).toBeDefined();
      expect(caught?.code).not.toBe("ENOENT");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")("ensureRuntimeIgnores rethrows a non-ENOENT read failure instead of rewriting the .gitignore it could not read", async () => {
    const base = await mkTempDir("flume-job-ignores-");
    const stateRoot = join(base, "state");
    try {
      await mkdir(stateRoot, { recursive: true });
      await writeFile(join(stateRoot, ".gitignore"), "sessions/\n", "utf8");
      await chmod(join(stateRoot, ".gitignore"), 0o000);

      let caught: NodeJS.ErrnoException | undefined;
      try {
        await ensureRuntimeIgnores(stateRoot);
      } catch (err) {
        caught = err as NodeJS.ErrnoException;
      }
      expect(caught).toBeDefined();
      expect(caught?.code).not.toBe("ENOENT");
      // The seed-authored line survives: an unreadable file read as ""
      // would have been rewritten with the runtime set alone.
      await chmod(join(stateRoot, ".gitignore"), 0o644);
      expect(await readFile(join(stateRoot, ".gitignore"), "utf8")).toBe(
        "sessions/\n",
      );
    } finally {
      await chmod(join(stateRoot, ".gitignore"), 0o644).catch(() => {});
      await rm(base, { recursive: true, force: true });
    }
  });
});


/**
 * Same deep-nesting shape as the Dispatcher.ts win32 suites
 * (WRITEREVERTNOTE-WIN32-PATH-TOTAL-LIMIT et al.): a bare `join()` reads a
 * too-long path as absent rather than as a real error, so each read below
 * would silently misreport state instead of resolving.
 */
describe.runIf(process.platform === "win32")(
  "src/job.ts reads — win32 total-path limit (FRICTIONCOUNT-WIN32-PATH-TOTAL-LIMIT, JOB-EXISTSSYNC-WIN32-PATH-TOTAL-LIMIT)",
  () => {
    it("countFrictionFiles resolves a real count when the friction dir nests past win32's ~260-char limit", async () => {
      const base = await mkTempDir("flume-friction-w32-");
      try {
        const frictionDir = join(
          base,
          ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        );
        await mkdir(frictionDir, { recursive: true });
        await writeFile(join(frictionDir, "a.md"), "x\n");
        await writeFile(join(frictionDir, "b.md"), "y\n");

        expect(frictionDir.length).toBeGreaterThan(260);
        expect(countFrictionFiles(frictionDir)).toBe(2);
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });

    it("liveLoopPid resolves a live pid when dir/loop.pid nests past win32's ~260-char limit", async () => {
      const base = await mkTempDir("flume-job-w32-");
      try {
        const deep = join(
          base,
          ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        );
        await mkdir(deep, { recursive: true });
        // The vitest worker plays the live loop — its pid is alive for the
        // duration of the call.
        await writeFile(join(deep, "loop.pid"), String(process.pid), "utf8");

        expect(join(deep, "loop.pid").length).toBeGreaterThan(260);
        expect(await liveLoopPid(deep)).toBe(process.pid);
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });
  },
);

