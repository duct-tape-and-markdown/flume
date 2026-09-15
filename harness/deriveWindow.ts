/**
 * The derive slice's window (`spec/harness.md`, *The phases*): the commits
 * past `derivedThrough` that touched the declared spec locus, rendered
 * oldest-first with their diffs.
 *
 * **What this window looks at is declared, never assumed.** The locus is the
 * one declared list of where the contract lives — the same list the `per` gate
 * resolves a cite against — so a path is judged here by exactly what a cite is
 * judged by.
 *
 * **One derivation, two readers.** The ladder asks whether the locus moved
 * past the cursor; the prompt asks what moved. Both come off the same scan
 * (`gitRange.ts`), so the slice cannot be woken over a window its prompt then
 * renders as empty (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*).
 *
 * The three states a cursor itself can be in — no artifact yet, a cursor
 * naming no commit, a tree git will not read — are `cursorWindow.ts`'s, shared
 * with the sweep.
 */

import { cursorWindow } from "./cursorWindow.js";
import { diffPrefix, touchedPast, touches } from "./gitRange.js";
import { readPlanState } from "./planState.js";
import {
  SLICE_DATA_KEYS,
  budgetOf,
  type PlanSliceWindow,
  type PlanSliceWindowsOptions,
  type SliceArgs,
  type WindowContext,
} from "./sliceWindow.js";

/**
 * The derive slice's window.
 *
 * Live exactly while the locus set past the cursor is non-empty. The commits
 * landed alongside are listed but never make the window live — a build commit
 * is not a spec change, and waking derive on one would spend a tick to
 * re-stamp the cursor.
 */
export function deriveWindow(
  options: PlanSliceWindowsOptions,
): PlanSliceWindow {
  const locus = options.declaration.specLocus;
  return {
    name: "plan-derive",
    live: ({ flumeDir }) => {
      const cursor = readPlanState(flumeDir)?.derivedThrough;
      if (cursor === undefined) return true;
      return touchedPast(options.repoRoot, cursor, locus);
    },
    args: (ctx): SliceArgs<"plan-derive"> => ({
      SPEC_WINDOW: renderSpecWindow(ctx, options),
    }),
    dataKeys: SLICE_DATA_KEYS["plan-derive"],
  };
}

/**
 * The rendered derive window: every commit in the range named, the ones in the
 * locus marked, and as many of their diffs as this tick's budget carries.
 *
 * **The window is rendered whole, or an oldest-first prefix of it.** A prefix
 * that fits the budget is rendered in full, the sha its cursor may advance to
 * is named, and the commits past the budget are listed so the next tick picks
 * them up — a window larger than one tick is progress, not a wall.
 */
function renderSpecWindow(
  ctx: WindowContext,
  options: PlanSliceWindowsOptions,
): string {
  const locus = options.declaration.specLocus;
  return cursorWindow("derivedThrough", locus, ctx, (cursor, all) => {
    const inLocus = all.filter((commit) => touches(commit, locus));
    const lines = [
      `=== ${inLocus.length} commit(s) in the spec locus since ${cursor}, ` +
        `among ${all.length} landed alongside ===`,
    ];
    const marked = new Set(inLocus.map((commit) => commit.sha));
    for (const commit of all) {
      lines.push(
        `${marked.has(commit.sha) ? "spec " : "     "}${commit.sha} ${commit.subject}`,
      );
    }
    lines.push("");

    if (inLocus.length === 0) {
      lines.push("(no spec changes since the cursor)");
      return lines.join("\n");
    }

    const prefix = diffPrefix(ctx.cwd, inLocus, locus, budgetOf(options));
    lines.push(...prefix.rendered, "");
    lines.push(
      `=== rendered ${prefix.count} commit(s) in full; \`derivedThrough\` ` +
        `may advance to ${prefix.advance} ===`,
    );
    if (prefix.deferred.length > 0) {
      lines.push(
        `=== ${prefix.deferred.length} commit(s) beyond this tick's budget ` +
          `re-appear next tick: ===`,
        ...prefix.deferred.map((commit) => `${commit.sha} ${commit.subject}`),
      );
    }
    return lines.join("\n");
  });
}
