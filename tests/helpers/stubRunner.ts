/**
 * The one {@link Runner} stand-in the harness tests declare — for the files
 * whose subject is the declaration, the chain factory or the worktree
 * plumbing around a runner, never a run.
 *
 * It exists as a **typed value**, not a cast. A stand-in reached for through
 * an `unknown` cast to {@link Runner} answers to no shape at all: the three
 * operations may be missing, and the result literal may name fields
 * {@link RunResult} dropped and miss fields it gained, with every consumer
 * still green. Typing it puts the check on the rung that can hold it — a
 * field change is a tsc error here, and so at every file that imports this
 * (`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*).
 *
 * Sharing one value is what makes that bite land everywhere at once: four
 * local copies are four places a field change can be hand-patched into
 * agreement one at a time. That reach is also why this file is a subject of
 * the stand-in scan (`tests/stubRunner.test.ts`) rather than outside it: one
 * escape hatch here would be one every adopter inherits. The prose above
 * therefore names the cast it refuses without spelling it — the fix that
 * scan declares for a file holding both an engine import and the literal.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import type { RunResult, Runner } from "../../harness/runner.ts";

/**
 * What a runner reports for a suite it never ran: green over nothing. The
 * judge's own vacuity reader sees `passed: 0`, so a case that unexpectedly
 * drives the stand-in reads zero rather than a fabricated pass.
 */
export const EMPTY_RUN: RunResult = {
  ok: true,
  passed: 0,
  failed: 0,
  names: [],
  failures: [],
};

/**
 * A runner answering the three operations — what a declared factory returns.
 *
 * Its lanes are the single unsplit one, the shape a real runner must carry:
 * a runner constructed with no running lane is refused at construction
 * (`harness/vitestRunner.ts`), so a stand-in declaring none would be a shape
 * no consumer's runner can have.
 */
export const stubRunner: Runner = {
  run: () => Promise.resolve(EMPTY_RUN),
  runAtBase: () => Promise.resolve(EMPTY_RUN),
  lanes: [{ name: "default", excludes: [], runs: true }],
};
