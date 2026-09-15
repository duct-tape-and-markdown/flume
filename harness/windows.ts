/**
 * The plan slices' windows (`spec/harness.md`, *The phases*) — for each
 * slice the package ships, the predicate that says whether its window is
 * open, and the prompt argument that renders the window's material.
 *
 * **One derivation per window, two readers.** The ladder asks "is this slice
 * live"; the slice's prompt asks "what is in it". Both answers come from the
 * same scan here, so a slice cannot be woken over a window its prompt then
 * renders as empty, nor render material the ladder never counted
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * **The cursors are fields, never prose.** `derivedThrough`, `sweptThrough`
 * and the rotation arrive through {@link readPlanState}; nothing here
 * regexes a sha out of a narrative document (`spec/harness.md`, *Plan state
 * as declared state*).
 *
 * **What each window looks at is declared, never assumed.** The derive
 * window is the commits past its cursor touching `specLocus` — the one
 * declared list of where the contract lives, the same list the `per` gate
 * resolves a cite against. The sweep window is `slices.sweep`'s own domain
 * and posture pages. A path is judged against those globs by the engine's
 * own `matchesAny`, so the declaration is read in exactly one dialect and
 * git is never handed a second one to reinterpret.
 *
 * **The window is rendered whole, or an oldest-first prefix of it.** A
 * truncated preview is the shape this replaces: too big to be a pointer, too
 * small to be the material. A prefix that fits the tick's line budget is
 * rendered in full, the sha its cursor may advance to is named, and the
 * commits past the budget are listed so the next tick picks them up — a
 * window larger than one tick is progress, not a wall.
 *
 * **A range that cannot be read refuses, in the window itself.** A cursor
 * naming no commit, or any git failure under the render, means the window
 * cannot be computed, so the slice is woken carrying a refusal that names
 * what failed and forbids advancing anything. The degraded path is declared
 * and bounded rather than silently reporting an empty delta, which would
 * advance a cursor over commits nobody read
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * This module is the windows alone. Which slices a consumer enabled, what
 * order the ladder consults them in, and how a window's arg reaches a prompt
 * belong to the declaration, `handoff.ts` and the chain factory that reads
 * this.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { literalPathspecEnv, nameOnlyPaths } from "../src/git.js";
import type { PendingEntry } from "../src/PendingSchema.js";
import { matchesAny, slugify } from "../src/paths.js";
import type { PriorAttempt } from "../src/Prompt.js";

import {
  INBOX_PHASE,
  PLAN_SLICES,
  type Declaration,
  type PlanSlice,
} from "./declaration.js";
import {
  PLAN_RESOLVES_MERGE,
  PLAN_RESOLVES_NO_COMMIT,
  type HandoffSlice,
  type SliceWindow,
} from "./handoff.js";
import { planStatePath, readPlanState, type PlanState } from "./planState.js";
import { recordFiles, recordsPending } from "./records.js";

/**
 * How many lines of diff one window renders before deferring the rest to the
 * next tick.
 *
 * The package's value, like the record cap in `records.ts` and for the same
 * reason: the budget bounds a prompt the package wrote, so it is the
 * package's to size, not a declaration knob a consumer discovers by finding
 * a tick that ran out of context.
 */
export const WINDOW_LINE_BUDGET = 1200;

/**
 * What a slice's liveness predicate reads — the two facts every tick reports
 * ({@link SliceWindow}), plus the two only a `shouldRun` consult is handed.
 *
 * `pending` and `priorAttempts` are `TickContext`'s own fields, and they are
 * optional here because the handoff has neither: a `TickResult` reports no
 * record set at all. Their absence reads as "no standing refusal", which is
 * the answer the ladder wants — a standing record is a reason to be *woken*,
 * never a reason a slice re-wakes itself, since only a build wave clears
 * one. Nothing is lost by it: the build tick that *produced* the refusal
 * routes it through the handoff's own refusal leg (`handoff.ts`), reading
 * the same classification this module reads.
 */
export interface SliceInputs extends SliceWindow {
  /** The queue as the tick sees it — `TickContext.pending`. */
  readonly pending?: readonly PendingEntry[] | undefined;
  /** Standing prior-attempt records — `TickContext.priorAttempts`. */
  readonly priorAttempts?: ReadonlyMap<string, PriorAttempt> | undefined;
}

