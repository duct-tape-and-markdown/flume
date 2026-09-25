/**
 * The plan state the package's slices keep between ticks (`spec/harness.md`,
 * *Plan state as declared state*): the derive cursor, the sweep cursor, the
 * sweep's continuation signal, and the per-lane drained-run stamp, as fields
 * of typed artifacts the package reads through this accessor.
 *
 * **One file per writer.** Each slice's state is its own file, and the
 * accessor is keyed by the slice that owns it, so a slice cannot so much as
 * name a field it does not write: the derive cursor is derive's file, the
 * sweep cursor and its rotation are sweep's, the drained runs are the
 * inbox's. Two slices stamping in one wave land on disjoint paths and merge
 * as disjoint files; a fourth field wanting a fourth writer is a fourth
 * file, not a fifth hand on one page. The fence holds the same statement
 * mechanically — a plan phase is fenced to its own file alone
 * (`layout.ts`, {@link planStatePath}).
 *
 * **Never a line regexed out of prose.** These facts decide which slice runs
 * next, and a slice's window is the difference between deriving a spec
 * change and skipping it. Read out of a narrative document, each fact
 * is one rewording away from vanishing: a cursor line an agent reflows, a
 * paragraph whose opening words drift, a covered set punctuated differently
 * — and the reader that misses it reports no cursor, which every window
 * reads as "run". The failure is silent in the direction that looks like
 * work getting done. As fields, a malformed artifact is refused by name at
 * the tick that wrote it (*Loud or nothing*), and the narrative that used to
 * surround them belongs in the plan commit body, where git keeps it and no
 * tick pays to re-read it (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*).
 *
 * Each file is JSON beside the queue's entry files, and for the same reasons: an
 * agent writes it, a schema gates it, and the next tick reads fields rather
 * than impressions.
 *
 * Where the files sit is `layout.ts`'s, with every other plan artifact's path
 * — relative to a state root the caller supplies, since the package
 * hardcodes no consumer's state root.
 *
 * This module is the artifacts and the rules each slice states about its own
 * — what a state file at a commit forbids, given the one at the base. Which
 * cursor arms which slice, and which span a tick actually derived or swept,
 * belong to the slices that read this.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import { isDirectoryOrAbsentUnder } from "../src/fsProbe.js";
import { namespacedJoin } from "../src/paths.js";

import { INBOX_PHASE, PLAN_SLICES, type PlanSlice } from "./declaration.js";
import { detailOf } from "./exec.js";
import { planStatePath } from "./layout.js";
import { parseOrThrow, strict } from "./refusal.js";

/**
 * A git object name, abbreviated or full. Shape-checked because the package
 * hands a cursor straight to git as a revision: a value that is not one
 * makes every window it arms fail at the process boundary instead of here,
 * where the field can be named.
 */
const objectName = z
  .string()
  .regex(/^[0-9a-f]{7,40}$/, "must be a git object name (7-40 hex characters)");

/**
 * The sweep's continuation signal. A rotation is open or closed as a stated
 * kind, never as the presence or absence of something — and `covered` rides
 * the open arm alone, so a covered set left behind beside a closed rotation
 * is unconstructable rather than a stale list a later tick might believe.
 *
 * `covered` may be empty: a rotation armed this tick has a frontier and no
 * neighborhood swept yet, which is a real state and not a vacuous one.
 */
const Rotation = z.discriminatedUnion("kind", [
  strict({ kind: z.literal("closed") }),
  strict({
    kind: z.literal("open"),
    /** What the open rotation has already swept — settled for the window. */
    covered: z.array(z.string().min(1)),
  }),
]);

/**
 * The run a forge names, as the slice read it. Shape-checked for being
 * something and nothing more: the package compares a stamp against the
 * identity the forge reports for a lane's latest completed run and never
 * interprets it, so a numeric run id and an opaque token are equally a
 * stamp. Empty is not — it names no run, so it would read as a lane drained
 * while matching nothing the forge can report.
 */
const runName = z.string().min(1);

