/**
 * The CLI's output point — the one answer this process gives when the reader
 * of a verb's listing closes the pipe.
 *
 * `flume status | head -1` is an ordinary operator invocation, and the reader
 * is gone the moment it has its line. Node turns the next write into an
 * asynchronous `'error'` event on the stream rather than a throw the writing
 * call can see, and the only listener there was is `console`'s own noop,
 * which it installs for the duration of one write and removes in that write's
 * `finally`. So the event lands with nothing listening, becomes an uncaught
 * `write EPIPE`, and exits 1 with a stack out of whichever
 * `console.log` happened to be next — measured on node 24.21 at
 * `statusVerb` (`src/cliStatus.ts`). For `status` that prints an observation
 * as its opposite: the verb is specced to exit non-zero only on a file it
 * must read and cannot (`spec/cli.md`, *Subcommand surface*).
 *
 * A reader with enough output is not a failure of the verb, so the answer is
 * that the verb's remaining writes go nowhere and its own exit code stands —
 * whatever that code is. A refusal mid-listing still refuses with its own
 * number, because what the reader did says nothing about what the verb found.
 *
 * One answer for every verb, armed once at the entry ahead of the first
 * write: the stream belongs to the process rather than to any verb, and a
 * per-verb copy is one verb behind the next verb added
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */

/**
 * The error codes that say the far end of one of this process's output pipes
 * is gone, as against a write that failed on its own merits.
 *
 * Four spellings of the one event. `EPIPE` is the first write past the close
 * on posix, and win32 answers the same close over its pipe as `EOF` or
 * `ECONNRESET`. `ERR_STREAM_DESTROYED` is every write *after* that first one:
 * the error destroys the socket on its way out, and a verb mid-listing keeps
 * handing lines to a stream that no longer has a descriptor.
 */
const READER_GONE: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "EOF",
  "EPIPE",
  "ERR_STREAM_DESTROYED",
]);

/**
 * Whether `err` is the reader going away rather than the write failing.
 *
 * Read off the code and nothing else: the message is node's own prose, in
 * node's own locale, and keying on it would be the engine reconstructing a
 * statement it was already told (`.claude/rules/engine-boundary.md`, *Told,
 * not inferred*).
 */
function readerWentAway(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && READER_GONE.has(code);
}

/**
 * Arm `streams` — stdout and stderr by default — so a reader that closed the
 * pipe ends their writes quietly, and nothing else about them goes quiet.
 *
 * Both streams, because the close an operator buys with `2>&1 | head -1`
 * reaches both halves of one pipe, and the door is the same door at each of
 * them.
 *
 * Quiet is the reader-went-away class alone. Every other failure on these
 * streams — the disk that filled under a redirected stdout — still takes the
 * uncaught-exception arm it takes today, re-raised on its own tick rather
 * than thrown from the listener: `console`'s write is wrapped in a `try` that
 * swallows all but a stack overflow, so a throw from inside a synchronous
 * emit would be caught by the very call that failed and lost
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Returns nothing to un-arm. The handlers live as long as the process does,
 * which is the span every verb's writes sit inside.
 */
export function quietOnClosedOutput(
  streams: readonly NodeJS.EventEmitter[] = [process.stdout, process.stderr],
): void {
  for (const stream of streams)
    stream.on("error", (err: unknown) => {
      if (readerWentAway(err)) return;
      process.nextTick(() => {
        throw err;
      });
    });
}