/**
 * What rendering a window reads: the tick's own tree, its state root, and
 * the same two optional facts {@link SliceInputs} names.
 *
 * Shaped so a `TickContext` satisfies it as given — the chain factory hands
 * `ctx` straight through rather than unpacking it into a second vocabulary
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*). `cwd`
 * is the tick's provisioned worktree, so git reads the tree the agent is
 * about to work in rather than whatever a sibling wave left at the repo
 * root.
 */
export interface WindowContext {
  /** The tick's working tree — `TickContext.cwd`. */
  readonly cwd: string;
  /** The tick's resolved state root — `TickContext.flumeDir`. */
  readonly flumeDir: string;
  /** The queue as the tick sees it — `TickContext.pending`. */
  readonly pending?: readonly PendingEntry[] | undefined;
  /** Standing prior-attempt records — `TickContext.priorAttempts`. */
  readonly priorAttempts?: ReadonlyMap<string, PriorAttempt> | undefined;
}

/**
 * The `{{…}}` keys each slice's {@link PlanSliceWindow.args} returns.
 *
 * **Every one of them is data.** A window renders material the package did
 * not author — a record an operator left, a prior-attempt record's own JSON,
 * a spec diff, a deleted line off the retired-claim delta — and the engine's
 * renderer scans substituted text for inline-exec spans (`spec/prompt.md`,
 * *The render pipeline*). A spec diff that touches the section documenting
 * that grammar carries a span verbatim, so an undeclared key here is a plan
 * tick refused by a command the material only quoted.
 *
 * Keyed exhaustively by {@link PlanSlice} and read as each window's `args`
 * return type below, so a slice added without its keys is a typecheck
 * failure and a key added to a window without being named here is another
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
const SLICE_DATA_KEYS = {
  [INBOX_PHASE]: ["RECORDS", "BUILD_RECORDS"],
  "plan-derive": ["SPEC_WINDOW"],
  "plan-sweep": ["SWEEP_WINDOW"],
} as const satisfies Record<PlanSlice, readonly string[]>;

/** The argument map one slice's window returns. */
type SliceArgs<S extends PlanSlice> = Record<
  (typeof SLICE_DATA_KEYS)[S][number],
  string
>;

/**
 * One plan slice's window: the {@link HandoffSlice} the ladder consults, plus
 * the prompt arguments that slice's own prompt names.
 *
 * `args` returns a map rather than a single string because the inbox slice's
 * prompt names two — the records queue and the standing build refusals are
 * two separate blocks in it, and collapsing them into one arg would make the
 * prompt's two sections one the agent has to split by eye.
 */
export interface PlanSliceWindow extends HandoffSlice {
  readonly name: PlanSlice;
  readonly live: (inputs: SliceInputs) => boolean;
  /** The `{{…}}` arguments this slice's prompt is rendered with, for one tick. */
  readonly args: (ctx: WindowContext) => Record<string, string>;
  /**
   * Those same keys, for the phase to declare as `Phase.promptDataKeys` —
   * the window says what it substitutes, the engine neutralizes it, and no
   * package code touches the values on the way through.
   */
  readonly dataKeys: readonly string[];
}

/** What {@link planSliceWindows} needs to build a consumer's slice windows. */
export interface PlanSliceWindowsOptions {
  /** The consumer's validated declaration — its spec locus and its slices. */
  readonly declaration: Declaration;
  /**
   * Where a liveness predicate reads git from. The repo root, because the
   * handoff runs with no worktree of its own and a `TickResult` reports
   * none; a render reads the tick's own `cwd` instead.
   */
  readonly repoRoot: string;
  /**
   * Lines of diff one window renders before deferring the rest, defaulting
   * to {@link WINDOW_LINE_BUDGET}. A seam for a caller that must observe the
   * deferral without minting a budget-sized diff to provoke it.
   */
  readonly budget?: number | undefined;
}

/**
 * The windows for the plan slices this declaration enables, in the order
 * {@link PLAN_SLICES} lists them — which is the order the ladder consults.
 *
 * A slice the declaration did not enable is absent rather than present and
 * permanently closed: the ladder's `exclude` leg and the default handoff's
 * refusal leg both read the list they are given, and a slice that is always
 * dead reads as a phase the chain carries but never runs.
 */
export function planSliceWindows(
  options: PlanSliceWindowsOptions,
): PlanSliceWindow[] {
  const enabled = new Set<PlanSlice>(options.declaration.slices.enabled);
  return PLAN_SLICES.filter((name) => enabled.has(name)).map((name) =>
    window(name, options),
  );
}