/**
 * One lane's drained-run stamp: the run the slice drained that lane at, and
 * the failing titles the lane's declared reader gave that run
 * (`spec/harness.md`, *CI lanes as a findings source*). The titles ride the
 * stamp because the wake compares them against the run's current set — a
 * stamp holding the run alone can only say "a different run", so a red that
 * persists across runs wakes the slice again on failures it already filed.
 *
 * **A bare run identity is the same stamp with no titles.** Every artifact
 * written before this field carried a set spells it that way, and so does a
 * lane whose reader never ran — the log the forge withheld, a lane declaring
 * no reader. Read here rather than repaired by a migration, and read into
 * the one shape every consumer of this field sees: a reader picking the
 * spelling apart at each call site is the second implementation this arm
 * exists to prevent.
 *
 * Titles are required on the object spelling, empty where there are none.
 * Vacuous-by-design is spelled, never inherited from a field left out.
 */
const DrainedRun = z.union(
  [
    runName.transform((run) => ({ run, titles: [] as string[] })),
    strict({ run: runName, titles: z.array(z.string().min(1)) }),
  ],
  {
    error:
      "must be the run identity the forge reported, or { run, titles } " +
      "carrying that identity and the failing titles the lane's declared " +
      "reader gave it",
  },
);

/**
 * The derive slice's state: the cursor `spec/` has been derived through.
 *
 * Required, and it is the whole file: a present artifact missing it is a
 * slice that wrote away its own window, and reading that as "no cursor"
 * would re-derive a whole spec history rather than say so.
 */
const DeriveStateSchema = strict({
  /** The derive cursor: the sha `spec/` has been derived through. */
  derivedThrough: objectName,
});

/**
 * The sweep slice's state: the cursor the frontier was derived from, and the
 * rotation that frontier is being worked through.
 *
 * The two ride one file because one slice writes both, and because they are
 * one fact in two halves — a rotation is open *over* the frontier the cursor
 * names, so a tick that advanced one without the other would leave a covered
 * set describing a frontier nobody drew.
 */
const SweepStateSchema = strict({
  /** The sweep cursor: the sha the frontier was derived from. */
  sweptThrough: objectName,
  /** The sweep's continuation signal, with its covered set while open. */
  rotation: Rotation,
});

/**
 * The inbox slice's state: the per-lane drained-run stamp, per declared CI
 * lane — the run the slice drained that lane at and the failing titles that
 * run stated ({@link DrainedRun}, `spec/harness.md`, *CI lanes as a findings
 * source*). A lane whose latest completed run failed is live exactly while
 * that run is past the one stamped here — and, where the lane declares a
 * title reader, while the run's titles differ from the stamped set — so
 * without this field the slice re-drains one red run every tick.
 *
 * **The one absence this state reads as a state.** The map is optional and a
 * lane missing from it reads as never drained — which is honest twice over: a
 * state root written before any lane was declared carries no map, and a lane
 * declared this tick has been drained by nothing. Both want the same next
 * move, draining the lane's latest failing run. A required map would instead
 * refuse every artifact written before the field existed, from the selection
 * path, before any slice could write one — a cursor has no such history,
 * which is why it has no such exemption.
 *
 * The whole file is that one optional field, so the inbox's state is the one
 * a slice may legitimately have never written: absence of the file and
 * absence of the map are the same statement, which is why neither is a
 * refusal.
 */
const InboxStateSchema = strict({
  drainedRuns: z.record(z.string().min(1), DrainedRun).optional(),
});

/**
 * Every slice's state schema under the slice that owns it — **the artifact
 * layout's one statement of which slice writes which fields.**
 *
 * Keyed exhaustively by `PlanSlice`, so a slice the package adds without a
 * state file of its own is a typecheck failure here rather than a slice
 * silently sharing a sibling's (`.claude/rules/engineering.md`, *Derived
 * state is computed, never restated beside its source*). The three shapes
 * have no export of their own: this table is the one door to them, so the
 * slice-state gate reading a slice's shape at a commit (`gates.ts`) and a case
 * walking every slice's required fields both index the same key rather than
 * reaching a schema a fourth slice could be added without.
 */
export const PLAN_STATE_SCHEMAS = {
  "plan-derive": DeriveStateSchema,
  "plan-sweep": SweepStateSchema,
  [INBOX_PHASE]: InboxStateSchema,
} as const satisfies Record<PlanSlice, z.ZodType>;

/** `slice`'s state as that slice reads it. */
export type PlanStateOf<S extends PlanSlice> = z.infer<
  (typeof PLAN_STATE_SCHEMAS)[S]
>;

