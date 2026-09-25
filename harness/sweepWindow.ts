/**
 * The sweep slice's window (`spec/harness.md`, *The phases*): the declared
 * sweep-domain paths the commits past `sweptThrough` touched, the posture
 * pages among them, and the lines the spec locus no longer states — the
 * retired-claim delta.
 *
 * **The frontier is a set of paths, not a walk of commits.** A path is in it
 * or it is not, so it is named once however many commits of the range touched
 * it; the commits are a count. A rotation that stays open across hundreds of
 * commits otherwise pays for each of them again every tick, for a listing
 * whose subjects and shas nothing downstream reads.
 *
 * **What this window looks at is declared, never assumed.** The frontier is
 * `slices.sweep`'s own domain and posture pages, judged by the engine's own
 * `matchesAny`, so the declaration is read in exactly one dialect and git is
 * never handed a second one to reinterpret (`gitRange.ts`).
 *
 * **One derivation, two readers.** The wake set asks whether the frontier moved
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
  type DeletedPage,
  type RangeCommit,
} from "./gitRange.js";
import { readPlanStateBounded } from "./planState.js";
import {
  SLICE_DATA_KEYS,
  budgetOf,
  queueResolved,
  type PlanSliceWindow,
  type PlanSliceWindowsOptions,
  type SliceArgs,
  type WindowContext,
} from "./sliceWindow.js";

/**
 * The sweep slice's window.
 *
 * **Live on its own work, and on nothing about the queue.** An armed
 * frontier or an open rotation opens it; what the queue carries never
 * closes it. The sweep is its own worker and runs beside build whenever the
 * supervisor's budget has room, so scheduling it is the budget's decision
 * and the declared order's — the package declares the sweep last of the
 * slices for exactly that, which is what keeps insurance behind product
 * without any window standing aside (`.claude/rules/posture-sweep.md`, *The
 * sweep runs beside build, never ahead of it*; `chain.ts`). An open rotation
 * is open exactly while a frontier it already drew has neighborhoods left in
 * it, and closing one is the slice's own job.
 *
 * **A state file this slice cannot read leaves it live.** The rotation read is
 * bounded ({@link readPlanStateBounded}, `planState.ts`), because a throw here
 * is a throw out of the wake set that walks every slice: no phase is woken,
 * build included, and the tick that would have rewritten the file is the one
 * declined. Live instead, and the render refuses on the same failure by name
 * (`bounded`, `cursorWindow.ts`), so the degraded leg is bounded by a refusal
 * the woken agent reads (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * One leg does shut it: a queue that did not parse, so the tick goes to the
 * slice whose rewrite is the repair rather than to a sweep that would file
 * its findings into a queue derived from nothing (`queueResolved`,
 * `sliceWindow.ts`). Nothing is lost by it — the cursor and the rotation are
 * this slice's own state file, untouched by a tick the sweep did not take.
 */
