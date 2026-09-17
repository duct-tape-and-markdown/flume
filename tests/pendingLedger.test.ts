/**
 * The pending ledger's relocation check (`isPendingRelocated`,
 * `src/pendingLedger.ts`) — the one fact the ledger's reads and its rewrite
 * both turn on, and the one this module decides for itself rather than being
 * handed.
 *
 * The other three context-taking calls in that module are exercised
 * end-to-end through a real tick (`tests/Dispatcher.test.ts`), because what
 * they read is a committed tip and what they write is a harness commit. This
 * one is a pure verdict over two paths, so it is pinned where it is decided:
 * against `computeStateRootRel` (`src/paths.ts`), which answers the same
 * question about the state root the ledger sits under. The two must agree —
 * a ledger the dispatcher reports as in-tree while the rewrite treats it as
 * an out-of-tree dock would write the queue to disk and commit nothing, and
 * the next tick would dispatch off a tip that never moved.
 *
 * Beside it, the one chain-less read (`readPendingLoose`): it takes a bare
 * path because it runs where no chain resolved, so it is driven directly
 * here rather than through a tick.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { computeStateRootRel } from "../src/paths.ts";
import {
  isPendingRelocated,
  readPendingLoose,
  type PendingLedgerContext,
} from "../src/pendingLedger.ts";
import { denyFile } from "./helpers/denial.ts";
import { silent } from "./helpers/dispatcherFixture.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";

const REPO = join("/", "tmp", "flume-ledger-repo");

/** The four fields a read takes; only two of them decide this verdict. */
function ctx(pendingPath: string): PendingLedgerContext {
  return {
    repoRoot: REPO,
    pendingPath,
    entryExtension: undefined,
    log: silent,
  };
}

describe(
  "pendingLedger — isPendingRelocated agrees with computeStateRootRel " +
    '(.claude/rules/engineering.md "The fix lands at the mechanism")',
  () => {
    it("agrees with computeStateRootRel on a relocated (out-of-tree) pendingPath", () => {
      const dock = join("/", "tmp", "flume-ledger-dock");
      const pendingPath = join(dock, "plan", "pending.json");
      expect(computeStateRootRel(REPO, pendingPath)).toBeUndefined();
      expect(isPendingRelocated(ctx(pendingPath))).toBe(true);
    });

    it("agrees with computeStateRootRel on a normal in-tree pendingPath", () => {
      const pendingPath = join(REPO, ".flume", "plan", "pending.json");
      expect(computeStateRootRel(REPO, pendingPath)).toBeDefined();
      expect(isPendingRelocated(ctx(pendingPath))).toBe(false);
    });
  },
);

/**
 * `readPendingLoose` is the one probe `flume status` reads its count
 * through, and the split it gives a failed read is the whole claim: absent
 * is the empty queue, anything else escapes rather than reading as empty
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 */
describe("readPendingLoose — the ENOENT/other split", () => {
  it("readPendingLoose reads an absent (ENOENT) pending.json as the empty, valid list", async () => {
    const dir = await mkTempDir("flume-loose-absent-");
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
    const dir = await mkTempDir("flume-loose-denied-");
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
  });
});