/**
 * `slice`'s state as a writer hands one in — the schema's **input** side, and
 * what {@link writePlanState} accepts.
 *
 * Not {@link PlanStateOf}: a lane stamp reads in two spellings and out in one
 * ({@link DrainedRun}), so the output side names only the spelling the schema
 * normalizes to. A writer holding the other one — a script advancing a stamp
 * it read off an older artifact — would otherwise have to fold it by hand to
 * hand it back to the writer that already folds it.
 */
export type PlanStateWriteOf<S extends PlanSlice> = z.input<
  (typeof PLAN_STATE_SCHEMAS)[S]
>;

/**
 * Every shape `slice`'s state file may take, as the literal JSON the slice's
 * prompt shows the agent — one per arm, with each value the agent fills
 * spelled as a `<placeholder>`.
 *
 * **The prose cannot be the only statement of the shape.** A slice with no
 * file of its own yet has nothing on disk to copy the shape from, so it
 * writes whatever the prompt's description suggests — and a rotation
 * described as "closed" was written as the string `"closed"`, which the
 * schema refuses and the tick reverts over. Typed as each schema's input
 * side, so a field or kind the schemas rename is a typecheck failure here
 * rather than a prompt teaching a shape the reader refuses; the prompt
 * suite drives each rendered arm through {@link PLAN_STATE_SCHEMAS}.
 */
export const PLAN_STATE_SHAPES: {
  readonly [S in PlanSlice]: readonly PlanStateWriteOf<S>[];
} = {
  "plan-derive": [{ derivedThrough: "<sha>" }],
  "plan-sweep": [
    { sweptThrough: "<sha>", rotation: { kind: "closed" } },
    {
      sweptThrough: "<sha>",
      rotation: { kind: "open", covered: ["<covered module path>"] },
    },
  ],
  [INBOX_PHASE]: [
    {
      drainedRuns: {
        "<lane name>": { run: "<run id>", titles: ["<failing title>"] },
      },
    },
  ],
};

/**
 * One slice's schema at the type that slice's own accessors answer in.
 *
 * The one place the table above is resolved against the slice a caller named.
 * Each entry's shape is its own, so an index off a slice still generic gives
 * TypeScript the union of the three rather than the member — and a union is
 * what {@link readPlanState} would then have to hand every caller to fold by
 * hand. Narrowed here instead, once, behind the key that chose the schema.
 */
const schemaFor = <S extends PlanSlice>(
  slice: S,
): z.ZodType<PlanStateOf<S>> =>
  PLAN_STATE_SCHEMAS[slice] as unknown as z.ZodType<PlanStateOf<S>>;

/**
 * The host's form of the path the package composed — every fs call in this
 * module is made on one of these, never on a bare join: a consumer's state
 * root is a path this package did not choose, and a deep one is where
 * absence stops meaning "no cursor yet" (`.claude/rules/platform-facts.md`,
 * *Windows MAX_PATH (~260 chars) breaks fs calls with no long component*).
 */
const onDisk = (stateRoot: string, slice: PlanSlice): string =>
  namespacedJoin(planStatePath(stateRoot, slice));

/**
 * The plain directory that holds them — the leaf of the descent the reader
 * proves before it reads absence as "no cursor yet", and, namespaced, what
 * the writer creates. Plain here because the descent namespaces every rung
 * itself ({@link isDirectoryOrAbsentUnder}, `src/fsProbe.ts`), owning the
 * whole walk rather than a path a caller composed.
 */
const stateDir = (stateRoot: string, slice: PlanSlice): string =>
  dirname(planStatePath(stateRoot, slice));

/** The directory that holds them in the host's form — what the writer creates. */
const onDiskDir = (stateRoot: string, slice: PlanSlice): string =>
  namespacedJoin(stateDir(stateRoot, slice));

/**
 * The subject the descent names when it refuses — one spelling, so the rung
 * an operator is told to go fix reads the same whichever ancestor of a
 * slice's file was obstructed.
 */
const STATE_SUBJECT = "plan state";