export function sweepWindow(options: PlanSliceWindowsOptions): PlanSliceWindow {
  const { domain, posturePages } = sweepInputs(options.declaration);
  const frontier = [...domain, ...posturePages];
  return {
    name: "plan-sweep",
    live: (inputs) => {
      if (!queueResolved(inputs)) return false;
      const state = readPlanStateBounded(inputs.flumeDir, "plan-sweep");
      if (state.failure !== undefined) return true;
      if (state.read === undefined) return true;
      if (state.read.rotation.kind === "open") return true;
      return touchedPast(options.repoRoot, state.read.sweptThrough, frontier);
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

    const lines = frontierListing(cursor, touching, domain, posturePages);

    lines.push(
      "",
      `=== lines the spec locus no longer states since ${cursor} ` +
        `(retired-claim delta) ===`,
    );
    const retired = retiredLines(ctx.cwd, cursor, all, locus);
    if (retired.length === 0) {
      lines.push("(none)");
    } else {
      lines.push(...retiredBlock(retired, budget));
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
 * The paths a range touched that a glob list names — each once, in one order.
 *
 * The union, not the walk: a path is in the frontier or it is not, and how
 * many commits of the range happened to touch it changes nothing a sweep tick
 * decides (`.claude/rules/posture-sweep.md`, *The frontier is decidable; the
 * neighborhood is judged*). Sorted rather than left in git's commit order, so
 * a reader scanning the listing gets a module beside its siblings and the same
 * range renders the same listing whatever order the commits landed in.
 */
const unionOf = (
  commits: readonly RangeCommit[],
  globs: string[],
): string[] =>
  [...new Set(commits.flatMap((commit) => pathsIn(commit, globs)))].sort();

/**
 * The frontier, as the two things a sweep tick decides from it: which domain
 * paths the range touched, and whether the range touched a posture page at
 * all.
 *
 * The second is called out on its own because it is not one more frontier
 * path — a touched posture page is a phrase delta, and a phrase delta puts
 * *every* domain module in the frontier however few paths the listing above
 * it carries. Folding the pages into the path union would render that as a
 * one-line addition to a list, which is the opposite of what it means.
 */
function frontierListing(
  cursor: string,
  touching: readonly RangeCommit[],
  domain: string[],
  posturePages: string[],
): string[] {
  const paths = unionOf(touching, domain);
  const pages = unionOf(touching, posturePages);
  return [
    `=== ${paths.length} sweep-domain path(s) touched since ${cursor}, by ` +
      `${touching.length} commit(s) ===`,
    ...(paths.length === 0 ? ["(none)"] : paths),
    "",
    `=== ${pages.length} posture page(s) touched in the same range; a ` +
      `touched page is a phrase delta, which puts every sweep-domain module ` +
      `in the frontier ===`,
    ...(pages.length === 0 ? ["(none)"] : pages),
  ];
}

/**
 * The spec-locus lines deleted across the window — the sentences a doc
 * comment, a docs page or a README section may still assert
 * (`.claude/rules/posture-sweep.md`, *The frontier is decidable; the
 * neighborhood is judged*).
 *
 * The paths are the locus paths the range touched, so the diff is narrowed to
 * files the window actually names rather than to the whole locus.
 */
function retiredLines(
  cwd: string,
  cursor: string,
  all: readonly RangeCommit[],
  locus: string[],
): DeletedPage[] {
  return deletedLines(cwd, cursor, unionOf(all, locus));
}

/**
 * The retired-claim delta's lines, each under the locus page it left.
 *
 * **The page is half of what a line says.** The frontier this delta arms is
 * every site that may still assert the claim, and a tick draws it by
 * searching the deleted line's key phrases — but whether a line is a retired
 * claim at all, rather than a heading the same commit reworded a few lines
 * down, is decidable only against the page it left. Rendered flat, that
 * costs the tick a second diff over the locus to recover a fact this window
 * already read (`.claude/rules/posture-sweep.md`, *The frontier is
 * decidable; the neighborhood is judged*).
 *
 * The budget is spent on deleted lines, never on the page leads that carry
 * them: a page whose lines do not all fit renders the prefix that does, and
 * the count below names every line no page here shows — so a rotation wide
 * enough to truncate still reports its own size honestly.
 */
function retiredBlock(pages: readonly DeletedPage[], budget: number): string[] {
  const total = pages.reduce((n, page) => n + page.lines.length, 0);
  const lines: string[] = [];
  let used = 0;
  for (const page of pages) {
    if (used >= budget) break;
    const shown = page.lines.slice(0, budget - used);
    lines.push(`=== deleted from ${page.path} ===`, ...shown);
    used += shown.length;
  }
  if (total > used) {
    lines.push(
      `=== ${total - used} further deleted line(s) beyond this tick's ` +
        `budget; narrow the range by closing this rotation ===`,
    );
  }
  return lines;
}
