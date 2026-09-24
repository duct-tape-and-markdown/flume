/**
 * spec/loop.md "Tip verify": the two checks a tick takes around the trunk it
 * is about to move — whether another engine instance holds the claim on the
 * ref, and whether the commit a revert is about to reset past is still the
 * tip it was.
 *
 * Both legs reach them (`src/singletonTick.ts`, `src/waveMerge.ts`), and the
 * wave's ledger commit reaches the first one a third time, so the pair lives
 * in the file its name is rather than as two methods on the class that
 * dispatches between the legs (`.claude/rules/engineering.md`, *A module is
 * one job*). Neither reads a recorded tip: there is no expected-sha
 * bookkeeping here, only what the disk says at the moment of the check.
 */

import * as git from "./git.js";

/**
 * spec/loop.md "Tip verify", "Harness-driven commits carry no expected-tip
 * bookkeeping — the claim refuses, git arbitrates": the wave's two
 * harness-driven commit sites (the per-entry cherry-pick, and
 * `commitPendingUpdate`'s ledger commit) ask this instead of comparing an
 * expected sha. A live claim on the ref HEAD currently resolves to is a
 * concurrent engine instance — the one interference no cherry-pick/conflict
 * check can catch on its own, since two engines can each cherry-pick a
 * distinct, individually-clean commit onto the same tip. No live claim
 * means whatever moved the ref was not an engine (`spec/loop.md`: "an
 * engine instance always holds the claim, an operator never does"), so the
 * caller proceeds and lets git's own conflict detection arbitrate content.
 * A detached HEAD (untracked here — `flume tick`/`flume loop` both refuse
 * it before any tick runs) reads as no claim, never a thrown error. A live
 * claim matching `ownTipClaimPid` is this run's own — not foreign — per
 * `DispatcherOptions.ownTipClaimPid`'s doc (`src/Dispatcher.ts`), which is
 * where the value comes from.
 */
export async function liveForeignClaimPid(
  cwd: string,
  ownTipClaimPid: number | undefined,
): Promise<number | null> {
  const ref = await git.currentRefPath(cwd);
  if (ref.kind !== "ref") return null;
  const commonDir = await git.gitCommonDir(cwd);
  const claimPath = git.tipClaimPath(commonDir, ref.path);
  const holder = await git.liveTipClaimPid(claimPath);
  if (holder === null || holder === ownTipClaimPid) return null;
  return holder;
}

/**
 * Tip verify's afterMerge-revert guard (spec/loop.md "Tip verify", "one
 * window stays a refusal, deliberately"). `resetKeepTo` at the caller drops
 * the span it cherry-picked onto trunk at `mergedSha` — but a gate can take
 * long enough to run that a foreign commit lands on trunk in the gap between
 * the merge and the gate failing it. That foreign commit is legal history
 * the wave would otherwise absorb (same section); resetting to `preCherry`
 * regardless would silently discard it along with the entry's own commit.
 * Returns the refusal message, naming both the merged sha the caller
 * expected and the trunk tip it actually found, when the two disagree;
 * `undefined` when `resetKeepTo` is still safe to run.
 */
export async function checkMergedTipUnmoved(
  repoRoot: string,
  preCherry: string,
  mergedSha: string,
): Promise<string | undefined> {
  const currentTip = await git.revParse(repoRoot);
  if (currentTip === mergedSha) return undefined;
  return (
    `afterMerge revert refused: trunk tip ${currentTip} is not the ` +
    `merged commit ${mergedSha} — a foreign commit landed on trunk ` +
    `after the cherry-pick; resetting to ${preCherry} would discard it`
  );
}
