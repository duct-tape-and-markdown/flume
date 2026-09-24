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
 * This module is the artifacts alone: which cursor arms which slice, and what
 * a slice may advance one to, belong to the slices that read this.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import { namespacedJoin } from "../src/paths.js";

import { INBOX_PHASE, type PlanSlice } from "./declaration.js";
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
 * cursor gate reading derive's shape at a commit (`gates.ts`) and a case
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

/** The directory that holds them, same form — what the writer creates. */
const onDiskDir = (stateRoot: string, slice: PlanSlice): string =>
  namespacedJoin(dirname(planStatePath(stateRoot, slice)));

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
 * One cursor read off one artifact: what it says there, and what that same
 * artifact says about moving it.
 *
 * The two travel together because they come out of one parse of one slice's
 * state, and because a caller judging a move needs both: the value is what
 * the move stepped to, and the hold is whether the slice was in a state to
 * take that step at all.
 */
interface CursorRead {
  /** The cursor's value in that artifact. */
  readonly value: string;
  /**
   * Why the slice's own state there forbids moving this cursor, as a clause
   * naming the state that forbids it — or `undefined` where that state allows
   * the move, which includes every cursor whose slice states no such rule.
   */
  readonly heldBy: string | undefined;
}

/**
 * One cursor a plan slice window may be drawn past: the slice whose file
 * holds it, the read of it off that file, and the read of it off bytes.
 *
 * The bundle rather than the field name alone, because a window owes two
 * answers about a cursor — its value, and where a tick repairs it when it
 * names no commit — and the second one is now a different file per cursor.
 */
interface Cursor {
  /** The slice whose state file holds it — where a repair to it is made. */
  readonly slice: PlanSlice;
  /** Its value, or `undefined` where that slice has written no file yet. */
  readonly at: (stateRoot: string) => string | undefined;
  /**
   * Its read off an already-parsed artifact, refused by the owning slice's
   * own schema when that artifact is not one.
   *
   * The read a caller holding the bytes rather than the disk needs — a gate
   * reading a state file at a commit, where the artifact never existed in a
   * working tree it could name a path in. Without it such a caller indexes
   * the schema table by a slice it spelled itself and reaches past the field
   * extractor, which is the branch on one cursor this table exists to
   * replace.
   */
  readonly of: (parsed: unknown, locus: string) => CursorRead;
}

/**
 * The may-move rule of a cursor whose slice states none: nothing in that
 * slice's state holds the cursor still, so a move of it is judged on its
 * step through history alone.
 *
 * Spelled at the table rather than left out, so a fourth slice's cursor
 * arrives with the question answered either way instead of inheriting
 * "whenever" from an argument its author did not write.
 */
const movesWhenever = (): undefined => undefined;

/**
 * One cursor, bound to the slice state that holds it and to the rule that
 * state states about moving it.
 *
 * The slice is named once and both reads taken off that slice's own type, so
 * a field this schema renames is a typecheck failure here rather than a
 * cursor silently read as absent — which every window reads as "run".
 */
function cursorOf<S extends PlanSlice>(
  slice: S,
  field: (state: PlanStateOf<S>) => string,
  mayMove: (state: PlanStateOf<S>) => string | undefined,
): Cursor {
  return {
    slice,
    at: (stateRoot) => {
      const state = readPlanState(stateRoot, slice);
      return state === undefined ? undefined : field(state);
    },
    of: (parsed, locus) => {
      const state = parseOrThrow(schemaFor(slice), parsed, locus);
      return { value: field(state), heldBy: mayMove(state) };
    },
  };
}

/**
 * Every cursor the package's slices keep, under the field name a window is
 * drawn past it by — each with its value, the slice whose file holds it, and
 * the rule that slice's own state states about moving it.
 *
 * Keyed by the string-valued fields the slice states declare
 * ({@link AnyCursorField}), so a cursor the schemas rename, drop or add is a
 * typecheck failure at this table rather than a window drawn past a field
 * nothing holds (`.claude/rules/engineering.md`, *Derived state is computed,
 * never restated beside its source*).
 *
 * **The may-move rule rides the table, not the caller.** Sweep's cursor may
 * step only where its rotation is closed, because a cursor stamped past a
 * frontier still being worked loses that frontier's covered set; derive's
 * states no such rule. A gate judging moves reads the rule off whichever
 * cursor it holds, where branching on one named field inside machinery
 * already generic over every declared cursor would be the special case this
 * table exists to absorb (`.claude/rules/engineering.md`, *The fix lands at
 * the mechanism*).
 */
const CURSORS = {
  derivedThrough: cursorOf(
    "plan-derive",
    (state) => state.derivedThrough,
    movesWhenever,
  ),
  sweptThrough: cursorOf(
    "plan-sweep",
    (state) => state.sweptThrough,
    (state) =>
      state.rotation.kind === "open"
        ? "the rotation it stamps under is still open, so the frontier that rotation has covered is lost to the next tick"
        : undefined,
  ),
} as const satisfies Record<AnyCursorField, Cursor>;

/**
 * Every field across the slice states that holds a git object name — read off
 * the schemas' own shapes rather than listed, which is what makes
 * {@link CURSORS} exhaustive by the typecheck.
 */
type AnyCursorField = {
  [S in PlanSlice]: {
    [K in keyof PlanStateOf<S>]-?: PlanStateOf<S>[K] extends string ? K : never;
  }[keyof PlanStateOf<S>];
}[PlanSlice];

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
 * them — what a caller that holds all of them at once walks.
 *
 * Read off the table rather than listed, so a cursor a fourth slice adds is
 * judged by every such caller without one of them being edited: the table is
 * already exhaustive by the typecheck, and this is that exhaustiveness handed
 * out (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*).
 */
export const CURSOR_FIELDS = Object.keys(CURSORS) as readonly CursorField[];

/**
 * The cursor `field` names under `stateRoot`, or `undefined` where the slice
 * that owns it has written no state file yet.
 */
export const readCursor = (
  stateRoot: string,
  field: CursorField,
): string | undefined => CURSORS[field].at(stateRoot);

/**
 * The cursor `field` names inside `parsed` — an artifact already decoded from
 * bytes, judged against the schema of the slice that owns `field` and
 * refused by name at `locus` when it is not that slice's shape.
 *
 * For the caller whose artifact is not on a disk it can name: a state file
 * read at a commit, a fixture under test. `readCursor` is the same read with
 * the file access in front of it, and the value alone — a caller drawing a
 * window has a cursor to step past, not a move to judge.
 *
 * Both halves come out of the one parse, so a caller asking whether a move
 * was allowed never decodes the same bytes a second time to find out.
 */
export const parseCursor = (
  field: CursorField,
  parsed: unknown,
  locus: string,
): CursorRead => CURSORS[field].of(parsed, locus);
