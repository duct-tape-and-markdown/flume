/**
 * spec/loop.md "Tip verify — one writer per branch, absorption at the
 * merge": the check a tick takes around the trunk it is about to move —
 * whether another engine instance holds the claim on the ref.
 *
 * Every harness-driven commit site asks it: the span carry every
 * concurrency's merge runs, before its first cherry-pick (`carryMergeSpan`
 * and `carryMergeBatch`, `src/mergeSpan.ts`), and the wave's trailing ledger
 * commit (`commitPendingUpdate`, `src/pendingLedger.ts`). So it lives in the
 * file its name is rather than as a method on the class that dispatches
 * between the legs (`.claude/rules/engineering.md`, *A module is one job*).
 * It reads no recorded tip: there is no expected-sha bookkeeping here, only
 * what the disk says at the moment of the check. Nothing compares a tip
 * against one it remembers, because nothing rewinds trunk past a commit —
 * a candidate is discarded instead (`spec/worktrees.md`, *Per-entry
 * `afterMerge` revert isolation*).
 */

import { existsLoudUnder } from "./fsProbe.js";
import * as git from "./git.js";

/**
 * spec/loop.md "Tip verify — one writer per branch, absorption at the
 * merge", "Harness-driven commits carry no expected-tip bookkeeping — the
 * claim refuses, git arbitrates": every harness-driven commit site asks this
 * instead of comparing an expected sha — the span carry's cherry-pick
 * (`carryMergeSpan`, `src/mergeSpan.ts`), whichever concurrency drove it, and
 * `commitPendingUpdate`'s ledger commit, which is the wave's alone. A live claim on
 * the ref HEAD currently resolves to is a concurrent engine instance — the
 * one interference no cherry-pick/conflict check can catch on its own,
 * since two engines can each cherry-pick a distinct, individually-clean
 * commit onto the same tip. No live claim means whatever moved the ref was
 * not an engine (`spec/loop.md`: "an engine instance always holds the
 * claim, an operator never does"), so the caller proceeds and lets git's
 * own conflict detection arbitrate content. A detached HEAD (untracked here
 * — `flume tick`/`flume loop` both refuse it before any tick runs) reads as
 * no claim, never a thrown error. A live claim matching `ownTipClaimPid` is
 * this run's own — not foreign — per `DispatcherOptions.ownTipClaimPid`'s
 * doc (`src/Dispatcher.ts`), which is where the value comes from.
 *
 * An unreachable claim path is the one reading this never takes: it throws to
 * the caller, the same refusal every other unreadable guard file already
 * raises (`livePidClaimAt`, `src/pidClaim.ts`).
 */
export async function liveForeignClaimPid(
  cwd: string,
  ownTipClaimPid: number | undefined,
): Promise<number | null> {
  const ref = await git.currentRefPath(cwd);
  if (ref.kind !== "ref") return null;
  const commonDir = await git.gitCommonDir(cwd);
  const claimPath = git.tipClaimPath(commonDir, ref.path);
  // No claim is a **proven** absence before it reads as an unclaimed ref:
  // `existsLoudUnder` (`src/fsProbe.ts`) descends from the common dir git
  // just resolved, which is the descent `flume status` already takes over
  // this same path (`src/cliStatus.ts`) rather than a second one spelled here
  // (`.claude/rules/engineering.md`, *The fix lands at the mechanism*). The
  // claim nests four segments under that root, and a plain file at any of
  // them answers the leaf's own stat `ENOENT` on win32
  // (`.claude/rules/platform-facts.md`, *win32 reports a path through a
  // non-directory as not found*) — so keyed off the leaf stat alone this
  // check reported "unclaimed" and the wave cherry-picked over a ref a live
  // engine instance holds, which is the one interference nothing downstream
  // catches (`.claude/rules/engineering.md`, *Loud or nothing*).
  if (!existsLoudUnder("tip claim", commonDir, claimPath)) return null;
  const holder = (await git.liveTipClaim(claimPath))?.pid ?? null;
  if (holder === null || holder === ownTipClaimPid) return null;
  return holder;
}