/** One slice's window, by name. */
function window(
  name: PlanSlice,
  options: PlanSliceWindowsOptions,
): PlanSliceWindow {
  switch (name) {
    case INBOX_PHASE:
      return inboxWindow();
    case "plan-derive":
      return deriveWindow(options);
    case "plan-sweep":
      return sweepWindow(options);
  }
}

// ---------------------------------------------------------------- the inbox

/**
 * Which prior-attempt modes are standing refusals only a plan slice can
 * resolve.
 *
 * States no verdict of its own. "Can only plan resolve this" is one
 * question, and a record on disk is the same fate the tick reported, read a
 * run later — so every mode resolves through the table the build handoff
 * routes that same fate by: the four no-commit modes through
 * {@link PLAN_RESOLVES_NO_COMMIT}, and the two siblings that are merge fates
 * rather than `NoCommitMode` members through {@link PLAN_RESOLVES_MERGE},
 * which is where `TickResult` carries them (`entries[].mergeOutcome`). Both
 * rationales live at those tables (`.claude/rules/engineering.md`, *The fix
 * lands at the mechanism*).
 *
 * Exhaustive over `PriorAttempt["mode"]` by type, so a variant the engine
 * adds must be classified here rather than defaulting to "not a refusal" —
 * and each merge-fate key is indexed out of the engine's own `MergeOutcome`
 * table, so a fate that union drops is a type error rather than a verdict
 * this side goes on holding alone.
 */
const PLAN_RESOLVES_STANDING: Record<PriorAttempt["mode"], boolean> = {
  ...PLAN_RESOLVES_NO_COMMIT,
  "not-shipped": PLAN_RESOLVES_MERGE["not-shipped"],
  "tip-moved": PLAN_RESOLVES_MERGE["tip-moved"],
};

/**
 * The standing prior-attempt records that are refusals only a plan slice can
 * resolve **and** are keyed to an entry the queue still carries.
 *
 * Keyed to a live entry is the whole test: a record whose entry has left the
 * queue outlived the work it was about, and waking the inbox over it would
 * hold the slice open on nothing. The keyspace is the record's own stated
 * `key` field rather than a guess from the key's text — a stem the queue no
 * longer carries is a retired tag in one keyspace and a live phase in the
 * other (`spec/loop.md`, *No false signal*) — and the queue side is
 * slugified with the engine's own `slugify`, which is what wrote the key.
 *
 * One derivation, two readers: the window's liveness leg below counts this,
 * and the rendered build-records block marks exactly these.
 */
function standingRefusals(ctx: {
  readonly pending?: readonly PendingEntry[] | undefined;
  readonly priorAttempts?: ReadonlyMap<string, PriorAttempt> | undefined;
}): PriorAttempt[] {
  if (ctx.pending === undefined || ctx.priorAttempts === undefined) return [];
  const queued = new Set(ctx.pending.map((entry) => slugify(entry.tag)));
  return [...ctx.priorAttempts.values()].filter(
    (record) =>
      record.key === "entry" &&
      queued.has(record.keyedAs) &&
      PLAN_RESOLVES_STANDING[record.mode],
  );
}

/**
 * The inbox slice's window: the record queues, and the build refusals still
 * standing against entries the queue carries.
 *
 * Two legs because there are two ways work reaches this slice — someone left
 * a file, or a build wave walled — and either alone leaves a loop: without
 * the record leg an operator's finding is never read; without the refusal
 * leg a parked entry stays pickable, plan yields to build, and build re-parks
 * into the same wall.
 */
function inboxWindow(): PlanSliceWindow {
  return {
    name: INBOX_PHASE,
    live: (inputs) =>
      recordsPending(inputs.flumeDir) || standingRefusals(inputs).length > 0,
    args: (ctx): SliceArgs<typeof INBOX_PHASE> => ({
      RECORDS: renderRecords(ctx.flumeDir),
      BUILD_RECORDS: renderBuildRecords(ctx),
    }),
    dataKeys: SLICE_DATA_KEYS[INBOX_PHASE],
  };
}

/**
 * Every waiting record's bytes, oldest first, each under the path it sits
 * at.
 *
 * Read whole rather than previewed: a record is already bounded to
 * `RECORD_MAX_BYTES` by the gate that admitted it, so the queue's whole
 * content is the material and a head of it would be a pointer at a file the
 * slice would then have to open anyway.
 */