/**
 * `slice`'s state under `stateRoot`, or `undefined` when that slice has
 * written no file there.
 *
 * **Absent is a state, malformed is a failure.** A slice whose file was never
 * written has no cursor yet, and saying so is how every window opens on the
 * first tick — it is not a degradation, and it is the only degraded-looking
 * answer this returns. Anything else is loud: bytes that are not JSON, JSON
 * that is not this slice's shape, a read that fails for any reason but
 * absence. An unreadable artifact answered as "no cursor" would re-derive a
 * whole spec history or re-sweep a whole domain, confidently
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * That absence is proven from the **path**, never read off the errno the
 * read raised. A plain file anywhere above the slice's file makes the file
 * beneath it `ENOENT` on win32 while posix raises `ENOTDIR`
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*), so an errno-keyed silent arm answers "no
 * cursor yet" over an obstructed state root on exactly one host — and a
 * derive window that opens on the whole spec history is the confident wrong
 * answer this refuses. Hence the descent every reader under a state root
 * runs: `stateRoot`, then each segment down to the directory the file sits
 * in, every one asserted a directory before the next is probed
 * ({@link isDirectoryOrAbsentUnder}, `src/fsProbe.ts`, which composes those
 * rungs), so both hosts answer alike. `stateRoot` is where the descent
 * starts: the caller declared it, and what stands above it is the caller's
 * to answer for. The read past it keeps the one ENOENT arm the leaf still
 * needs — its directory is proven by then, so that errno is the file's own.
 *
 * **Per slice, so absence is per slice too.** A consumer mid-cutover has
 * written one slice's file and not another's, and each window opens on its
 * own slice's answer rather than on whether any plan state exists at all.
 *
 * Synchronous by its callers' contract: a slice's liveness predicate is pure
 * over its inputs and runs on the selection path.
 */
export function readPlanState<S extends PlanSlice>(
  stateRoot: string,
  slice: S,
): PlanStateOf<S> | undefined {
  if (!isDirectoryOrAbsentUnder(STATE_SUBJECT, stateRoot, stateDir(stateRoot, slice)))
    return undefined;
  const path = onDisk(stateRoot, slice);

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `invalid plan state at ${path}: not JSON — ${(error as Error).message}`,
    );
  }

  return parseOrThrow(schemaFor(slice), parsed, `plan state at ${path}`);
}

/**
 * What a bounded read answered: the accessor's own value, or the words the
 * read failed with.
 *
 * Discriminated on `failure`, never on the value. Every accessor here already
 * answers `undefined` for a slice that has written no file yet, so a union
 * keyed on the value could not tell "no cursor" from "no read" — which is the
 * confident wrong answer the reader above refuses to give
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export type BoundedRead<T> =
  | { readonly read: T; readonly failure?: undefined }
  | { readonly read?: undefined; readonly failure: string };

/**
 * `read` under a bound, for the one caller shape that cannot take a throw: a
 * plan slice's liveness predicate.
 *
 * **Liveness runs inside the handoff's wake set, and that set walks every
 * slice.** A throw out of one slice's `live` leaves the whole set unbuilt, so
 * a state file that will not parse wakes no phase at all — build included —
 * and the engine's consult declines the tick. The slice that owns the
 * unreadable file is the one tick that could rewrite it, and it is the tick
 * that was declined.
 *
 * **Bounded is not silent.** A predicate reading this answers **live** on a
 * failure, and the window that tick opens renders the same failure as the
 * refusal every uncomputable window spells (`windowRefusal`,
 * `sliceWindow.ts`) — so the degraded leg is bounded by a refusal the agent
 * reads, never by a marker nobody inspects (`.claude/rules/engineering.md`,
 * *Loud or nothing*).
 *
 * The failure's own words are carried and nothing is classified from them
 * ({@link detailOf}, `harness/exec.ts`; `.claude/rules/engine-boundary.md`,
 * *Told, not inferred*). Every other caller takes the accessor itself: a
 * writer, a judge or a verb that cannot read this artifact has a throw to
 * raise and no window to render it in.
 */
const boundedRead = <T>(read: () => T): BoundedRead<T> => {
  try {
    return { read: read() };
  } catch (error) {
    return { failure: detailOf(error) };
  }
};

/**
 * {@link readPlanState} under {@link boundedRead}'s bound — the read the
 * sweep's and the inbox's liveness predicates take.
 */
export const readPlanStateBounded = <S extends PlanSlice>(
  stateRoot: string,
  slice: S,
): BoundedRead<PlanStateOf<S> | undefined> =>
  boundedRead(() => readPlanState(stateRoot, slice));

