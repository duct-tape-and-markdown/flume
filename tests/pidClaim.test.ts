/**
 * The loop lock's statement, through the readers that key on it
 * (`liveLoopClaim` / `liveLoopPid`, `src/pidClaim.ts`). `flume loop` writes
 * the holder's pid on the first line and the instant it took the lock on the
 * second (spec/loop.md, "The loop lock and the tip claim"), and the fixtures
 * below are the writer's own rendering rather than that shape spelled again
 * here (`.claude/rules/engineering.md`, *A seam gate reads what the real
 * writer wrote*).
 *
 * Which line each reader takes is the whole compatibility claim: liveness
 * reads line one, where every reader has always looked, so the second line
 * costs a pid-only caller nothing.
 *
 * `parsePidClaim`'s own decode — what each line may say and what a claim
 * reads as when it says nothing usable — is judged through these readers and
 * through the tip claim's (`tests/git.test.ts`), which read the same parse.
 * The third line the tip claim adds is rendered and decoded here, beside the
 * lock's two, because the claim this file carries is that one guard's extra
 * statement costs the other's readers nothing; what that root *means* to a
 * refusal is the tip claim's suite.
 *
 * The stake's half of the same statement — which file a release removes, and
 * how many times — is the last suite below, held here rather than at either
 * guard because both build on the one stake (`stakePidClaim`,
 * `src/pidClaim.ts`).
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loopLockPath } from "../src/paths.ts";
import {
  liveLoopClaim,
  liveLoopPid,
  livePidClaimAt,
  parsePidClaim,
  renderPidClaim,
  stakePidClaim,
} from "../src/pidClaim.ts";
import { denyFile } from "./helpers/denial.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";

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

  /**
   * The line the loop lock does not write. The tip claim states the state root
   * its holder resolved under the two lines above (spec/loop.md, "The loop
   * lock and the tip claim"), and the loop lock is keyed by that root already,
   * so what is pinned here is that neither guard's reader is disturbed by the
   * other's statement: a root arrives when the writer stated one, and its
   * absence is `undefined` rather than a substituted path
   * (`.claude/rules/engineering.md`, "Loud or nothing").
   */
  it("a three-line claim reports its state root, and a two-line one reports none", async () => {
    const at = new Date("2026-01-02T03:04:05.000Z");
    const root = join("/srv", "docks", "relocated");

    const three = renderPidClaim(process.pid, at, root);
    // Non-vacuity: the subject really is a three-line statement, and the two
    // lines every earlier reader takes are untouched by the third.
    expect(three.split("\n").filter((line) => line !== "")).toHaveLength(3);
    expect(three.startsWith(renderPidClaim(process.pid, at))).toBe(true);
    expect(parsePidClaim(three)).toEqual({
      pid: process.pid,
      atMs: at.getTime(),
      stateRoot: root,
    });

    // The loop lock's own statement, unchanged: two lines, and a decode that
    // reports no root rather than one it picked.
    const two = renderPidClaim(process.pid, at);
    expect(two.split("\n").filter((line) => line !== "")).toHaveLength(2);
    expect(parsePidClaim(two)).toEqual({
      pid: process.pid,
      atMs: at.getTime(),
    });
    expect(parsePidClaim(two)?.stateRoot).toBeUndefined();
  });

  it("renderPidClaim refuses a state root carrying a newline rather than writing a statement it would misread", async () => {
    const at = new Date("2026-01-02T03:04:05.000Z");
    // A posix path may hold a newline, and written through it would leave a
    // third line naming a root nobody resolved — which the decode would then
    // report as the holder's.
    const forged = `/srv/dock\n${join("/srv", "other")}`;

    expect(() => renderPidClaim(process.pid, at, forged)).toThrow(/newline/);
    // Non-vacuity: the same root without the newline renders and round-trips,
    // so the refusal is about the newline and not about the path.
    expect(parsePidClaim(renderPidClaim(process.pid, at, "/srv/dock"))?.stateRoot).toBe(
      "/srv/dock",
    );
  });
});

