/**
 * The plan state the package's slices keep between ticks (`spec/harness.md`,
 * *Plan state as declared state*): the derive cursor, the sweep cursor, and
 * the sweep's continuation signal, as fields of a typed artifact the package
 * reads through this accessor.
 *
 * **Never a line regexed out of prose.** These three facts decide which
 * slice runs next, and a slice's window is the difference between deriving a
 * spec change and skipping it. Read out of a narrative document, each fact
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
 * Paths here are **relative to a state root the caller supplies**, as
 * everything else the package addresses is (`records.ts`) — the package
 * hardcodes no consumer's state root.
 *
 * This module is the artifact alone: which cursor arms which slice, and what
 * a slice may advance one to, belong to the slices that read this.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, normalize } from "node:path";

import { z } from "zod";

import { parseOrThrow, strict } from "./refusal.js";

/** Where the artifact sits under a state root. */
const PLAN_STATE_REL = "plan/state.json";

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
 * The three facts, as `spec/harness.md`, *Plan state as declared state*
 * names them. All required: a present artifact missing a cursor is a slice
 * that wrote away another slice's window, and reading that as "no cursor"
 * would re-arm the window it lost rather than say so.
 */
export const PlanStateSchema = strict({
  /** The derive cursor: the sha `spec/` has been derived through. */
  derivedThrough: objectName,
  /** The sweep cursor: the sha the frontier was derived from. */
  sweptThrough: objectName,
  /** The sweep's continuation signal, with its covered set while open. */
  rotation: Rotation,
});

/** The plan state as a slice reads it. */
export type PlanState = z.infer<typeof PlanStateSchema>;

/**
 * Where the plan state artifact lives under `stateRoot`, slash-joined — the
 * form a git path and a fence glob are both in. One spelling, so the fence
 * admitting the artifact and the accessor reading it cannot name different
 * files.
 */
export function planStatePath(stateRoot: string): string {
  return `${stateRoot}/${PLAN_STATE_REL}`;
}

/** The host's form of the path the package composed. */
const onDisk = (stateRoot: string): string =>
  normalize(planStatePath(stateRoot));

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
 */
export function writePlanState(stateRoot: string, state: PlanState): void {
  const path = onDisk(stateRoot);
  const checked = parseOrThrow(PlanStateSchema, state, `plan state at ${path}`);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(checked, null, 2)}\n`);
}