/**
 * Write `slice`'s state under `stateRoot`, creating the directory that holds
 * it.
 *
 * Validates before writing, and refuses the same way the reader does: the
 * writer is reached from untyped callers too — an adoption verb laying down
 * a state root, a script advancing a cursor — and an artifact this package
 * wrote that this package would refuse to read is the seam failing in the
 * one direction nothing downstream can repair.
 *
 * Writes one slice's file and touches no other, which is the mechanical half
 * of the spec's "no slice writes a cursor it does not own": there is no
 * read-modify-write of a shared page here for a concurrent sibling to lose.
 *
 * Two-space JSON with a trailing newline, because an agent edits this file
 * as often as this function writes it, and a one-line artifact makes every
 * cursor advance a whole-file diff.
 *
 * What lands on disk is what the parse *read*, not what the caller spelled:
 * a lane stamp handed in as a bare run identity is written in the one
 * spelling every reader of this artifact sees, so nothing this package wrote
 * carries a shape a later reader has to fold again.
 */
export function writePlanState<S extends PlanSlice>(
  stateRoot: string,
  slice: S,
  state: PlanStateWriteOf<S>,
): void {
  const path = onDisk(stateRoot, slice);
  const checked = parseOrThrow(schemaFor(slice), state, `plan state at ${path}`);

  mkdirSync(onDiskDir(stateRoot, slice), { recursive: true });
  writeFileSync(path, `${JSON.stringify(checked, null, 2)}\n`);
}

/**
 * One invariant a slice states about its own state file, read as a **rule
 * over that file at the base and at the commit** (`spec/harness.md`, *The
 * gates the discipline needs*): what the state the tick wrote forbids, given
 * the state it read before writing it, as a clause naming what forbids it —
 * or `undefined` where nothing in the slice's own state holds the move.
 *
 * **Whole states, never one field.** The sweep's stamp is held by the
 * rotation beside it, and that rotation's covered set is held by the covered
 * set the base carried: neither is expressible by a rule handed one field,
 * which is why the rule that used to ride each cursor now rides its slice.
 *
 * A rule names its own slice's fields; what it never names is a sha, because
 * the artifact it is about is named by the caller that read it at a ref.
 */
type SliceStateRule<S extends PlanSlice> = (
  at: PlanStateOf<S>,
  base: PlanStateOf<S> | undefined,
) => string | undefined;

/**
 * The sweep stamps on the tick that closes its rotation and on no other: a
 * rotation stands open *over* the frontier the old stamp drew, so a stamp
 * moved while it is open leaves a covered set describing a frontier nobody
 * will draw again (`.claude/rules/posture-sweep.md`, *The stamp*).
 */
const stampsOnlyOnTheTickThatCloses: SliceStateRule<"plan-sweep"> = (
  at,
  base,
) =>
  base !== undefined &&
  base.sweptThrough !== at.sweptThrough &&
  at.rotation.kind === "open"
    ? "sweptThrough moved while the rotation it stamps under is still open, so the frontier that rotation has covered is lost to the next tick"
    : undefined;

/**
 * Coverage is settled for the window: while one rotation stands open across a
 * commit, every module it had already swept is still swept
 * (`.claude/rules/posture-sweep.md`, *The frontier is decidable; the
 * neighborhood is judged*).
 *
 * Read only where the rotation is open at **both** ends. A tick that closes
 * the rotation drops the covered set by construction — `covered` rides the
 * open arm alone — and that drop is the rotation's verdict, not a loss.
 */
const coveredOnlyGrowsWhileOpen: SliceStateRule<"plan-sweep"> = (at, base) => {
  if (base === undefined) return undefined;
  if (base.rotation.kind !== "open" || at.rotation.kind !== "open") {
    return undefined;
  }
  const kept = new Set(at.rotation.covered);
  const dropped = base.rotation.covered.filter((module) => !kept.has(module));
  if (dropped.length === 0) return undefined;
  return `the open rotation's covered set dropped ${dropped.length} module(s) it had already swept (${dropped.join(", ")}), and the next tick re-derives a frontier that reads as a smaller neighborhood rather than as a failure`;
};

/**
 * A lane the slice has drained stays drained. A lane missing from the map
 * reads as never drained — the one absence this state reads as a state
 * ({@link InboxStateSchema}) — so a tick that drops a standing lane's stamp
 * is not clearing a note: it re-opens that lane over the run it already
 * filed, and the slice wakes into findings it has already queued
 * (`spec/harness.md`, *CI lanes as a findings source*).
 *
 * Read on the lane key alone. Where a standing lane's stamp *moves to* is
 * the forge's to order and not this file's — a run identity is opaque here
 * ({@link DrainedRun}) — so a lane restamped at another run is a drain like
 * any other, and only its disappearance is the loss no later tick can see.
 */
