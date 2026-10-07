/**
 * The run-end record — what `<flumeDir>/run-end.json` carries, the write every
 * supervised run ends with, the read `flume status` reports it from, and the
 * way a signalled teardown names its signal to the supervisor that records it.
 *
 * spec/loop.md "Crash equals stop": a run that ends says so on disk, so the
 * next operator reads how the last one went instead of inferring it from what
 * the state root is missing. The record is the engine's own statement —
 * nothing here is reconstructed from a log line, an exit status this process
 * never took, or the shape of what a dead run left behind
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * The writer is `superviseLoop` (`src/loopSupervisor.ts`), at the one point
 * every end of a run passes through; the reader is `statusVerb`
 * (`src/cliStatus.ts`). Two modules on two sides of a file, so the shape, the
 * rendering and the signal's name live here rather than once at each end
 * (`.claude/rules/engineering.md`, *A module is one job*).
 */

import { readFileSync } from "node:fs";

import { existsLoudUnder } from "./fsProbe.js";
import { namespacedJoin, runEndPath } from "./paths.js";
import {
  mkdirUnderStateRoot,
  readUnderStateRoot,
  writeFileUnderStateRoot,
} from "./stateRootAccess.js";

/**
 * Every reason a supervised run ends under, as the end site names it — the
 * five spec/loop.md "Crash equals stop" states outright, and the three walls
 * the supervisor fail-fasts on, which end a run just as finally and would
 * otherwise record nothing.
 *
 * Each is a key, not a sentence: it is what lands on disk, so it survives
 * every rewording of the line that prints it. A list rather than a bare union
 * so a reader can judge the set it is exhaustive over, and module-local because
 * the set reaches a consumer through {@link RunEndCause} rather than on its own
 * (`.claude/rules/engineering.md`, *An export earns its consumer*).
 */
const RUN_END_REASONS = [
  /** The baton emptied: no flag stands and no child is in flight. */
  "hibernation",
  /** `<flumeDir>/stop` was found at a child boundary. */
  "stop-flag",
  /** `--max N` children were started. */
  "tick-budget",
  /** One stage-tagged failure signature repeated to the abort threshold. */
  "abort-threshold",
  /** The run's teardown fired — a Ctrl-C, a SIGTERM, a hangup. */
  "signal",
  /** The chain never resolved, here or in a child. */
  "mount-dead",
  /** Awake flags name phases the resolved chain does not declare. */
  "terminal-misconfiguration",
  /** Every flag standing names a phase an operator holds. */
  "all-held",
  /** A tick's verdict was present and would not read. */
  "unreadable-verdict",
] as const;

/** How one end of a run is spelled on disk. */
type RunEndReason = (typeof RUN_END_REASONS)[number];

/**
 * What the ending supervisor states about its own end, beside the reason: the
 * signal it was torn down by, or the child exit code it fail-fasted on. One or
 * neither — hibernation, the stop flag and the budget each end a run with
 * nothing further to identify it, and a record claiming an exit code for them
 * would be inventing one.
 */
export interface RunEndCause {
  reason: RunEndReason;
  /**
   * The signal the teardown received, as node named it — present only where
   * the teardown named one ({@link signalOfStop}). A run aborted by a caller
   * that named no signal records the reason alone, because that is all it was
   * told.
   */
  signal?: string;
  /**
   * The `flume tick` child's exit code, where a child's exit is what ended the
   * run (`src/exitCodes.ts`). The supervisor's own exit code is the CLI's to
   * decide after this record is written, so it is not restated here
   * (`.claude/rules/engineering.md`, *Derived state is computed, never
   * restated beside its source*).
   */
  tickExitCode?: number;
}

/** What one `<flumeDir>/run-end.json` holds. */
export interface RunEndRecord extends RunEndCause {
  /** When the run ended, ISO-8601 — the instant the record was written. */
  at: string;
}

/** Structural check a parsed JSON value is shaped like a {@link RunEndRecord}. */
function isRunEndRecord(rec: unknown): rec is RunEndRecord {
  if (!rec || typeof rec !== "object") return false;
  const r = rec as Partial<RunEndRecord>;
  return (
    typeof r.reason === "string" &&
    typeof r.at === "string" &&
    (r.signal === undefined || typeof r.signal === "string") &&
    (r.tickExitCode === undefined || typeof r.tickExitCode === "number")
  );
}

/**
 * The subject the state-root access refusal names for this record
 * (`src/stateRootAccess.ts`), on the write and on the read alike — one phrase,
 * so an operator meets the same noun whichever side failed.
 */
const RUN_END_SUBJECT = "the run-end record";

/**
 * Write `cause` as the state root's run-end record, overwriting whatever the
 * previous run left. Refuses the way every other write under the root does
 * (`src/stateRootAccess.ts`); the supervisor answers that refusal rather than
 * losing the run's totals to it.
 *
 * `at` is the caller's so a test can state the instant it asserts; the default
 * is the only value production passes.
 */