function renderRecords(flumeDir: string): string {
  const files = recordFiles(flumeDir);
  if (files.length === 0) return "(no records)";
  return files
    .map((file) => `--- ${file} ---\n${readFileSync(file, "utf8").trimEnd()}`)
    .join("\n\n");
}

/**
 * The standing prior-attempt records, verbatim, with the ones keyed to an
 * entry the queue still carries marked as the slice's own work.
 *
 * Rendered as the engine's own JSON rather than paraphrased per mode: the
 * records are bounded by construction — a digest, not a transcript — and a
 * per-mode renderer here would be a second vocabulary for the engine's own
 * fields, stranded by the first field it renames
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 *
 * Every record is shown, not only the marked ones: a record keyed to a phase
 * or to an entry that has left the queue is context for what the loop has
 * been doing, and the mark is what says which ones this tick must resolve.
 */
function renderBuildRecords(ctx: WindowContext): string {
  // Read off the map's values and each record's own stated identity, never
  // off the map key: how the engine composes that key is the engine's, and a
  // slice that re-spelled it here would mark the wrong records the day it
  // changed (`.claude/rules/engineering.md`, *A fact the engine holds is
  // reported, never rediscovered*).
  const records = [
    ...(ctx.priorAttempts ?? new Map<string, PriorAttempt>()).values(),
  ].sort((a, b) => {
    const left = `${a.key}:${a.keyedAs}`;
    const right = `${b.key}:${b.keyedAs}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  if (records.length === 0) return "(no standing prior-attempt records)";

  // By reference: `standingRefusals` filters the same record objects this
  // list holds, so identity is the marking test and no second key spelling
  // can drift from it.
  const standing = new Set<PriorAttempt>(standingRefusals(ctx));
  const lines = [`=== ${records.length} standing prior-attempt record(s) ===`];
  for (const record of records) {
    const mark = standing.has(record)
      ? " ← the queue still carries this entry; reconcile it"
      : "";
    lines.push(`--- ${record.keyedAs} (${record.key} keyspace)${mark} ---`);
    lines.push(JSON.stringify(record, null, 2));
  }
  return lines.join("\n");
}

// --------------------------------------------------------------- the derive

/**
 * The derive slice's window: the commits past `derivedThrough` that touched
 * the declared spec locus, rendered oldest-first with their diffs.
 *
 * Live exactly while that set is non-empty. The commits landed alongside are
 * listed but never make the window live — a build commit is not a spec
 * change, and waking derive on one would spend a tick to re-stamp the cursor.
 */
function deriveWindow(options: PlanSliceWindowsOptions): PlanSliceWindow {
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

function renderSpecWindow(
  ctx: WindowContext,
  options: PlanSliceWindowsOptions,
): string {
  return bounded("derivedThrough", ctx, () => specWindow(ctx, options));
}

function specWindow(
  ctx: WindowContext,
  options: PlanSliceWindowsOptions,
): string {
  const locus = options.declaration.specLocus;
  const state = readPlanState(ctx.flumeDir);
  if (state === undefined) return bootstrap("derivedThrough", ctx, locus);

  const cursor = state.derivedThrough;
  if (!resolves(ctx.cwd, cursor)) {
    return unresolvedCursor("derivedThrough", cursor, ctx.flumeDir);
  }

  const all = commitsPast(ctx.cwd, cursor);
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

  const prefix = renderPrefix(ctx.cwd, inLocus, locus, budgetOf(options));
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
}

// ---------------------------------------------------------------- the sweep

/**
 * The sweep slice's window: the commits past `sweptThrough` that touched the
 * declared sweep domain or a posture page, plus the lines the spec locus no
 * longer states — the retired-claim delta.
 *
 * Yields first. While the queue carries a pickable entry the window is
 * closed whatever is in it, because the sweep is insurance and shipped
 * entries are the product; the frontier is deferred, never lost
 * (`.claude/rules/posture-sweep.md`, *The sweep yields to pickable work*).
 * An open rotation then holds it live on its own: a rotation is open exactly
 * while a frontier it already drew has neighborhoods left in it, and closing
 * one is the slice's own job.
 */
function sweepWindow(options: PlanSliceWindowsOptions): PlanSliceWindow {
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
  // unconstructable-declaration guard, which the bound below — the tree's
  // own failures alone — deliberately does not swallow.
  const inputs = sweepInputs(options.declaration);
  return bounded("sweptThrough", ctx, () =>
    sweepWindowOf(ctx, options, inputs),
  );
}

function sweepWindowOf(
  ctx: WindowContext,
  options: PlanSliceWindowsOptions,
  { domain, posturePages }: { domain: string[]; posturePages: string[] },
): string {
  const locus = options.declaration.specLocus;
  const state = readPlanState(ctx.flumeDir);
  if (state === undefined) {
    return bootstrap("sweptThrough", ctx, [...domain, ...posturePages]);
  }

  const cursor = state.sweptThrough;
  if (!resolves(ctx.cwd, cursor)) {
    return unresolvedCursor("sweptThrough", cursor, ctx.flumeDir);
  }

  const budget = budgetOf(options);
  const frontier = [...domain, ...posturePages];
  const all = commitsPast(ctx.cwd, cursor);
  const touching = all.filter((commit) => touches(commit, frontier));

  const lines = [
    `=== ${touching.length} commit(s) since ${cursor} touching the sweep ` +
      `domain or a posture page ===`,
  ];
  if (touching.length === 0) lines.push("(none)");
  for (const commit of touching) {
    lines.push(`${commit.sha} ${commit.subject}`);
    for (const path of commit.paths.filter((p) => matchesAny(p, frontier))) {
      lines.push(`  ${path}`);
    }
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
}

/**
 * The spec-locus lines deleted across the window — the sentences a doc
 * comment, a docs page or a README section may still assert
 * (`.claude/rules/posture-sweep.md`, *The frontier is decidable*).
 *
 * Read off one diff over the whole range rather than per commit: a line
 * added and then deleted inside the window was never a claim the tree
 * carries, and a per-commit walk would file it as retired.
 */
function retiredLines(
  cwd: string,
  cursor: string,
  all: readonly RangeCommit[],
  locus: string[],
): string[] {
  const paths = [
    ...new Set(
      all.flatMap((commit) =>
        commit.paths.filter((path) => matchesAny(path, locus)),
      ),
    ),
  ];
  if (paths.length === 0) return [];
  return git(cwd, ["diff", `${cursor}..HEAD`, "--", ...paths])
    .split("\n")
    .filter((line) => line.startsWith("-") && !line.startsWith("---"));
}

// ------------------------------------------------------------ shared render

/** The tick's line budget, defaulting to the package's own value. */
const budgetOf = (options: PlanSliceWindowsOptions): number =>
  options.budget ?? WINDOW_LINE_BUDGET;

/**
 * The window a state root with no artifact yet opens over: everything the
 * globs name, read in full, ending on the tip the cursor is stamped at.
 *
 * Absence is the first tick's real state, not a degradation — a consumer
 * whose state root was just written has no cursor, and the only honest
 * window over "nothing has been derived" is the whole corpus
 * (`planState.ts`).
 *
 * **The tip is named here, not rediscovered by the tick.** A window that
 * said "stamp HEAD" would have the stamping tick resolve its own sha, so a
 * commit landing mid-tick would be stamped over unread
 * (`.claude/rules/posture-sweep.md`, *The stamp*). The tip is resolved
 * before the listing rather than after, so anything that lands while this
 * reads is at worst listed and not yet stamped — re-opened next tick, never
 * skipped.
 */
function bootstrap(
  field: keyof PlanState,
  ctx: WindowContext,
  globs: string[],
): string {
  const tip = git(ctx.cwd, ["rev-parse", "HEAD"]).trim();
  const files = nameOnlyPaths(git(ctx.cwd, ["ls-files", "-z"])).filter((path) =>
    matchesAny(path, globs),
  );
  return [
    `(bootstrap: no \`${field}\` yet — the whole of the declared paths is ` +
      `the window; read every file below)`,
    ...files,
    "",
    `=== this window was drawn from tip ${tip}; the tick that closes it ` +
      `stamps \`${field}\` at exactly that sha ===`,
  ].join("\n");
}

/**
 * The window an unreadable range opens over: nothing, loudly.
 *
 * Rendered into the prompt rather than thrown out of it, and that is
 * deliberate. A throw here kills the tick before any agent runs — the engine
 * invokes `promptArgs` uncaught — so the tick ends with no verdict and the
 * next one is woken over the same unreadable tree with nothing said. The
 * refusal instead reaches the woken slice, naming what could not be read and
 * forbidding any cursor advance in the meantime
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
const refusal = (cause: string, repair: string): string =>
  `REFUSE: ${cause}, so this window cannot be computed. Process nothing and ` +
  `advance no cursor this tick; ${repair}`;

/** The refusal a cursor that names no commit in this tree renders. */
const unresolvedCursor = (
  field: keyof PlanState,
  cursor: string,
  flumeDir: string,
): string =>
  refusal(
    `\`${field}\` is \`${cursor}\`, which does not resolve to a commit in ` +
      `this tick's tree`,
    `repair \`${field}\` in ${planStatePath(flumeDir)} and say in the ` +
      `commit body what it was and what you set it to.`,
  );

/**
 * The bound {@link touchedPast}'s fail-open already promises: every way a
 * render reads the tree — the bootstrap listing, the range scan, a commit's
 * diff, the retired-claim diff — arrives here as the named refusal rather
 * than as a throw out of `promptArgs`. Not git's failures alone, because a
 * refusal that classified what it caught would be guessing at a cause it
 * was never told; the failure's own text is carried instead.
 *
 * The cursor is untouched by a failure this side of the render, so the
 * window re-opens over the same range next tick; the tick that was woken
 * says what it saw instead of dying silently.
 */
function bounded(
  field: keyof PlanState,
  ctx: WindowContext,
  render: () => string,
): string {
  try {
    return render();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return refusal(
      `the \`${field}\` window could not be read: ${text.trim()}`,
      `say in the commit body what failed; \`${field}\` in ` +
        `${planStatePath(ctx.flumeDir)} is untouched, so the window re-opens ` +
        `over the same range next tick.`,
    );
  }
}

/**
 * The oldest-first prefix of `commits` whose diffs fit `budget` lines, the
 * sha the cursor may advance to, and the commits deferred past it.
 *
 * The first commit renders whatever its size: a diff larger than the whole
 * budget would otherwise defer itself forever, and a window that can never
 * advance is a loop, not a bound.
 */
function renderPrefix(
  cwd: string,
  commits: readonly RangeCommit[],
  globs: string[],
  budget: number,
): {
  rendered: string[];
  deferred: RangeCommit[];
  count: number;
  advance: string | undefined;
} {
  const rendered: string[] = [];
  const deferred: RangeCommit[] = [];
  let used = 0;
  let count = 0;
  let advance: string | undefined;
  let stopped = false;

  for (const commit of commits) {
    if (stopped) {
      deferred.push(commit);
      continue;
    }
    const diff = diffOf(cwd, commit, globs).trimEnd();
    const height = diff.split("\n").length;
    if (count > 0 && used + height > budget) {
      stopped = true;
      deferred.push(commit);
      continue;
    }
    rendered.push(diff, "");
    used += height;
    count += 1;
    advance = commit.sha;
  }
  return { rendered, deferred, count, advance };
}

/** One commit's diff, narrowed to the paths in it the window's globs match. */
function diffOf(
  cwd: string,
  commit: RangeCommit,
  globs: string[],
): string {
  const paths = commit.paths.filter((path) => matchesAny(path, globs));
  return git(cwd, [
    "show",
    "--stat",
    "-p",
    commit.sha,
    "--",
    ...paths,
  ]);
}

// --------------------------------------------------------------------- git

/** One commit in a window's range, with the paths it touched. */
interface RangeCommit {
  readonly sha: string;
  readonly subject: string;
  readonly paths: readonly string[];
}

/**
 * Record and field separators — control bytes a commit subject does not
 * carry in practice, so a message with a newline or a tab in it cannot be
 * read as a second commit.
 *
 * NUL is not among them: under `-z` git terminates its own `--format` output
 * with it, so the header's end is read off git's terminator ({@link
 * HEADER_END}) rather than off a byte this module chose, and only the record
 * boundary is ours to spell. A subject that did carry `\x1e` splits one
 * record into two, which costs the render a sha git cannot resolve — a
 * throw {@link bounded} names, never a silently wrong window
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Emitted by git's own `%xNN` escape rather than written into the argument,
 * matching the terminator's own encoding at the one place both are read.
 */
const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";
const RECORD_SEP_FMT = "%x1e";
const FIELD_SEP_FMT = "%x1f";

/**
 * The NUL `-z` puts after the `--format` output, and the newline git writes
 * between that and a commit's file listing. A commit that touched nothing
 * has the terminator and no newline after it.
 */
const HEADER_END = "\0";
const LISTING_LEAD = "\n";

/** Enough headroom for a window-sized diff on stdout. */
const MAX_BUFFER = 64 << 20;

/**
 * Every window read, under one pathspec dialect.
 *
 * The paths these reads narrow by come straight from git's own
 * `--name-only` output, so a filename carrying `*`, `?`, `[` or a leading
 * `:` would otherwise be re-read as a glob or as pathspec magic and the
 * narrowed diff would quietly show the wrong files. `literalPathspecEnv`
 * (`src/git.ts`) is the engine's one spelling of that refusal, shared rather
 * than re-derived here (`.claude/rules/engineering.md`, *The fix lands at
 * the mechanism*); it replaces a local `:(top,literal)` prefix whose `top`
 * leg anchored nothing, since `cwd` is the tick's working tree root and
 * these paths are already relative to it.
 *
 * `core.quotePath=false` buys only the patch text the renders paste into the
 * prompt, and only its non-ASCII case: a `+++ b/<path>` header naming a
 * UTF-8 filename reads as the filename rather than as escaped octal. A
 * control character stays quoted there regardless. It is not what makes a
 * *listing* faithful — every path this module goes on to judge or hand back
 * to git is read `-z` and decoded by {@link nameOnlyPaths}, which is the one
 * form quoting cannot reach (`src/git.ts`).
 */
function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    env: literalPathspecEnv(),
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Whether `sha` names a commit in the tree at `cwd`. */
function resolves(cwd: string, sha: string): boolean {
  try {
    git(cwd, ["rev-parse", "--verify", "-q", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every commit past `cursor`, oldest first, each with the paths it touched.
 *
 * One scan serves both readers: the liveness predicates ask whether any of
 * these paths matches their globs, and the renders ask which ones and for
 * their diffs. Paths are judged in this package by the engine's `matchesAny`
 * rather than handed to git as a pathspec, so a declared glob is read in one
 * dialect — git's own pathspec globbing agrees with `matchesAny` on the
 * common cases and diverges on enough of the rest to be a second, silent
 * reading of the declaration.
 *
 * The listing is `-z`, decoded by the engine's own {@link nameOnlyPaths}:
 * the default form quotes and octal-escapes a path carrying a control
 * character or a non-ASCII byte, and line-splits one carrying a newline, so
 * every path this scan judges would be a name git never committed. Exactly
 * one leading newline is dropped ahead of the fields — git writes it between
 * the header's terminator and the listing, and a path that itself begins
 * with a newline arrives behind that separator, not in place of it.
 */
function commitsPast(cwd: string, cursor: string): RangeCommit[] {
  const raw = git(cwd, [
    "log",
    "--reverse",
    `--format=${RECORD_SEP_FMT}%H${FIELD_SEP_FMT}%s`,
    "--name-only",
    "-z",
    `${cursor}..HEAD`,
  ]);
  return raw
    .split(RECORD_SEP)
    .slice(1)
    .map((block) => {
      const end = block.indexOf(HEADER_END);
      const header = end === -1 ? block : block.slice(0, end);
      const listing = end === -1 ? "" : block.slice(end + HEADER_END.length);
      const [sha = "", subject = ""] = header.split(FIELD_SEP);
      return {
        sha,
        subject,
        paths: nameOnlyPaths(
          listing.startsWith(LISTING_LEAD)
            ? listing.slice(LISTING_LEAD.length)
            : listing,
        ),
      };
    });
}

/** Whether a commit touched anything the window's globs name. */
const touches = (commit: RangeCommit, globs: string[]): boolean =>
  commit.paths.some((path) => matchesAny(path, globs));

/**
 * Whether any commit past `cursor` touched the window's globs.
 *
 * **Fails open, deliberately.** A window that cannot be read — a cursor that
 * names no commit, a git that will not run — reports the slice live, and the
 * render it wakes then refuses by name for either (see {@link bounded}).
 * The inverse would be worse in the one way that matters: a closed window
 * over an unreadable range is silence, and the next cursor advance would step over
 * commits nobody read (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function touchedPast(
  cwd: string,
  cursor: string,
  globs: string[],
): boolean {
  try {
    return commitsPast(cwd, cursor).some((commit) => touches(commit, globs));
  } catch {
    return true;
  }
}