const lanesKeepTheStampsTheyHave: SliceStateRule<typeof INBOX_PHASE> = (
  at,
  base,
) => {
  if (base === undefined) return undefined;
  const standing = at.drainedRuns ?? {};
  const dropped = Object.keys(base.drainedRuns ?? {}).filter(
    (lane) => !Object.hasOwn(standing, lane),
  );
  if (dropped.length === 0) return undefined;
  return `the drained-run stamp the base carried for ${dropped.length} lane(s) (${dropped.join(", ")}) is gone from the file, so the next tick wakes this slice over a run it already drained`;
};

/**
 * Every slice's invariants over its own state file, under the slice that
 * writes it — **the one table a judge of plan state reads**, and the one a
 * fourth slice's rule joins.
 *
 * Keyed exhaustively by `PlanSlice`, so a slice added without an answer here
 * is a typecheck failure rather than a state file nothing judges. A slice
 * whose state holds no invariant says so with an empty list, spelled at the
 * table: derive's cursor is bounded by its step through history and by
 * nothing its own file says.
 *
 * **The rules ride the table beside the accessors, not the caller.** A gate
 * holding a state file at two refs asks this table what that slice forbids,
 * where branching on one named field inside machinery already generic over
 * every declared slice would be the special case this table exists to absorb
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
const SLICE_STATE_RULES = {
  "plan-derive": [],
  "plan-sweep": [stampsOnlyOnTheTickThatCloses, coveredOnlyGrowsWhileOpen],
  [INBOX_PHASE]: [lanesKeepTheStampsTheyHave],
} as const satisfies { [S in PlanSlice]: readonly SliceStateRule<S>[] };

/** Any slice's state, as the one table above holds them all. */
type SliceState = PlanStateOf<PlanSlice>;

/**
 * One slice's rules at the type that slice's own state answers to — the one
 * place the table above is resolved against a slice a caller named, for the
 * same reason {@link schemaFor} exists: an index off a still-generic slice
 * gives TypeScript the union of the three lists rather than the member.
 */
const rulesFor = <S extends PlanSlice>(
  slice: S,
): readonly SliceStateRule<S>[] =>
  SLICE_STATE_RULES[slice] as unknown as readonly SliceStateRule<S>[];

/**
 * One cursor a plan slice window may be drawn past: the slice whose file
 * holds it, the read of it off that file, and the read of it off a state
 * already parsed.
 *
 * The bundle rather than the field name alone, because a window owes two
 * answers about a cursor — its value, and where a tick repairs it when it
 * names no commit — and the second one is a different file per cursor.
 */
interface Cursor {
  /** The slice whose state file holds it — where a repair to it is made. */
  readonly slice: PlanSlice;
  /** Its value, or `undefined` where that slice has written no file yet. */
  readonly at: (stateRoot: string) => string | undefined;
  /**
   * Its value inside a state **already parsed through its own slice's
   * schema** — the read a caller that decoded the artifact once takes, so a
   * judge holding one state file never decodes the same bytes again to
   * answer about a second cursor in it.
   *
   * The table pairs this reader with `slice` above, and that pairing is what
   * the narrowing here stands on: a caller reaches it only through the
   * slice's own list ({@link cursorsOf}).
   */
  readonly in: (state: SliceState) => string;
}

/**
 * One cursor, bound to the slice state that holds it.
 *
 * The slice is named once and the read taken off that slice's own type, so a
 * field this schema renames is a typecheck failure here rather than a cursor
 * silently read as absent — which every window reads as "run".
 */
function cursorOf<S extends PlanSlice>(
  slice: S,
  field: (state: PlanStateOf<S>) => string,
): Cursor {
  return {
    slice,
    at: (stateRoot) => {
      const state = readPlanState(stateRoot, slice);
      return state === undefined ? undefined : field(state);
    },
    in: (state) => field(state as PlanStateOf<S>),
  };
}

/**
 * Every cursor the package's slices keep, under the field name a window is
 * drawn past it by — each with its value and the slice whose file holds it.
 *
 * Keyed by the string-valued fields the slice states declare
 * ({@link AnyCursorField}), so a cursor the schemas rename, drop or add is a
 * typecheck failure at this table rather than a window drawn past a field
 * nothing holds (`.claude/rules/engineering.md`, *Derived state is computed,
 * never restated beside its source*).
 *
 * What a slice's own state says about *moving* one of these is not here: it
 * is a rule over the whole file at two refs, and it rides
 * {@link SLICE_STATE_RULES}.
 */
