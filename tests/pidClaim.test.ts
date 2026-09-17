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
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loopLockPath } from "../src/paths.ts";
import {
  liveLoopClaim,
  liveLoopPid,
  renderPidClaim,
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
