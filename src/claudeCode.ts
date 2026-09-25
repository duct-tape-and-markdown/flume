/**
 * The `claude` CLI as an {@link Agent} — the one provider this tree ships.
 *
 * Everything here is Claude Code's own shape: the argv its flags spell, the
 * settings blob its budget hook is armed through, the rejection an aborted
 * invocation settles with, and the extraction that lifts its closing prose
 * out of a transcript. A second provider is a sibling module implementing
 * the same seam, not an edit here (`src/Agent.ts`).
 */

import {
  assistantTurnText,
  isAssistantEvent,
  isResultEvent,
  parseNdjsonLine,
} from "./streamJson.js";
import {
  budgetHookCommand,
  HOOK_EVENT_NAME,
  type BudgetDeclaration,
} from "./budgetHook.js";
import { spawnProcessTree, terminateProcessTree } from "./processTree.js";
import {
  isWin32ShimSpawnFailure,
  shimRetryRefusal,
  wordShimRetryWouldRewrite,
} from "./spawnShim.js";
import type { Agent } from "./Agent.js";

/**
 * Options for the `claudeCode()` provider. All fields are optional; defaults
 * match the harness's expected runtime (worktree-scoped, permissions skipped,
 * text streaming). Set `outputFormat: "stream-json"` to pair with
 * `withTerminalRenderer`.
 */
export interface ClaudeCodeOptions {
  /** Path to the `claude` binary. Default: resolves from PATH. */
  binary?: string;
  /**
   * Pass `--dangerously-skip-permissions`. Default is `true`: autonomous
   * operation requires it — no tick can pause on a permission prompt — and
   * every Flume tick, singleton and fanout alike, runs in a worktree the
   * harness controls (spec/worktrees.md, "Singleton runs in a worktree").
   * The fence and gates contain what lands in a commit; they do not contain
   * what the agent does to the host mid-tick. Disable if running against a
   * directory you don't trust the agent in.
   */
  dangerouslySkipPermissions?: boolean;
  /**
   * Output format. `"text"` (default) produces human-readable streaming
   * output. `"stream-json"` adds `--output-format stream-json --verbose` to
   * the argv — required by `withTerminalRenderer` and recommended whenever
   * a downstream consumer wants structured per-turn events.
   */
  outputFormat?: "text" | "stream-json";
  /**
   * Load the user's own MCP configuration too. Default is `false`:
   * `--strict-mcp-config` rides the argv, so a tick loads only the MCP
   * configuration the chain hands it. A headless `claude -p` otherwise boots
   * every MCP server the invoking user's own config names — by-user runtime
   * state a stateless tick excludes, and a wedged inherited server has held a
   * finished agent's process open and stalled a whole fanout wave. Set to
   * `true` to inherit anyway; the flag is then omitted.
   */
  inheritUserMcp?: boolean;
  /**
   * Pass `--model <value>`. No default: undeclared, the flag is omitted and
   * the binary's own default applies.
   */
  model?: string;
  /**
   * Report the room this invocation has left, mid-session. Declared, the
   * adapter registers a hook of its own on this invocation's settings alone
   * — never on the user's — that hands the agent a budget line after a tool
   * call: context used against the declared window, elapsed wall clock, and
   * tool calls so far, at the declared cadence and on each declared
   * threshold crossed. Undeclared, no hook is registered and the argv is
   * unchanged.
   */
  budget?: BudgetDeclaration;
  /** Extra flags appended to the `claude` argv (after the format flags). */
  extraArgs?: string[];
}

/**
 * Spawn `claude -p` with the rendered prompt on stdin. Captures stdout +
 * stderr, returns the exit code. Streaming callbacks fire on each chunk so
 * the dispatcher can surface progress.
 *
 * The process leads its own group (`spawnProcessTree`, `src/processTree.ts`),
 * and an abort takes that whole group down and settles on its exit
 * (`AgentInvocation.signal`, `src/Agent.ts`) — `claude` spawns tools and MCP
 * servers of its own, and every one of them writes in the tick's worktree,
 * so the direct child is never the tree.
 *
 * A win32 shim spawn failure (`src/spawnShim.ts`) retries once through the
 * shell, which re-parses the argv it is handed. Whether this invocation's
 * argv survives that re-parse is the shared predicate's to say
 * (`wordShimRetryWouldRewrite`, `src/spawnShim.ts`), read here exactly as
 * the detection already is; only the mechanics stay local, because a
 * streaming child is abandoned and re-run rather than re-awaited. The word
 * that reaches that predicate first is the `--settings` value a declared
 * `budget` composes — inline JSON whose every quote the re-parse eats
 * (`budgetSettings` below).
 */