const CURSORS = {
  derivedThrough: cursorOf("plan-derive", (state) => state.derivedThrough),
  sweptThrough: cursorOf("plan-sweep", (state) => state.sweptThrough),
} as const satisfies Record<AnyCursorField, Cursor>;

/**
 * The fields of `S`'s own state that hold a git object name — the cursors
 * that one slice carries, read off its schema's shape rather than listed.
 *
 * Spelled once because two tables stand on it: {@link CURSORS}, which must
 * name every cursor across the slices, and {@link PLAN_STATE_SEEDS}, which
 * must carry a starting state for every slice that has one and none for the
 * slice that has not.
 */
type CursorFieldsOf<S extends PlanSlice> = {
  [K in keyof PlanStateOf<S>]-?: PlanStateOf<S>[K] extends string ? K : never;
}[keyof PlanStateOf<S>];

/**
 * Every field across the slice states that holds a git object name — read off
 * the schemas' own shapes rather than listed, which is what makes
 * {@link CURSORS} exhaustive by the typecheck.
 */
type AnyCursorField = { [S in PlanSlice]: CursorFieldsOf<S> }[PlanSlice];

/**
 * What each slice's state file says at a tip nothing has been derived or
 * swept past yet — the adoption's starting state, as a function of the tip
 * it is stamped at.
 *
 * **A slice carries a seed exactly while it carries a cursor.** The key's
 * type is read off {@link CursorFieldsOf}, so a slice holding one must state
 * what it starts as and a slice holding none must state nothing — the inbox's
 * absence is its declared state ({@link InboxStateSchema}), and a seed for it
 * would be an adoption claiming a lane was drained by a run that never
 * happened. A fourth slice added with a cursor is a typecheck failure at this
 * table rather than a slice silently left unseeded, which every window reads
 * as "run" over everything.
 *
 * The sweep's rotation rides its cursor here for the reason the two share a
 * file: a stamp with no rotation beside it is half a statement. Closed, so an
 * adoption opens no rotation over a domain whose whole history predates it —
 * the frontier re-arms from the first commit that touches the domain past
 * this stamp (`.claude/rules/posture-sweep.md`, *The stamp*).
 */
const PLAN_STATE_SEEDS: {
  readonly [S in PlanSlice]: [CursorFieldsOf<S>] extends [never]
    ? undefined
    : (tip: string) => PlanStateWriteOf<S>;
} = {
  "plan-derive": (tip) => ({ derivedThrough: tip }),
  "plan-sweep": (tip) => ({ sweptThrough: tip, rotation: { kind: "closed" } }),
  [INBOX_PHASE]: undefined,
};

/**
 * Write the starting state of every slice that has one under `stateRoot`,
 * each cursor stamped at `tip`, and report which slices that was.
 *
 * The caller is an adoption laying down a state root (`init.ts`): a state
 * root with no plan state in it sends the first derive tick over the whole
 * spec corpus and makes the sweep live over the whole domain, all of it from
 * before the repository adopted the package.
 *
 * `tip` is the caller's, never resolved here: the adoption reads the tip it
 * ran against in its own preflight, and a second resolution inside the write
 * would stamp a sha nobody read (`.claude/rules/posture-sweep.md`, *The
 * stamp*). Written through {@link writePlanState}, so what lands is what this
 * package's own reader would accept.
 */
export function seedPlanState(
  stateRoot: string,
  tip: string,
): readonly PlanSlice[] {
  const seeded: PlanSlice[] = [];
  for (const slice of PLAN_SLICES) {
    const seed = PLAN_STATE_SEEDS[slice];
    if (seed === undefined) continue;
    writePlanState(stateRoot, slice, seed(tip));
    seeded.push(slice);
  }
  return seeded;
}

/** A cursor a plan slice window may be drawn past, by name. */
export type CursorField = keyof typeof CURSORS;

/**
 * Which slice's state file holds `field` — where the tick that repairs an
 * unreadable cursor writes, and the one thing a window needs about a cursor
 * beyond its value.
 */
export const cursorSlice = (field: CursorField): PlanSlice =>
  CURSORS[field].slice;

