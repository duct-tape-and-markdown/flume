/**
 * The CLI's stamped narration — the `Logger` every line `flume loop`'s
 * supervisor and its `flume tick` children write to the operator passes
 * through.
 *
 * Its own file because the stamp is the CLI's, never the engine's
 * (`spec/cli.md`, *A log line carries the instant it was written*).
 * `src/log.ts` ships the `Logger` seam and the unstamped `consoleLogger` the
 * engine falls back to, and that default stays what it is: an embedder
 * routing a `Logger` of its own times its lines its own way
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*). Timing
 * them this way is one consumer's opinion, so it lives on the consumer's
 * side of that seam and is handed down to `superviseLoop`
 * (`src/loopSupervisor.ts`) and the tick's `Dispatcher` (`src/Dispatcher.ts`)
 * in place of the default.
 */

import { consoleLogger, type Logger } from "./log.js";

/**
 * Open every line of `message` with `at` as an ISO-8601 UTC timestamp — the
 * spelling the tick verdict (`src/tickVerdict.ts`), the claim file
 * (`src/pidClaim.ts`) and record filenames (`src/paths.ts`) already write, so
 * a log lines up against every other artifact of the run.
 *
 * Per line, not per call: a single `info` may carry an error message that
 * spans lines, and a stamp on the first of them leaves the rest undated at
 * exactly the moment an operator is reading the log for when something
 * happened.
 */
export function stampLines(at: Date, message: string): string {
  const stamp = at.toISOString();
  return message
    .split("\n")
    .map((line) => `${stamp} ${line}`)
    .join("\n");
}

/**
 * A `Logger` that stamps what it is handed through {@link stampLines} and
 * writes it on through `sink` — `consoleLogger` unless a caller names
 * another, so each level keeps the stream the engine default already writes
 * it to (`info` → stdout, `warn`/`error` → stderr).
 *
 * The instant is read per call rather than per logger: a supervisor run is
 * one construction and many lines, and a stamp fixed at construction would
 * date every one of them to the start of the run.
 */
export function stampedLogger(sink: Logger = consoleLogger): Logger {
  return {
    info: (line) => sink.info(stampLines(new Date(), line)),
    warn: (line) => sink.warn(stampLines(new Date(), line)),
    error: (line) => sink.error(stampLines(new Date(), line)),
  };
}
