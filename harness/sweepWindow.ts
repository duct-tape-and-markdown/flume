/**
 * The sweep slice's window (`spec/harness.md`, *The phases*): the commits past
 * `sweptThrough` that touched the declared sweep domain or a posture page,
 * plus the lines the spec locus no longer states — the retired-claim delta.
 *
 * **What this window looks at is declared, never assumed.** The frontier is
 * `slices.sweep`'s own domain and posture pages, judged by the engine's own
 * `matchesAny`, so the declaration is read in exactly one dialect and git is
 * never handed a second one to reinterpret (`gitRange.ts`).
 *
 * **One derivation, two readers.** The ladder asks whether the frontier moved
 * past the cursor; the prompt asks what moved and what the window retired.
 * Both come off the same scan (`.claude/rules/engineering.md`, *Derived state
 * is computed, never restated beside its source*).
 *
 * The three states a cursor itself can be in are `cursorWindow.ts`'s, shared
 * with the derive.
 */

import { matchesAny } from "../src/paths.js";

import { cursorWindow } from "./cursorWindow.js";
import type { Declaration } from "./declaration.js";
import {
  deletedLines,
  touchedPast,
  touches,
  type RangeCommit,
} from "./gitRange.js";
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
 * The sweep slice's window.
 *
 * Yields first. While the queue carries a pickable entry the window is
 * closed whatever is in it, because the sweep is insurance and shipped
 * entries are the product; the frontier is deferred, never lost
 * (`.claude/rules/posture-sweep.md`, *The sweep yields to pickable work*).
 * An open rotation then holds it live on its own: a rotation is open exactly
 * while a frontier it already drew has neighborhoods left in it, and closing
 * one is the slice's own job.
 */
export function sweepWindow(options: PlanSliceWindowsOptions): PlanSliceWindow {
  const { domain, posturePages } = sweepInputs(options.declaration);
  const frontier = [...domain, ...posturePages];
  return {
    name: "plan-sweep",
    live: ({ flumeDir, pickable }) => {
      if (pickable) return false;
      const state = readPlanState(flumeDir);
      if (state === undefined) return true;
      if (state.rotation.kind === "open") return true;
      return touchedPast(options.repoRoot, state.sweptThrough, frontier);
    },
    args: (ctx): SliceArgs<"plan-sweep"> => ({
      SWEEP_WINDOW: renderSweepWindow(ctx, options),
    }),
    dataKeys: SLICE_DATA_KEYS["plan-sweep"],
  };
}

/**
 * The declared sweep inputs, or a refusal naming the field.
 *
 * The declaration's schema already refuses `plan-sweep` enabled without
 * them, so this is unreachable from a parsed declaration; it is here because
 * the field is optional in the *type*, and narrowing it with a non-null
 * assertion would be the same claim with nothing behind it if the schema's
 * refinement were ever relaxed.
 */
function sweepInputs(declaration: Declaration): {
  domain: string[];
  posturePages: string[];
} {
  const sweep = declaration.slices.sweep;
  if (sweep === undefined) {
    throw new Error(
      "the sweep slice is enabled with no `slices.sweep` declared, so its " +
        "window has no domain to draw a frontier over (spec/harness.md, " +
        "What a consumer declares)",
    );
  }
  return sweep;
}

/**
 * The rendered sweep window, ending in the tip its frontier was drawn from.
 *
 * **The window names its own tip.** The frontier is re-derived every tick
 * against whatever the tree's tip is, so the sha a closing tick may stamp is
 * a fact this render already holds — the last commit of the range it just
 * scanned, or the cursor itself when the range is empty. Naming it here is
 * what lets the closing tick stamp exactly the tip its frontier covered
 * rather than resolving a HEAD that moved while it read
 * (`.claude/rules/posture-sweep.md`, *The stamp*). It is the sibling of the
 * `may advance to` line the derive window ends on, and costs no second git
 * call.
 */
function renderSweepWindow(
  ctx: WindowContext,
  options: PlanSliceWindowsOptions,
): string {
  // `sweepInputs` reads the declaration, not the tree: its throw is the
  // unconstructable-declaration guard, which the bound inside `cursorWindow` —
  // the tree's own failures alone — deliberately does not swallow.
  const { domain, posturePages } = sweepInputs(options.declaration);
  const locus = options.declaration.specLocus;
  const budget = budgetOf(options);
  const frontier = [...domain, ...posturePages];

  return cursorWindow("sweptThrough", frontier, ctx, (cursor, all) => {
    const touching = all.filter((commit) => touches(commit, frontier));

    const lines = [
      `=== ${touching.length} commit(s) since ${cursor} touching the sweep ` +
        `domain or a posture page ===`,
    ];
    if (touching.length === 0) lines.push("(none)");
    for (const commit of touching) {
      lines.push(`${commit.sha} ${commit.subject}`);
      for (const path of pathsIn(commit, frontier)) lines.push(`  ${path}`);
    }

    lines.push(
      "",
      `=== lines the spec locus no longer states since ${cursor} ` +
        `(retired-claim delta) ===`,
    );
    const retired = retiredLines(ctx.cwd, cursor, all, locus);
    if (retired.length === 0) {
      lines.push("(none)");
    } else {
      lines.push(...retired.slice(0, budget));
      if (retired.length > budget) {
        lines.push(
          `=== ${retired.length - budget} further deleted line(s) beyond this ` +
            `tick's budget; narrow the range by closing this rotation ===`,
        );
      }
    }

    const tip = all.at(-1)?.sha ?? cursor;
    lines.push(
      "",
      `=== this window was drawn from tip ${tip}; the tick that closes the ` +
        `rotation stamps \`sweptThrough\` at exactly that sha ===`,
    );
    return lines.join("\n");
  });
}

/** The paths a commit touched that a glob list names. */
const pathsIn = (commit: RangeCommit, globs: string[]): readonly string[] =>
  commit.paths.filter((path) => matchesAny(path, globs));

/**
 * The spec-locus lines deleted across the window — the sentences a doc
 * comment, a docs page or a README section may still assert
 * (`.claude/rules/posture-sweep.md`, *The frontier is decidable*).
 *
 * The paths are the locus paths the range touched, so the diff is narrowed to
 * files the window actually names rather than to the whole locus.
 */
function retiredLines(
  cwd: string,
  cursor: string,
  all: readonly RangeCommit[],
  locus: string[],
): string[] {
  const paths = [...new Set(all.flatMap((commit) => pathsIn(commit, locus)))];
  return deletedLines(cwd, cursor, paths);
}