export function writeRunEnd(
  flumeDir: string,
  cause: RunEndCause,
  at: Date = new Date(),
): RunEndRecord {
  const record: RunEndRecord = { ...cause, at: at.toISOString() };
  // The root may not exist yet: a run that ends mount-dead before its first
  // child took no lock under it, and this write is then the first thing to
  // reach the path.
  mkdirUnderStateRoot(flumeDir, RUN_END_SUBJECT, flumeDir);
  writeFileUnderStateRoot(
    flumeDir,
    RUN_END_SUBJECT,
    runEndPath(flumeDir),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

/**
 * What a state root has to say about the last run that ended under it.
 *
 * `"unreadable"` is a record that is **there** and will not parse to the
 * shape: its presence is still a fact, and reading it as "no run has ended
 * here" would report an artifact nothing could read as a state nothing wrote
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export type RunEndRead =
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "read"; record: RunEndRecord };

/**
 * Read the state root's run-end record.
 *
 * Absent is the only silent reading and it is **proven** from the path rather
 * than from an errno: `existsLoudUnder` (`src/fsProbe.ts`) descends from the
 * root before it stats the file, so neither a record that is present and
 * unstattable nor one under a root a plain file stands at reads as a root no
 * run has ever ended under — the reading a bare stat takes on win32, where an
 * obstructed ancestor is spelled `ENOENT`
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*). Every failure past that absence refuses, as
 * the `loop.pid` and stop-flag reads beside this one in `flume status` do.
 */
export function readRunEnd(flumeDir: string): RunEndRead {
  const path = runEndPath(flumeDir);
  if (!existsLoudUnder(RUN_END_SUBJECT, flumeDir, path)) return { kind: "absent" };
  const raw = readUnderStateRoot(flumeDir, RUN_END_SUBJECT, () =>
    readFileSync(namespacedJoin(path), "utf8"),
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "unreadable" };
  }
  return isRunEndRecord(parsed)
    ? { kind: "read", record: parsed }
    : { kind: "unreadable" };
}

/**
 * How `flume status` states a record it read (spec/cli.md, *`flume status`
 * owes exactly this*) — the reason, whichever of the signal or the child exit
 * code the ending run named, and the time, in that order.
 *
 * Rendered here beside the record rather than at the verb: the record's writer
 * and its one printer are two modules, and a phrase spelled at the printer
 * would be a second vocabulary for the same facts.
 */
export function runEndLine(record: RunEndRecord): string {
  const named =
    record.signal !== undefined
      ? ` ${record.signal}`
      : record.tickExitCode !== undefined
        ? ` (tick exited ${record.tickExitCode})`
        : "";
  return `last run end: ${record.reason}${named} at ${record.at}`;
}

/**
 * What `flume status` says beside a stale `loop.pid`: the run that took that
 * lock reached no end it could record — a `SIGKILL`, a `TerminateProcess`, a
 * host that went away (spec/loop.md, *Crash equals stop*). Read from the dead
 * lock the run left, never guessed at from a record an **earlier** run wrote,
 * which is the one reading that section rules out.
 */
export const RUN_DIED_UNRECORDED_LINE =
  "last run end: the current run died without recording an end";

/**
 * What `flume status` says over a record that is there and will not read. Its
 * presence is reported rather than swallowed, for the reason
 * {@link RunEndRead} gives.
 */
export const RUN_END_UNREADABLE_LINE =
  "last run end: run-end.json present but unreadable";

/**
 * How a signalled teardown states which signal it took, for the supervisor
 * that records the end — the reason it aborts the run's stop signal with.
 *
 * The teardown knows the signal's name and the supervisor does not, and the
 * one channel already between them is that `AbortSignal`. So the name travels
 * as a statement on it rather than being inferred from an exit code the
 * supervisor never sees (`.claude/rules/engine-boundary.md`, *Told, not
 * inferred*).
 */
interface SignalledStop {
  /** The signal the teardown received, as node named it. */
  readonly endedBySignal: string;
}

/** The abort reason a teardown hands {@link signalOfStop}. */
export function signalledStop(signal: string): SignalledStop {
  return { endedBySignal: signal };
}

/**
 * The signal a run's stop signal was aborted with, where its aborter named one
 * — `undefined` for an abort carrying no such statement, which stays a
 * signalled end with nothing further said about it.
 */
export function signalOfStop(signal: AbortSignal): string | undefined {
  const reason: unknown = signal.reason;
  if (!reason || typeof reason !== "object") return undefined;
  const named = (reason as Partial<SignalledStop>).endedBySignal;
  return typeof named === "string" ? named : undefined;
}
