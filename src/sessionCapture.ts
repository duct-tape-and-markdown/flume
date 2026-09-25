/**
 * `withSessionCapture` — the decorator that tees an invocation's stdout to a
 * file as it arrives.
 *
 * Provider-agnostic: it wraps any {@link Agent} (`src/Agent.ts`) and reads
 * nothing out of the bytes it writes. What those bytes mean is the
 * provider's and the renderer's; this module owns the file, its name, and
 * what happens when the write fails.
 */

import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { basename, toNamespacedPath } from "node:path";
import { fsStamp, namespacedJoin, plainPath } from "./paths.js";
import type { Agent, AgentInvocation } from "./Agent.js";

/**
 * Options for `withSessionCapture`. `dir` is created on demand; `filename`
 * defaults to an ISO-timestamped name suffixed with the invocation's `cwd`
 * basename if omitted, so concurrent fanout invocations (distinct cwds,
 * same clock tick) don't collide on filename. Two invocations sharing both
 * clock tick and cwd still collide — not reachable through the dispatcher,
 * which gives fanout invocations distinct worktree cwds.
 */
export interface SessionCaptureOpts {
  /** Directory to write session output files into. Created if missing. */
  dir: string;
  /** Function generating the filename for a given invocation. */
  filename?: (inv: AgentInvocation) => string;
}

/**
 * Wraps an Agent to tee stdout chunks to a file as they arrive. Useful
 * for capturing per-tick session transcripts, especially in combination
 * with `claude -p --output-format stream-json` for machine-readable
 * NDJSON output.
 *
 * The file is created when the invocation starts and closed when it
 * resolves (success or failure). Stderr is not captured to file; the
 * underlying agent's `onStderr` still fires normally.
 *
 * A capture that fails — the open refused, a write or the flush errored —
 * is this invocation's error, raised once the wrapped agent has settled and
 * the stream is closed. Nothing aborts the agent for it: the tree under the
 * invocation's cwd is still running, so the failure waits rather than
 * leaving the process to die on an unhandled stream `error` mid-tick. A
 * wrapped agent that rejects on its own keeps its own rejection — that call
 * is already loud, and its shape is what a caller classifies a preempt by
 * (`abortError`, `src/claudeCode.ts`) — so the capture failure rides it as
 * `cause` where the rejection has none.
 */
export function withSessionCapture(
  agent: Agent,
  opts: SessionCaptureOpts,
): Agent {
  return {
    name: `${agent.name}+capture`,
    async invoke(inv) {
      await mkdir(toNamespacedPath(opts.dir), { recursive: true });
      const name = opts.filename?.(inv) ?? defaultCaptureFilename(inv);
      const file = namespacedJoin(opts.dir, name);
      const stream = createWriteStream(file, { encoding: "utf8" });
      let captureError: unknown;
      stream.on("error", (err) => {
        captureError ??= err;
      });
      const wrapped: AgentInvocation = {
        ...inv,
        onStdout: (chunk) => {
          stream.write(chunk);
          inv.onStdout?.(chunk);
        },
      };
      const settled = await agent.invoke(wrapped).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await new Promise<void>((r) => stream.end(r));
      if (!settled.ok) {
        if (captureError !== undefined) attachCause(settled.error, captureError);
        throw settled.error;
      }
      if (captureError !== undefined) {
        throw new Error(`session capture failed for ${plainPath(file)}`, {
          cause: captureError,
        });
      }
      return settled.value;
    },
  };
}

/**
 * Records a second failure on an error that is already being thrown, where
 * doing so costs the reader nothing: an error carrying its own `cause` keeps
 * it.
 */
function attachCause(err: unknown, cause: unknown): void {
  if (err instanceof Error && err.cause === undefined) err.cause = cause;
}

function defaultCaptureFilename(inv: AgentInvocation): string {
  const ts = fsStamp();
  const cwdName = basename(inv.cwd) || "tick";
  return `${ts}-${cwdName}.txt`;
}