export function claudeCode(opts: ClaudeCodeOptions = {}): Agent {
  const binary = opts.binary ?? "claude";
  const skipPerms = opts.dangerouslySkipPermissions ?? true;
  const inheritUserMcp = opts.inheritUserMcp ?? false;
  const outputFormat = opts.outputFormat ?? "text";
  const formatArgs =
    outputFormat === "stream-json"
      ? ["--output-format", "stream-json", "--verbose"]
      : [];
  const extra = opts.extraArgs ?? [];
  // Rendered once, as the agent is built: a declaration the hook cannot be
  // run on throws here, where a chain author is standing, rather than once
  // per tool call into a hook's stderr.
  const budgetArgs =
    opts.budget === undefined
      ? []
      : ["--settings", budgetSettings(opts.budget)];

  return {
    name: "claude-code",
    invoke({
      cwd,
      prompt,
      signal,
      timeoutMs,
      killGraceMs,
      onStdout,
      onStderr,
      extraEnv,
    }) {
      return new Promise((resolve, reject) => {
        const args = [
          "-p",
          ...formatArgs,
          ...(skipPerms ? ["--dangerously-skip-permissions"] : []),
          ...(inheritUserMcp ? [] : ["--strict-mcp-config"]),
          ...(opts.model !== undefined ? ["--model", opts.model] : []),
          ...budgetArgs,
          ...extra,
        ];

        const effective = combineSignals(signal, timeoutMs);

        const run = (useShell: boolean): void => {
          // Aborted before this attempt started: there is no tree to take
          // down, and spawning one only to signal it would leave a process
          // the caller was already told to stop.
          if (effective?.aborted) {
            reject(abortError(effective.reason));
            return;
          }
          const proc = spawnProcessTree(binary, args, {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
            ...(useShell ? { shell: true } : {}),
            ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
          });

          let stdout = "";
          let stderr = "";
          // Set when this proc is superseded by the shell retry; its late
          // 'close' (spawn failures can emit both) must not settle the promise.
          let abandoned = false;
          // Set when the abort below fired, so 'close' knows the exit it is
          // seeing is the teardown's rather than the agent's own.
          let aborted = false;

          // Wired by hand rather than through spawn's own `signal` option:
          // that option kills the direct child only and reports the abort as
          // an 'error' event, so the promise settled while the tools and MCP
          // servers `claude` spawned were still running under the state root
          // the caller is about to release. Here the abort signals the whole
          // group and settlement waits for its exit.
          const onAbort = (): void => {
            aborted = true;
            terminateProcessTree(proc, {
              ...(killGraceMs !== undefined ? { graceMs: killGraceMs } : {}),
            });
          };
          effective?.addEventListener("abort", onAbort, { once: true });
          const release = (): void => {
            effective?.removeEventListener("abort", onAbort);
          };

          proc.stdout.setEncoding("utf8");
          proc.stderr.setEncoding("utf8");

          proc.stdout.on("data", (chunk: string) => {
            stdout += chunk;
            onStdout?.(chunk);
          });

          proc.stderr.on("data", (chunk: string) => {
            stderr += chunk;
            onStderr?.(chunk);
          });

          proc.on("error", (err) => {
            if (abandoned) return;
            release();
            // Detection and the verdict on this argv are both shared; the
            // mechanics stay here — a streaming proc is abandoned and
            // re-run, not re-awaited.
            if (!useShell && isWin32ShimSpawnFailure(err)) {
              const rewritten = wordShimRetryWouldRewrite([binary, ...args]);
              if (rewritten !== undefined) {
                reject(shimRetryRefusal(binary, rewritten, err));
                return;
              }
              abandoned = true;
              run(true);
              return;
            }
            reject(err);
          });
          proc.on("close", (exitCode) => {
            if (abandoned) return;
            release();
            // The tree this invocation started is gone — only now is the
            // abort the caller asked for an accomplished fact, so only now
            // does it settle, as the error the dispatcher classifies as a
            // platform-preempt.
            if (aborted) {
              reject(abortError(effective?.reason));
              return;
            }
            resolve({
              exitCode: exitCode ?? -1,
              stdout,
              stderr,
              finalMessage: extractFinalMessage(stdout),
            });
          });

          // A failed spawn destroys stdin with the prompt write still queued,
          // which raises on the stream; settlement is owned by the proc-level
          // 'error'/'close' handlers above.
          proc.stdin.on("error", () => {});
          proc.stdin.write(prompt);
          proc.stdin.end();
        };

        run(false);
      });
    },
  };
}

