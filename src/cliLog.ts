/**
 * The CLI's stamped narration — the `Logger` every line the CLI writes to the
 * operator passes through: `flume loop`'s supervisor, its `flume tick`
 * children, and every verb's own refusal.
 *
 * Its own file because both the stamp and the stream are the CLI's, never the
 * engine's (`spec/cli.md`, *A log line carries the instant it was written*).
 * `src/log.ts` ships the `Logger` seam and the unstamped `consoleLogger` the
 * engine falls back to, and that default stays what it is: an embedder
 * routing a `Logger` of its own times its lines and picks its streams its own
 * way (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
 * Timing them this way, and sending every level of them to stderr, is one
 * consumer's opinion, so it lives on the consumer's side of that seam and is
 * handed down to `superviseLoop` (`src/loopSupervisor.ts`) and the tick's
 * `Dispatcher` (`src/Dispatcher.ts`) in place of the default.
 *
 * {@link operatorLog} is this process's one construction of it, and this file
 * is where a verb reaches for it: the observational verbs import it, and the
 * three that hold a dispatcher are handed it on `CliVerbRun.log`
 * (`src/cliRunContext.ts`), because the `Dispatcher` takes a `Logger` as a
 * value either way.
 */

import type { Logger } from "./log.js";

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

/** The one write {@link operatorSink} makes, whichever level was called. */
const toStderr = (line: string): void => console.error(line);

/**
 * Where a stamped line goes: stderr, at every level, so a verb's stdout
 * carries only what the verb itself produced — `flume status`'s rows, `flume
 * log`'s history, the command `flume exclusive` runs — and a pipe over any of
 * them reads the verb's output and nothing the run narrated.
 *
 * Only the CLI's own narration is routed this way. The engine default splits
 * the levels — `consoleLogger` (`src/log.ts`) writes `info` to stdout — and
 * stays what it is: an embedder routing a `Logger` of its own picks its own
 * streams as it times its own lines
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*). So the
 * choice sits on the consumer's side of the seam, beside the stamp, rather
 * than as a default every consumer of the engine inherits.
 *
 * Module-private, and one writer for all three levels: {@link operatorLog} is
 * the one line out of here, and a level spelled its own way is a level a later
 * edit can move off this stream alone.
 */
const operatorSink: Logger = { info: toStderr, warn: toStderr, error: toStderr };

/**
 * A `Logger` that stamps what it is handed through {@link stampLines} and
 * writes it on through `sink` — {@link operatorSink} unless a caller names
 * another, so every level reaches stderr.
 *
 * The instant is read per call rather than per logger: a supervisor run is
 * one construction and many lines, and a stamp fixed at construction would
 * date every one of them to the start of the run.
 */
export function stampedLogger(sink: Logger = operatorSink): Logger {
  return {
    info: (line) => sink.info(stampLines(new Date(), line)),
    warn: (line) => sink.warn(stampLines(new Date(), line)),
    error: (line) => sink.error(stampLines(new Date(), line)),
  };
}

/**
 * Every operator line this process writes, stamped (`spec/cli.md`, *A log line
 * carries the instant it was written*): `loop`'s supervisor, `tick`'s child,
 * every refusal either can take before reaching that narration, and every
 * verb's own refusal past that branch. Which refusals those are is the set of
 * sites that import this logger, never a list kept beside it — a refusal added
 * at one of them leaves no sentence here to update
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 *
 * Module scope here rather than in `src/cli.ts`, and unbranched by verb,
 * because the earliest of those refusals is reached before this process has
 * decided which verb it is running, the last is caught past that frame
 * entirely, and the ones between are written from every verb module that
 * imports it, each of which would otherwise construct its own. A verb that
 * takes one may write the only line of its run, which is the line an operator
 * most needs placed against the rest of the artifacts the run left.
 *
 * Every level of it on stderr ({@link operatorSink}): a tick's summary and a
 * supervisor's own lines are the run narrating itself, the same as a refusal,
 * so none of them reaches the stream an observational verb pipes as data. A
 * verb's own listing is written past this logger entirely — a listing being
 * read rather than a run being narrated.
 *
 * One construction per process is exact rather than a shortcut:
 * {@link stampedLogger} reads the instant per call, never at construction.
 */
export const operatorLog: Logger = stampedLogger();