/**
 * Every cursor the package declares, in the order {@link CURSORS} states
 * them — what the reads below walk.
 *
 * Read off the table rather than listed, so a cursor a fourth slice adds is
 * judged without either of them being edited: the table is already exhaustive
 * by the typecheck, and this is that exhaustiveness handed on
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*). It is not handed out: a caller outside this module
 * holds a slice's state file, never the cursor set, and asks
 * {@link judgeSliceState} what that file's cursors say.
 */
const CURSOR_FIELDS = Object.keys(CURSORS) as readonly CursorField[];

/** The cursors `slice`'s own state file holds, in the table's order. */
const cursorsOf = (slice: PlanSlice): readonly CursorField[] =>
  CURSOR_FIELDS.filter((field) => CURSORS[field].slice === slice);

/**
 * The cursor `field` names under `stateRoot`, or `undefined` where the slice
 * that owns it has written no state file yet.
 */
export const readCursor = (
  stateRoot: string,
  field: CursorField,
): string | undefined => CURSORS[field].at(stateRoot);

/**
 * {@link readCursor} under {@link boundedRead}'s bound — the read the derive
 * slice's liveness predicate takes.
 */
export const readCursorBounded = (
  stateRoot: string,
  field: CursorField,
): BoundedRead<string | undefined> =>
  boundedRead(() => readCursor(stateRoot, field));

/**
 * Every slice whose state file this package states something about — the set
 * a judge of plan state walks, and what it skips a touched file on.
 *
 * Read off the two tables rather than listed: a slice holds a cursor, or
 * states a rule, or there is nothing about its file to judge. No slice the
 * package declares is the third case today — the inbox joined this set by
 * stating a rule over its lane stamps, not by being added to a list — and a
 * fourth slice joins the same way.
 */
export const JUDGED_SLICES: readonly PlanSlice[] = (
  Object.keys(SLICE_STATE_RULES) as readonly PlanSlice[]
).filter(
  (slice) => rulesFor(slice).length > 0 || cursorsOf(slice).length > 0,
);

/** One slice's state artifact as a judge holds it: decoded bytes, and where from. */
export interface SliceStateAt {
  /** The artifact, already decoded from bytes — JSON, not yet this slice's shape. */
  readonly parsed: unknown;
  /** What to name in a refusal when it is not that shape. */
  readonly locus: string;
}

/** One cursor across a judged pair: its value, and the value it stepped from. */
interface CursorStep {
  readonly field: CursorField;
  /** Its value at the commit. */
  readonly value: string;
  /**
   * Its value at the base, or `undefined` where the base carried no artifact
   * — a state root with no cursor yet, which every window reads as "run" and
   * which is no step at all.
   */
  readonly before: string | undefined;
}

/** What one slice's state file at two refs says, judged against that slice's own rules. */
interface SliceStateJudgement {
  /** Every cursor that slice holds, with both ends of its step. */
  readonly cursors: readonly CursorStep[];
  /** Every one of the slice's own invariants the pair breaks, in table order. */
  readonly problems: readonly string[];
}

/**
 * `slice`'s state file at a commit, read against the same file at the base:
 * what its cursors say at both ends, and what the pair breaks of the rules
 * that slice states about itself.
 *
 * For the caller whose artifact is not on a disk it can name — a state file
 * read at a commit, a fixture under test. `readCursor` is the value alone
 * with the file access in front of it, for a caller drawing a window rather
 * than judging a move.
 *
 * Each end is decoded once and every answer comes off that one parse, so a
 * caller asking about two cursors and two rules never re-reads the bytes
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*). Neither end is repaired: an artifact that is not the
 * slice's shape is refused by name at its own locus.
 */
export function judgeSliceState<S extends PlanSlice>(
  slice: S,
  at: SliceStateAt,
  base: SliceStateAt | undefined,
): SliceStateJudgement {
  const schema = schemaFor(slice);
  const after = parseOrThrow(schema, at.parsed, at.locus);
  const before =
    base === undefined
      ? undefined
      : parseOrThrow(schema, base.parsed, base.locus);

  return {
    cursors: cursorsOf(slice).map((field) => ({
      field,
      value: CURSORS[field].in(after as SliceState),
      before:
        before === undefined
          ? undefined
          : CURSORS[field].in(before as SliceState),
    })),
    problems: rulesFor(slice)
      .map((rule) => rule(after, before))
      .filter((clause): clause is string => clause !== undefined),
  };
}
