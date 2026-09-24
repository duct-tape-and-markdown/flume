/**
 * The wait-and-reclaim guard, through the two locks composed on it
 * (`acquireShipLock` and the worktree lock, `src/git.ts`) and through the
 * primitive itself (`acquireWaitLock`, `src/waitLock.ts`) — spec/loop.md,
 * "The ship lock and the worktree lock — sibling ticks take turns at git".
 *
 * Three claims, and each needs a different instrument:
 *
 * - **reclaim** is a disk verdict, read off the file the acquirer left;
 * - **wait** is the absence of a verdict, so it is proven by the acquirer
 *   still not having one while a live holder stands — a case that asserted
 *   only the log line would pass over an acquirer that announced a wait and
 *   sailed through;
 * - **scope** — which commands run under the worktree lock — is proven the
 *   same way, one command at a time, because a lock a command takes is a
 *   lock that command blocks on.
 *
 * The live holder every case plants is the vitest worker's own pid, the
 * convention every liveness fixture in this suite uses: it is alive for the
 * duration of the call, and a harvested one is a race
 * (`.claude/rules/platform-facts.md`, *A reaped pid returns to the host's
 * allocation pool*).
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireShipLock,
  addWorktree,
  gitCommonDir,
  pruneWorktrees,
  removeWorktree,
} from "../src/git.ts";
import type { Logger } from "../src/log.ts";
import { parsePidClaim, renderPidClaim } from "../src/pidClaim.ts";
import { acquireWaitLock } from "../src/waitLock.ts";
import { deadPid } from "./helpers/deadPid.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { makeScratchRepo, type ScratchRepo } from "./helpers/scratchRepo.ts";
import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";
import { waitFor } from "./helpers/waitFor.ts";

// This file starts processes (`git worktree` and the scratch repo's seed), so
// it declares the lane's one budget — cases and hooks alike — once here
// rather than inheriting the runner's default (`SPAWN_BUDGET_MS`,
// `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/** A logger that keeps every line, so a wait's announcement is readable. */
function recording(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return { lines, info: (l) => lines.push(l), warn: () => {}, error: () => {} };
}

/** Who the guard file at `path` names, or `null` when there is no file. */
async function holderAt(path: string): Promise<number | null> {
  if (!existsSync(path)) return null;
  return parsePidClaim(await readFile(path, "utf8"))?.pid ?? null;
}

/** Plant a live holder — this process — on `path`. */
async function plantLiveHolder(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderPidClaim(process.pid, new Date()), "utf8");
}