/**
 * The stake's release — whose file it removes, and how many times.
 *
 * A guard file is a shared address, not the holder's private one. The stake
 * that took it is released twice by design in the callers that install a
 * signal handler beside a `finally` (`flume tick`'s bare tip claim and
 * `flume loop`'s, `src/cliLoop.ts`), and between the two calls the path may
 * have been staked again by a later holder — the next tick, a sibling run. An
 * unlink on that second call deletes a live claim this process does not hold,
 * which is why the guard rides the stake rather than a `held` flag each
 * caller spells for itself (`.claude/rules/engineering.md`, *The fix lands at
 * the mechanism*).
 */
describe("stakePidClaim — the release drops the file its own stake created", () => {
  it("a staked claim's first release removes the claim file it created", async () => {
    const base = await mkTempDir("flume-stake-release-");
    try {
      const path = join(base, "guards", "tip-claims", "heads", "main");
      const stake = await stakePidClaim(path);
      expect(stake.kind).toBe("staked");
      if (stake.kind !== "staked") return;

      // Non-vacuity: the subject is a file this stake really created, naming
      // this process. Absent here, the assertion below would be about a path
      // nothing ever wrote.
      expect(existsSync(stake.claim.path)).toBe(true);
      expect(
        parsePidClaim(await readFile(stake.claim.path, "utf8"))?.pid,
      ).toBe(process.pid);

      stake.claim.release();

      expect(existsSync(stake.claim.path)).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("a second release of a staked claim leaves a later holder's claim file standing", async () => {
    const base = await mkTempDir("flume-stake-rerelease-");
    try {
      const path = join(base, "guards", "tip-claims", "heads", "main");
      const first = await stakePidClaim(path);
      expect(first.kind).toBe("staked");
      if (first.kind !== "staked") return;
      first.claim.release();
      expect(existsSync(path)).toBe(false);

      // The later holder: the path is free, so this is a stake of its own and
      // not a reclaim over the first. The vitest worker plays it, the
      // convention every liveness case here uses — its pid is alive for the
      // duration of the call, so the claim below is a live one.
      const later = await stakePidClaim(path);
      expect(later.kind).toBe("staked");
      if (later.kind !== "staked") return;
      expect(await livePidClaimAt(path)).not.toBeNull();

      // The first holder's exit handler, firing after its `finally` already
      // dropped: the stake is spent, so this call unlinks nothing.
      first.claim.release();

      expect(existsSync(path)).toBe(true);
      expect(await livePidClaimAt(path)).not.toBeNull();

      later.claim.release();
      expect(existsSync(path)).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

/**
 * JOB-EXISTSSYNC-NARROW-ENOENT — `existsSync` collapses every stat error to
 * `false`, so a gate built on it reads a present-but-unreachable path as an
 * absent one: a live loop read dead — a correct-looking answer that is a lie
 * about what was there (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * The denial is structural, not a permission bit (`tests/helpers/denial.ts`):
 * a directory where the reader wants a file. Same fixture shape
 * `readPendingLoose` (`tests/pendingLedger.test.ts`) and `countFrictionFiles`
 * (`tests/friction.test.ts`) are pinned with, and it denies on win32 and
 * under a root-run, where a mode denies nothing. The case reads the fixture
 * once *before* denying it, so the assertion afterwards is judged against a
 * populated subject rather than a mistyped path
 * (`.claude/rules/engineering.md`, "A green verdict is proven non-vacuous").
 */
describe("the loop lock's existence gate — the ENOENT/EACCES split (JOB-EXISTSSYNC-NARROW-ENOENT)", () => {
  it("liveLoopPid rethrows a non-ENOENT stat failure instead of reading the pidfile as absent", async () => {
    const base = await mkTempDir("flume-loop-pid-");
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
});

/**
 * Same deep-nesting shape as the Dispatcher.ts win32 suites
 * (WRITEREVERTNOTE-WIN32-PATH-TOTAL-LIMIT et al.): a bare `join()` reads a
 * too-long path as absent rather than as a real error, so the read below
 * would silently misreport a live loop as dead instead of resolving.
 */
describe.runIf(process.platform === "win32")(
  "the loop lock's read — win32 total-path limit (JOB-EXISTSSYNC-WIN32-PATH-TOTAL-LIMIT)",
  () => {
    it("liveLoopPid resolves a live pid when dir/loop.pid nests past win32's ~260-char limit", async () => {
      const base = await mkTempDir("flume-loop-pid-w32-");
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
