/**
 * Batched merges, as the gate surface sees them (spec/worktrees.md, *Batched
 * merges*): how many finished spans one merge of a phase may carry, and the
 * context the `afterMerge` gates over such a merge are handed.
 *
 * One job, and it is the decision rather than the merge: the loop that picks
 * a batch onto the tip owns the git, and reads the width from here and builds
 * its gate context here, so the two halves of "a gate declares whether it
 * reads a batch" cannot disagree (`.claude/rules/engineering.md`, *A module
 * is one job*).
 */

import type {
  BatchGateContext,
  GateBatchSpan,
  GateSite,
} from "./Gate.js";
import type { Chain, Phase } from "./Phase.js";

/**
 * The engine's own merge width — one span per merge, the serial carry a chain
 * declaring no `supervisorPolicy.mergeBatch` gets (`Chain`, `src/Phase.ts`).
 */
const DEFAULT_MERGE_BATCH = 1;

/**
 * How many of this phase's finished spans one merge may carry on this tick.
 *
 * Two declarations have to agree before a merge carries more than one. The
 * chain raises `supervisorPolicy.mergeBatch`, and **every** `afterMerge` gate
 * of the phase declares `batches: true`: a gate written for one span would
 * read the batch's facts as one entry's, so one undeclared gate holds the
 * phase to a span per merge whatever the chain asked for. That is what the
 * declaration buys — a gate fails safe to serial merging rather than to a
 * silently wrong verdict (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * A phase with **no** `afterMerge` gate batches at the declared width: there
 * is no reader to misread the batch, and holding it back would price an
 * empty gate list like a single-span one. Spelled here rather than inherited
 * from `every`'s vacuous truth, and pinned in its own case
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 *
 * Read off the tick's own resolved chain at the point of use, like the
 * other per-tick knobs in the block: the dispatcher reloads `chain.ts` every
 * tick, so there is nothing a bind-once would buy.
 */
export function mergeBatchWidth(chain: Chain, phase: Phase): number {
  const declared = chain.supervisorPolicy?.mergeBatch ?? DEFAULT_MERGE_BATCH;
  if (declared <= DEFAULT_MERGE_BATCH) return DEFAULT_MERGE_BATCH;
  const reads = phase.gates
    .filter((gate) => gate.when === "afterMerge")
    .every((gate) => gate.batches === true);
  return reads ? declared : DEFAULT_MERGE_BATCH;
}

/**
 * The context a batch's `afterMerge` gates read, from the spans the merge
 * carried and the placement they are judged at.
 *
 * Everything that varies per span stays on the span record; what the gates
 * are handed at the top level is what holds over the whole merge, computed
 * from those records rather than restated beside them
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*):
 *
 * - `commitSha` is the batch's last pick, which is the tip the gates run over.
 * - `touchedPaths` is the union of the spans' own, first-seen order kept, so
 *   a path two spans edited is named once and a path-keyed gate still sees
 *   every edit in the tree it is reading.
 *
 * `entry`, `steps`, `baseSha` and `landedOnSha` are withheld by the shape
 * itself ({@link BatchGateContext}), so there is no last-pick value for a gate
 * to read as the batch's — an assignment least of all, since the entry a
 * path-keyed gate would read it for is one of N the merge carried.
 *
 * An empty batch throws rather than composing a context with no tip: a merge
 * that carried no span runs no gate, so reaching here with none is the
 * caller's bug and not a verdict to report (`.claude/rules/engineering.md`,
 * *Loud or nothing*).
 */
export function batchGateContext(
  at: GateSite,
  spans: readonly GateBatchSpan[],
): BatchGateContext {
  const last = spans[spans.length - 1];
  if (last === undefined) {
    throw new Error(
      `cannot build a batch gate context for phase '${at.phaseName}' from no ` +
        `spans: a merge that carried nothing has no tip to gate`,
    );
  }
  const union = new Set<string>();
  for (const span of spans) {
    for (const path of span.touchedPaths) union.add(path);
  }
  return {
    ...at,
    batch: spans,
    commitSha: last.commitSha,
    touchedPaths: [...union],
  };
}