describe("acquireWaitLock — the wait-and-reclaim guard", () => {
  it("a lock held by a dead pid is reclaimed by the next acquirer", async () => {
    const dir = await mkTempDir("flume-wait-lock-reclaim-");
    const path = join(dir, "flume", "some.lock");
    const stale = deadPid();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      renderPidClaim(stale, new Date("2020-01-01T00:00:00.000Z")),
      "utf8",
    );
    const log = recording();

    try {
      const lock = await acquireWaitLock({
        path,
        label: "the ship lock",
        log,
        pollMs: 10,
      });

      // The holder on disk is this acquirer now, not the stale pid it
      // reclaimed over — the whole verdict, since a file that still named
      // `stale` would be a lock nothing took.
      expect(await holderAt(path)).toBe(process.pid);
      expect(await holderAt(path)).not.toBe(stale);
      // A reclaim is not a wait, and says nothing.
      expect(log.lines).toEqual([]);

      lock.release();
      expect(existsSync(lock.path)).toBe(false);
      // Idempotent: an exit handler may call it after the normal release.
      expect(() => lock.release()).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The release's reach — whose lock file it removes, and how many times.
 *
 * A lock file is a shared address, not the holder's private one: the acquirer
 * that gives it up may be released again — an exit handler after a `finally`,
 * a rollback after a signal — and by then a sibling tick of this run may hold
 * the same path. The drop the wait lock returns is the stake's own
 * (`atMostOnceDrop`, `src/pidClaim.ts`), so the second call removes nothing
 * rather than taking a waiting sibling's turn out from under it.
 */
describe("acquireWaitLock — the release drops the file its own acquire created", () => {
  it("a wait lock released once removes the file it created", async () => {
    const dir = await mkTempDir("flume-wait-lock-release-");
    try {
      const path = join(dir, "flume", "some.lock");
      const lock = await acquireWaitLock({
        path,
        label: "the ship lock",
        log: recording(),
        pollMs: 10,
      });

      // Non-vacuity: the subject is a file this acquire really created,
      // naming this process. Absent here, the assertion below would be about
      // a path nothing ever wrote.
      expect(existsSync(lock.path)).toBe(true);
      expect(await holderAt(lock.path)).toBe(process.pid);

      lock.release();

      expect(existsSync(lock.path)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a wait lock released a second time leaves a later holder's lock file standing", async () => {
    const dir = await mkTempDir("flume-wait-lock-rerelease-");
    try {
      const path = join(dir, "flume", "some.lock");
      const first = await acquireWaitLock({
        path,
        label: "the ship lock",
        log: recording(),
        pollMs: 10,
      });
      first.release();
      expect(existsSync(path)).toBe(false);

      // The later holder: the path is free, so this acquire creates a file of
      // its own rather than reclaiming over the first — and its holder is the
      // vitest worker, alive for the duration of the call, the convention
      // every liveness fixture here uses.
      const later = await acquireWaitLock({
        path,
        label: "the ship lock",
        log: recording(),
        pollMs: 10,
      });
      expect(await holderAt(path)).toBe(process.pid);

      // The first acquirer's exit handler, firing after its `finally` already
      // dropped: the drop is spent, so this call unlinks nothing.
      first.release();

      expect(
        existsSync(path),
        "a spent release removed the later holder's lock file",
      ).toBe(true);
      expect(await holderAt(path)).toBe(process.pid);

      later.release();
      expect(existsSync(path)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the ship lock and the worktree lock — sibling ticks take turns at git", () => {
  let scratch: ScratchRepo | undefined;

  afterEach(async () => {
    await scratch?.cleanup();
    scratch = undefined;
  });

  it("a tick waits on a ship lock held by a live pid and says so on its log", async () => {
    scratch = await makeScratchRepo("flume-ship-lock-", "main");
    const repo = scratch.dir;
    const lockPath = join(await gitCommonDir(repo), "flume", "ship.lock");
    await plantLiveHolder(lockPath);
    const log = recording();

    let acquired = false;
    const pending = acquireShipLock(repo, log).then((lock) => {
      acquired = true;
      return lock;
    });

    const line = await waitFor(
      `the wait line for the ship lock at ${lockPath}`,
      () => log.lines.find((l) => l.includes("waiting for the ship lock")),
    );
    // The line names the holder and the file, so an operator staring at a
    // stalled run can tell which process to look at.
    expect(line).toContain(`pid ${process.pid}`);
    expect(line).toContain(lockPath);
    // Said so *and still waiting*: an acquirer that announced a wait and
    // then took the lock from under a live holder would satisfy the line
    // alone.
    expect(acquired, "the acquirer took a lock a live pid still held").toBe(
      false,
    );

    // The holder finishes. The next poll finds the file gone and creates it.
    await rm(lockPath);
    const lock = await pending;
    expect(await holderAt(lockPath)).toBe(process.pid);
    lock.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("each git worktree add, remove and prune runs under the worktree lock", async () => {
    scratch = await makeScratchRepo("flume-worktree-lock-", "main");
    const repo = scratch.dir;
    const lockPath = join(await gitCommonDir(repo), "flume", "worktrees.lock");
    const wt = join(repo, "wt");
    const log = recording();

    // Ordered so each command's own precondition is the previous one's
    // effect: add plants the tree, remove takes it away, prune sweeps what
    // remove left. Driven through the real git commands rather than a
    // fixture of them (`.claude/rules/engineering.md`, *A seam gate reads
    // what the real writer wrote*).
    const commands: [string, () => Promise<void>][] = [
      ["add", () => addWorktree({ repoRoot: repo, path: wt, fromRef: "HEAD", log })],
      ["remove", () => removeWorktree(repo, wt, log)],
      ["prune", () => pruneWorktrees(repo, log)],
    ];

    for (const [name, run] of commands) {
      await plantLiveHolder(lockPath);
      log.lines.length = 0;

      let done = false;
      const pending = run().then(() => {
        done = true;
      });

      await waitFor(
        `the wait line for git worktree ${name}`,
        () => log.lines.find((l) => l.includes("waiting for the worktree lock")),
      );
      expect(done, `git worktree ${name} ran with the lock held`).toBe(false);

      await rm(lockPath);
      await pending;
      // Taken *for the one command*: the guard is gone the moment the
      // command is, so the next mutation is never queued behind this one's
      // caller.
      expect(
        existsSync(lockPath),
        `git worktree ${name} left the worktree lock behind`,
      ).toBe(false);
    }

    // Vacuity: all three commands really ran, so "each blocked" is three
    // verdicts and not a loop that fell through.
    expect(existsSync(wt)).toBe(false);
  });
});
