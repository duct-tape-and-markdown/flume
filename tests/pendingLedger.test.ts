/**
 * The pending ledger's relocation check (`isPendingRelocated`,
 * `src/pendingLedger.ts`) — the one fact the ledger's reads and its rewrite
 * both turn on, and the one this module decides for itself rather than being
 * handed.
 *
 * The other three calls in that module are exercised end-to-end through a
 * real tick (`tests/Dispatcher.test.ts`), because what they read is a
 * committed tip and what they write is a harness commit. This one is a pure
 * verdict over two paths, so it is pinned where it is decided: against
 * `computeStateRootRel` (`src/Dispatcher.ts`), which answers the same
 * question about the state root the ledger sits under. The two must agree —
 * a ledger the dispatcher reports as in-tree while the rewrite treats it as
 * an out-of-tree dock would write the queue to disk and commit nothing, and
 * the next tick would dispatch off a tip that never moved.
 */

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { computeStateRootRel } from "../src/Dispatcher.ts";
import {
  isPendingRelocated,
  type PendingLedgerContext,
} from "../src/pendingLedger.ts";
import { silent } from "./helpers/dispatcherFixture.ts";

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