/**
 * The chain's budget declaration as one invocation's own settings, for the
 * provider's `--settings` flag.
 *
 * Inline JSON rather than a settings file: the flag takes either, and a
 * value that never lands on disk cannot be read by a second invocation, left
 * behind by a tick that was killed, or confused with the settings the user
 * maintains.
 *
 * It is also the word of this argv a win32 shell retry cannot carry, which
 * that retry refuses on rather than quotes: the fence this value would need
 * is the one `cmd.exe` applies over a batch shim, and `shellQuote`
 * (`src/budgetHook.ts`) is written for the shell the provider runs a hook's
 * command in, which is not that shell. An invocation whose spawn needs the
 * shim fallback is told it cannot have both (`shimRetryRefusal`,
 * `src/spawnShim.ts`), and the remedy is a binary node can spawn directly or
 * a chain that declares no budget on this agent. The hook runs after every tool call — `"*"` is the matcher that
 * says so — and what it does with each one is the hook's own
 * (`budgetLineDue`, `src/budgetHook.ts`).
 */
function budgetSettings(budget: BudgetDeclaration): string {
  return JSON.stringify({
    hooks: {
      [HOOK_EVENT_NAME]: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: budgetHookCommand(budget) }],
        },
      ],
    },
  });
}

/**
 * The rejection an aborted invocation settles with, in the shape Node's own
 * `spawn({ signal })` produced before the teardown above replaced it: `name`
 * and `code` are what a tick classifies a platform-preempt by
 * (`invokeAgent`, `src/tickAttempt.ts`), and the signal's own reason rides as
 * `cause` so a
 * timeout and a stop signal stay distinguishable to a reader.
 */
function abortError(reason: unknown): Error {
  const err = new Error("The operation was aborted", { cause: reason }) as Error & {
    code?: string;
  };
  err.name = "AbortError";
  err.code = "ABORT_ERR";
  return err;
}

function combineSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  if (timeoutMs === undefined) return signal;
  const timeout = AbortSignal.timeout(timeoutMs);
  if (signal === undefined) return timeout;
  return AbortSignal.any([signal, timeout]);
}

/**
 * The agent's final message, lifted from the full captured stdout — the
 * spec/chain.md "The agent seam" extraction every `Agent.invoke`
 * implementation owns for its own transcript shape. Unbound: a caller that
 * persists this (the dispatcher's clean-exit record — `spec/loop.md`, "The
 * no-commit taxonomy") applies its own size policy — record-size bounding
 * is not provider shape.
 *
 * `claudeCode({ outputFormat: "stream-json" })` produces NDJSON on stdout,
 * not prose — tailing it raw forwards escaped-JSON assistant/result events
 * plus cost/usage metadata, exactly the noise this extraction exists to
 * replace with the agent's closing prose. Three cases:
 *
 *  - stream-json: the terminal `result` event's `result` text (Claude Code
 *    puts the final assistant message there verbatim).
 *  - stream-json with no result text: the last `assistant` turn's
 *    concatenated text blocks.
 *  - plain text (`outputFormat: "text"`, the default): stdout already IS the
 *    final message, returned trimmed and unchanged — no stream-json events
 *    to parse.
 *
 * When stream-json was detected but neither event carried text, falls back
 * to the raw transcript trimmed — never empty, which would silently drop
 * whatever the agent closed on (`.claude/rules/engineering.md`, "Loud or
 * nothing").
 */
export function extractFinalMessage(stdout: string): string {
  let sawStreamJson = false;
  let resultText: string | undefined;
  let lastAssistantText: string | undefined;

  for (const raw of stdout.split("\n")) {
    const parsed = parseNdjsonLine(raw);
    if (parsed.kind !== "event") continue;
    const e = parsed.event;
    if (typeof e.type !== "string") continue;
    sawStreamJson = true;
    if (isResultEvent(e)) {
      if (typeof e.result === "string" && e.result.trim().length > 0) {
        resultText = e.result.trim();
      }
    } else if (isAssistantEvent(e)) {
      const text = assistantTurnText(e);
      if (text.length > 0) lastAssistantText = text;
    }
  }

  if (!sawStreamJson) return stdout.trim();
  if (resultText !== undefined || lastAssistantText !== undefined) {
    return (resultText ?? lastAssistantText) as string;
  }
  return stdout.trim();
}
