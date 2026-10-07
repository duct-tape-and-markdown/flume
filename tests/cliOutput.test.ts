/**
 * The CLI's closed-output door, driven at the function rather than through a
 * verb (`quietOnClosedOutput`, `src/cliOutput.ts`).
 *
 * The spawn-level cases next to the verb the crash was first seen at
 * (`tests/cli.test.ts`) prove the door answers a real closed stdout, and
 * nothing more: they run one verb over one stream, so the arming of stderr
 * beside stdout and the re-raise of every error outside the reader-gone class
 * are carried by nothing. Narrowing the default to stdout alone, or widening
 * the quiet to swallow a disk that filled, reds a case here
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Driving the door directly is what buys those two arms: the streams it is
 * handed are emitters this file owns, so an error can be put on them at a
 * chosen code with no pipe, no child, and no race.
 */

import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { quietOnClosedOutput } from "../src/cliOutput.ts";

/**
 * The codes the door reads as the reader going away, spelled here as the
 * class an operator's `| head -1` produces on some host rather than imported:
 * the set is private to the door, and a case that read it from the door would
 * assert the door against itself. Dropping one there reds the quiet case
 * below, which is the direction that matters — a spelling added there is a
 * host this file does not yet name.
 */
const READER_GONE = ["ECONNRESET", "EOF", "EPIPE", "ERR_STREAM_DESTROYED"] as const;

/** What the door installs: one `'error'` listener per stream it is handed. */
type ErrorListener = (err: unknown) => void;

/** `stream`'s error listeners, typed as what the door puts there. */
const errorListeners = (stream: NodeJS.EventEmitter): ErrorListener[] =>
  stream.listeners("error") as ErrorListener[];

/** A stream error carrying `code`, the shape node puts on the event. */
const streamError = (code: string): Error & { code: string } =>
  Object.assign(new Error(`write ${code}`), { code });

/** `code` off whatever reached the uncaught arm, for a failure message. */
const codeOf = (err: unknown): string =>
  String((err as { code?: unknown } | null | undefined)?.code ?? err);

/**
 * Run `body` with this process's own `uncaughtException` listeners taken
 * away, and answer what reached the case's listener instead.
 *
 * The door's loud arm re-raises on `process.nextTick`, so the throw lands on
 * the process rather than on the emitting call, and the runner's listener
 * would read it as an unhandled error and fail the file whatever the case
 * asserted (`.claude/rules/platform-facts.md`, *vitest's JSON reporter can
 * claim success over a non-zero exit*). The window is case-scoped: the
 * listeners are restored in a `finally`, and vitest runs one file's cases in
 * one worker in sequence, so no sibling case is inside it.
 *
 * `body` is handed the array as it fills, so a case can assert the raise had
 * not happened yet at the moment the emit returned.
 */
async function raisedDuring(
  body: (raised: readonly unknown[]) => void,
): Promise<unknown[]> {
  const installed = process.listeners("uncaughtException");
  const raised: unknown[] = [];
  const capture = (err: unknown): void => {
    raised.push(err);
  };
  process.removeAllListeners("uncaughtException");
  process.on("uncaughtException", capture);
  try {
    body(raised);
    // `setImmediate` is past the whole `nextTick` queue, so a raise the door
    // deferred has already landed when this resolves.
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    process.off("uncaughtException", capture);
    for (const listener of installed) process.on("uncaughtException", listener);
  }
  return raised;
}

describe("the CLI's closed-output door", () => {
  it("quietOnClosedOutput ends a reader-gone error quietly on each stream it is handed", async () => {
    const streams = [new EventEmitter(), new EventEmitter()];
    quietOnClosedOutput(streams);

    let emitted = 0;
    const raised = await raisedDuring(() => {
      for (const stream of streams)
        for (const code of READER_GONE) {
          // `emit` answers whether anything was listening, which is this
          // case's arming: an unarmed emitter throws the error from the call
          // instead, and a `false` here would be a quiet that cost nothing
          // (`.claude/rules/engineering.md`, *A green verdict is proven
          // non-vacuous*).
          expect(stream.emit("error", streamError(code))).toBe(true);
          emitted += 1;
        }
    });

    expect(emitted).toBe(streams.length * READER_GONE.length);
    const codes = raised.map(codeOf);
    expect(codes, `re-raised past the quiet class: ${codes.join(", ")}`).toEqual([]);
  });

  it("quietOnClosedOutput re-raises a stream error that is not the reader going away", async () => {
    const stream = new EventEmitter();
    quietOnClosedOutput([stream]);

    // The disk that filled under a redirected stdout: a write that failed on
    // its own merits, which the door has no business swallowing.
    const full = streamError("ENOSPC");
    const raised = await raisedDuring((landed) => {
      expect(stream.emit("error", full)).toBe(true);
      // Deferred, not thrown from the listener: a throw inside the emit would
      // be caught by `console`'s own `try` at a real write site and lost.
      expect(landed).toEqual([]);
    });

    expect(raised.map(codeOf)).toEqual(["ENOSPC"]);
    expect(raised[0]).toBe(full);
  });

  it("quietOnClosedOutput arms stderr beside stdout when it is handed no streams", async () => {
    const before = {
      stdout: errorListeners(process.stdout),
      stderr: errorListeners(process.stderr),
    };

    quietOnClosedOutput();

    // Taken straight back off the real streams: the door never un-arms, and a
    // handler left on this worker's stdout outlives the case that added it.
    const added = {
      stdout: errorListeners(process.stdout).filter((l) => !before.stdout.includes(l)),
      stderr: errorListeners(process.stderr).filter((l) => !before.stderr.includes(l)),
    };
    for (const listener of added.stdout) process.stdout.off("error", listener);
    for (const listener of added.stderr) process.stderr.off("error", listener);

    expect(added.stdout).toHaveLength(1);
    expect(added.stderr).toHaveLength(1);

    // Each one is the door rather than some other listener: handed the
    // reader-gone class it ends quietly, handed anything else it re-raises.
    const doors = [...added.stdout, ...added.stderr];
    const raised = await raisedDuring(() => {
      for (const door of doors) door(streamError("EPIPE"));
    });
    expect(raised.map(codeOf)).toEqual([]);

    const loud = await raisedDuring(() => {
      for (const door of doors) door(streamError("ENOSPC"));
    });
    expect(loud.map(codeOf)).toEqual(["ENOSPC", "ENOSPC"]);
  });
});
