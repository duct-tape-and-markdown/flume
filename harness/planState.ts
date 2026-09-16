/**
 * The plan state the package's slices keep between ticks (`spec/harness.md`,
 * *Plan state as declared state*): the derive cursor, the sweep cursor, the
 * sweep's continuation signal, and the per-lane drained-run stamp, as fields
 * of a typed artifact the package reads through this accessor.
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
 * The artifact is JSON beside `pending.json`, and for the same reasons: an
 * agent writes it, a schema gates it, and the next tick reads fields rather
 * than impressions.
 *
 * Where the artifact sits is `layout.ts`'s, with every other plan artifact's
 * path — relative to a state root the caller supplies, since the package
 * hardcodes no consumer's state root.
 *
 * This module is the artifact alone: which cursor arms which slice, and what
 * a slice may advance one to, belong to the slices that read this.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import { namespacedJoin } from "../src/paths.js";

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
 * The facts, as `spec/harness.md`, *Plan state as declared state* names
 * them. The cursors and the rotation are required: a present artifact
 * missing one is a slice that wrote away another slice's window, and reading
 * that as "no cursor" would re-arm the window it lost rather than say so.
 */
export const PlanStateSchema = strict({
  /** The derive cursor: the sha `spec/` has been derived through. */
  derivedThrough: objectName,
  /** The sweep cursor: the sha the frontier was derived from. */
  sweptThrough: objectName,
  /** The sweep's continuation signal, with its covered set while open. */
  rotation: Rotation,
  /**
   * The per-lane drained-run stamp: per declared CI lane, the run the inbox
   * slice drained it at and the failing titles that run stated
   * ({@link DrainedRun}, `spec/harness.md`, *CI lanes as a findings
   * source*). A lane whose latest completed run failed is live exactly while
   * that run is past the one stamped here — and, where the lane declares a
   * title reader, while the run's titles differ from the stamped set — so
   * without this field the slice re-drains one red run every tick.
   *
   * **The one absence this artifact reads as a state.** The map is optional
   * and a lane missing from it reads as never drained — which is honest
   * twice over: a state root written before any lane was declared carries no
   * map, and a lane declared this tick has been drained by nothing. Both
   * want the same next move, draining the lane's latest failing run. A
   * required map would instead refuse every artifact written before the
   * field existed, from the selection path, before any slice could write
   * one — a cursor has no such history, which is why it has no such
   * exemption.
   */
  drainedRuns: z.record(z.string().min(1), DrainedRun).optional(),
});

/** The plan state as a slice reads it. */
export type PlanState = z.infer<typeof PlanStateSchema>;

/**
 * The plan state as a writer hands one in — the schema's **input** side, and
 * what {@link writePlanState} accepts.
 *
 * Not {@link PlanState}: a lane stamp reads in two spellings and out in one
 * ({@link DrainedRun}), so the output side names only the spelling the
 * schema normalizes to. A writer holding the other one — a script advancing
 * a stamp it read off an older artifact — would otherwise have to fold it by
 * hand to hand it back to the writer that already folds it.
 */
export type PlanStateWrite = z.input<typeof PlanStateSchema>;

/**
 * The host's form of the path the package composed — every fs call in this
 * module is made on one of these, never on a bare join: a consumer's state
 * root is a path this package did not choose, and a deep one is where
 * absence stops meaning "no cursor yet" (`.claude/rules/platform-facts.md`,
 * *Windows MAX_PATH (~260 chars) breaks fs calls with no long component*).
 */
const onDisk = (stateRoot: string): string =>
  namespacedJoin(planStatePath(stateRoot));

/** The directory that holds it, same form — what the writer creates. */
const onDiskDir = (stateRoot: string): string =>
  namespacedJoin(dirname(planStatePath(stateRoot)));

/**
 * The plan state under `stateRoot`, or `undefined` when no artifact is
 * there.
 *
 * **Absent is a state, malformed is a failure.** A consumer whose state root
 * was just written has no cursor yet, and saying so is how every window
 * opens on the first tick — it is not a degradation, and it is the only
 * degraded-looking answer this returns. Anything else is loud: bytes that
 * are not JSON, JSON that is not this shape, a read that fails for any
 * reason but absence. An unreadable artifact answered as "no cursor" would
 * re-derive a whole spec history or re-sweep a whole domain, confidently
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Synchronous by its callers' contract: a slice's liveness predicate is pure
 * over its inputs and runs on the selection path.
 */
export function readPlanState(stateRoot: string): PlanState | undefined {
  const path = onDisk(stateRoot);

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

  return parseOrThrow(PlanStateSchema, parsed, `plan state at ${path}`);
}

/**
 * Write the plan state under `stateRoot`, creating the directory that holds
 * it.
 *
 * Validates before writing, and refuses the same way the reader does: the
 * writer is reached from untyped callers too — an adoption verb laying down
 * a state root, a script advancing a cursor — and an artifact this package
 * wrote that this package would refuse to read is the seam failing in the
 * one direction nothing downstream can repair.
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
export function writePlanState(stateRoot: string, state: PlanStateWrite): void {
  const path = onDisk(stateRoot);
  const checked = parseOrThrow(PlanStateSchema, state, `plan state at ${path}`);

  mkdirSync(onDiskDir(stateRoot), { recursive: true });
  writeFileSync(path, `${JSON.stringify(checked, null, 2)}\n`);
}
