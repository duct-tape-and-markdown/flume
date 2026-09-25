/**
 * Agent — the seam between the dispatcher and an LLM CLI.
 *
 * How many providers the tree ships, and what it takes to add one, is stated
 * at the {@link Agent} interface. We deliberately do not abstract over
 * streaming, structured outputs, or session continuity; those are non-goals.
 */

import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { basename, toNamespacedPath } from "node:path";
import { fsStamp, namespacedJoin, plainPath } from "./paths.js";
import {
  assistantTurnText,
  contentBlocksOfType,
  isAssistantEvent,
  isErrorResult,
  isResultEvent,
  parseNdjsonLine,
  type NdjsonEvent,
} from "./streamJson.js";
import {
  budgetHookCommand,
  HOOK_EVENT_NAME,
  type BudgetDeclaration,
} from "./budgetHook.js";
import { spawnProcessTree, terminateProcessTree } from "./processTree.js";
import { isWin32ShimSpawnFailure } from "./spawnShim.js";

/**
 * One agent run, parameterized by cwd, prompt, and stream/abort hooks. The
 * dispatcher constructs one per tick (or one per worktree for fanout) and
 * hands it to `Agent.invoke`.
 */
export interface AgentInvocation {
  /** Working directory for the agent process. */
  cwd: string;
  /** Fully-rendered prompt (substitution + inline-exec already applied). */
  prompt: string;
  /**
   * Tag of the provisioned entry this invocation is running — the same fact
   * the tick verdict's `TickVerdictInvocation.entryTag` row carries, on the
   * one surface a decorator can read. A decorator is composed from a `Phase.agent`
   * getter that holds no `TickContext`, so this is the only place the tag is
   * reachable without re-parsing the rendered prompt.
   *
   * Set under fanout, absent under singleton — which provisions no entry and
   * so has no tag to state, the same rule the verdict row follows. Not the
   * worktree key: `WorktreeSetupContext.worktreeKey` falls back to the phase
   * name under singleton, where this field stays absent.
   */
  entryTag?: string;
  /**
   * Optional abort signal for cancellation — the dispatcher forwards the
   * tick's own stop signal here (`DispatcherOptions.stopSignal`), which is
   * how a signalled `flume tick` reaches the agent it started.
   *
   * A provider that aborts **takes its whole process tree down and settles on
   * that tree's exit**, never on the abort itself: the caller releases the
   * guards over the state root the moment this promise settles, so settling
   * early hands that root to the next acquirer with a live writer inside it
   * (spec/loop.md, "The loop lock and the tip claim").
   */
  signal?: AbortSignal;
  /**
   * Optional wall-clock timeout in milliseconds. When set, the provider must
   * abort the underlying process after this duration. Combined with `signal`
   * via `AbortSignal.any` if both are present — whichever fires first wins.
   * Callers that don't set either field accept that a hung agent will block
   * the invocation indefinitely.
   */
  timeoutMs?: number;
  /**
   * Milliseconds the aborted process tree gets between its SIGTERM and the
   * SIGKILL that follows — what bounds the wait `signal` and `timeoutMs`
   * above commit the provider to. The dispatcher forwards the chain's
   * `supervisorPolicy.killGraceMs` (`src/Phase.ts`) here, off the tick's own
   * resolved chain; absent takes `DEFAULT_KILL_GRACE_MS`
   * (`src/processTree.ts`). This is the only timer over a signalled tick
   * tree — a `flume loop` above signals its child and waits on it unbounded
   * (spec/loop.md, "The loop lock and the tip claim").
   */
  killGraceMs?: number;
  /**
   * Stream callback for stdout chunks. Chunks are NOT guaranteed to be
   * line-bounded — consumers that need lines must buffer and split on `\n`
   * themselves (see `withTerminalRenderer`).
   */
  onStdout?: (chunk: string) => void;
  /** Stream callback for stderr chunks. Same chunk-boundary caveat as stdout. */
  onStderr?: (chunk: string) => void;
  /**
   * Extra env vars to layer on top of `process.env` for the agent
   * subprocess. The dispatcher populates this from the tick's
   * `Phase.setupWorktree` `{ extraEnv }` return value under either
   * concurrency — each provisions a worktree and runs the hook against it
   * (a fanout wave once per entry, a singleton tick once for its own
   * worktree; spec/worktrees.md "Singleton runs in a worktree"). Absent
   * when the phase declares no hook, or the hook returned no vars.
   */
  extraEnv?: Record<string, string>;
}

/**
 * Cost/telemetry facts read off a `claude -p --output-format stream-json`
 * `result` event, and the values {@link formatResult} renders that event's
 * terminal line from (spec/loop.md "The tick verdict — one facts
 * artifact"). Each field is present only when the event reported it; a
 * field the agent's result didn't carry is absent, never coerced to zero,
 * on both surfaces.
 */
export interface AgentUsage {
  /**
   * The `result` event's `modelUsage` key, when it names exactly one model.
   * `modelUsage` can carry more than one (an ancillary model alongside the
   * turn's primary one) — absent rather than guessed when it does, since
   * nothing on the event says which key is "the" model.
   */
  model?: string;
  turns?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  /**
   * The `result` event's `total_cost_usd` — the cost the agent itself
   * reports for the invocation, lifted at the same decode as the token
   * fields so a chain wanting cost telemetry reads it here rather than
   * re-scanning raw stdout beside the engine.
   */
  costUsd?: number;
}

/**
 * Captured output of a single agent invocation. Returned by `Agent.invoke`
 * once the process exits; the dispatcher reads `exitCode` to log warnings,
 * but stdout/stderr are surfaced as a whole for debugging and decorators.
 */
export interface AgentResult {
  /** Final exit code from the agent process. */
  exitCode: number;
  /** Full captured stdout. */
  stdout: string;
  /** Full captured stderr. */
  stderr: string;
  /**
   * Usage/cost facts lifted from a stream-json `result` event, when the
   * wrapping `Agent` parses one (`withTerminalRenderer`). Absent for a
   * plain-text agent, or when the invocation's stdout carried no `result`
   * event to read from.
   */
  usage?: AgentUsage;
  /**
   * The agent's closing prose, lifted from the full captured stdout by
   * {@link extractFinalMessage} — unbound, provider-specific size policy
   * (a persist-time bound like the dispatcher's `tailBound`) is the caller's
   * job, not the adapter's. A provider that doesn't implement extraction
   * leaves this absent; `claudeCode` always sets it.
   */
  finalMessage?: string;
}

/**
 * Provider seam. One implementation per LLM CLI, and `claudeCode()` is the
 * only one this tree carries; a second exists once some other CLI is adapted
 * to this interface, which is an addition here and no change to the
 * dispatcher — that is what the interface buys. Decorators
 * (`withSessionCapture`, `withTerminalRenderer`) wrap an Agent and return
 * another Agent, so they compose without dispatcher help.
 */
export interface Agent {
  /** Stable identifier; appears in logs. */
  name: string;
  /** One invocation, no in-process iteration. */
  invoke(opts: AgentInvocation): Promise<AgentResult>;
}

// ---------- claudeCode provider ----------

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
 * ({@link AgentInvocation.signal}) — `claude` spawns tools and MCP servers of
 * its own, and every one of them writes in the tick's worktree, so the direct
 * child is never the tree.
 *
 * A win32 shim spawn failure (`src/spawnShim.ts`) retries once through the
 * shell: argv is fixed flags plus chain-authored `extraArgs`, the same
 * quoting tradeoff `shellGate` accepts.
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
            // Detection is shared; the mechanics stay here — a streaming
            // proc is abandoned and re-run, not re-awaited.
            if (!useShell && isWin32ShimSpawnFailure(err)) {
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
 * maintains. The hook runs after every tool call — `"*"` is the matcher that
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

// ---------- session capture decorator ----------

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
 * (`abortError` above) — so the capture failure rides it as `cause` where
 * the rejection has none.
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

// ---------- terminal renderer decorator ----------

/**
 * Options for `withTerminalRenderer`. The default `tag` prefixes each
 * rendered line with `[<basename of cwd>]`, which is what fanout worktrees
 * want; override for custom prefixes or to disambiguate sibling ticks.
 */
export interface TerminalRendererOpts {
  /** Per-line prefix derived from the invocation. Default: `[<cwd basename>]`. */
  tag?: (inv: AgentInvocation) => string;
}

/**
 * Wraps an Agent that emits `claude -p --output-format stream-json --verbose`
 * NDJSON on stdout and forwards a condensed, human-readable summary to the
 * parent's `onStdout` instead of the raw stream. Raw chunks are NOT forwarded
 * — pair this wrapper with `withSessionCapture` (innermost) when full-fidelity
 * transcripts are still wanted on disk:
 *
 *     withTerminalRenderer(
 *       withSessionCapture(claudeCode({ outputFormat: "stream-json" }), { dir })
 *     )
 *
 * The wrapped agent MUST produce stream-json NDJSON — for `claudeCode`, that
 * means `outputFormat: "stream-json"`. Without it, every line falls through
 * the JSON.parse catch and is emitted verbatim with the tag prefix, which is
 * silently wrong rather than an error.
 *
 * Rendered output: one line per `tool_use`, plus a final `result` line with
 * turn count, token usage, cost, and duration. Assistant `thinking`/`text`,
 * `tool_result` payloads, and `system/init` are dropped from the terminal —
 * still present in the captured NDJSON.
 *
 * Lines that don't parse as JSON are passed through as-is so unexpected
 * stderr-on-stdout or warning text still surfaces.
 */
export function withTerminalRenderer(
  agent: Agent,
  opts: TerminalRendererOpts = {},
): Agent {
  const tagFn =
    opts.tag ?? ((inv: AgentInvocation) => `[${basename(inv.cwd) || "tick"}]`);
  return {
    name: `${agent.name}+render`,
    async invoke(inv) {
      const tag = tagFn(inv);
      let buf = "";
      // Set from the same {@link readStreamJsonLine} decode the rendered
      // line is printed from — one read of the `result` event answers both
      // (spec/loop.md "The tick verdict — one facts artifact", "Every
      // agent invocation leaves a usage row").
      let usage: AgentUsage | undefined;
      const emitLine = (line: string): void => {
        const read = readStreamJsonLine(line, tag, inv.cwd);
        if (read.usage) usage = read.usage;
        if (read.rendered !== null) inv.onStdout?.(read.rendered + "\n");
      };
      const wrapped: AgentInvocation = {
        ...inv,
        onStdout: (chunk: string) => {
          buf += chunk;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            emitLine(line);
          }
        },
      };
      let result: AgentResult;
      try {
        result = await agent.invoke(wrapped);
      } finally {
        if (buf.length > 0) {
          emitLine(buf);
          buf = "";
        }
      }
      return usage ? { ...result, usage } : result;
    },
  };
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

/** One NDJSON line, read once: what the terminal shows, and — for a
 * `result` event — the {@link AgentUsage} that same read lifted. */
interface StreamJsonLineRead {
  /** The condensed terminal string, or null to drop the line. */
  rendered: string | null;
  /** Present only for a `result` event, from the read the render used. */
  usage?: AgentUsage;
}

/**
 * Read one NDJSON line to a condensed terminal string, or null to drop it.
 * Non-JSON input is passed through behind the tag prefix so stray warnings
 * and non-stream output still surface — trimmed, as {@link parseNdjsonLine}
 * hands it back, so a win32 child's trailing CR never reaches the terminal.
 *
 * A `result` event is decoded exactly once, by {@link extractResultUsage}:
 * the figures in the rendered line and the usage the invocation reports are
 * the same reading, so a provider key the event stops carrying cannot leave
 * one of them absent and the other confident.
 */
function readStreamJsonLine(
  line: string,
  tag: string,
  cwd: string,
): StreamJsonLineRead {
  const result = parseNdjsonLine(line);
  if (result.kind === "blank" || result.kind === "non-object") {
    return { rendered: null };
  }
  if (result.kind === "parse-error") return { rendered: `${tag} ${result.raw}` };
  const e = result.event;

  if (isAssistantEvent(e)) {
    const lines = contentBlocksOfType(e, "tool_use").map(
      (c) => `${tag} ${formatToolUse(c as unknown as ToolUseBlock, cwd)}`,
    );
    return { rendered: lines.length > 0 ? lines.join("\n") : null };
  }

  if (isResultEvent(e)) {
    const usage = extractResultUsage(e);
    return { rendered: `${tag} ${formatResult(e, usage)}`, usage };
  }

  return { rendered: null };
}

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input?: Record<string, unknown>;
}

function formatToolUse(c: ToolUseBlock, cwd: string): string {
  const name = c.name ?? "?";
  const inp = c.input ?? {};
  const arg = summarizeToolArg(name, inp, cwd);
  return arg ? `${name}(${truncate(arg, 80)})` : name;
}

function summarizeToolArg(name: string, inp: Record<string, unknown>, cwd: string): string {
  const str = (k: string): string => (typeof inp[k] === "string" ? (inp[k] as string) : "");
  switch (name) {
    case "Bash":
      return str("command").split("\n")[0]!;
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return relativize(str("file_path"), cwd);
    case "Grep":
      return str("pattern");
    case "Glob":
      return str("pattern");
    case "WebFetch":
      return str("url");
    case "WebSearch":
      return str("query");
    case "Task":
    case "Agent":
      return str("subagent_type") || str("description");
    case "TodoWrite": {
      const todos = inp.todos;
      return Array.isArray(todos) ? `${todos.length} todos` : "";
    }
    default: {
      const k = Object.keys(inp)[0];
      if (!k) return "";
      const v = inp[k];
      if (typeof v === "string") return `${k}=${v}`;
      try {
        return `${k}=${JSON.stringify(v)}`;
      } catch {
        return k;
      }
    }
  }
}

/**
 * Lift {@link AgentUsage} out of a stream-json `result` event — the one
 * decode of that event, which the terminal's result line is then rendered
 * from. A field the event didn't report is left absent, never defaulted to
 * `0`, and the rendered line carries the same absence.
 */
export function extractResultUsage(e: NdjsonEvent): AgentUsage {
  const usage = (e.usage as Record<string, unknown> | undefined) ?? {};
  const modelUsage = e.modelUsage;
  const modelKeys =
    modelUsage && typeof modelUsage === "object"
      ? Object.keys(modelUsage as Record<string, unknown>)
      : [];
  const out: AgentUsage = {};
  if (modelKeys.length === 1) out.model = modelKeys[0]!;
  if (typeof e.num_turns === "number") out.turns = e.num_turns;
  if (typeof e.duration_ms === "number") out.durationMs = e.duration_ms;
  if (typeof usage.input_tokens === "number") out.inputTokens = usage.input_tokens;
  if (typeof usage.output_tokens === "number") out.outputTokens = usage.output_tokens;
  if (typeof usage.cache_creation_input_tokens === "number") {
    out.cacheCreationInputTokens = usage.cache_creation_input_tokens;
  }
  if (typeof usage.cache_read_input_tokens === "number") {
    out.cacheReadInputTokens = usage.cache_read_input_tokens;
  }
  if (typeof e.total_cost_usd === "number") out.costUsd = e.total_cost_usd;
  return out;
}

/**
 * Render the terminal's result line from the {@link AgentUsage} its caller
 * already decoded off `e` — never a second reading of the event's own keys.
 * A figure the event didn't report is dropped from the line rather than
 * printed as `0`, the absence {@link AgentUsage} keeps; only the turn count
 * spells its absence, as `?`, since the head of the line reads as a count.
 */
function formatResult(e: NdjsonEvent, usage: AgentUsage): string {
  const parts = [
    isErrorResult(e) ? "ERROR" : "result",
    `${usage.turns ?? "?"} turns`,
    usage.inputTokens === undefined ? "" : `${formatTokens(usage.inputTokens)} in`,
    usage.outputTokens === undefined ? "" : `${formatTokens(usage.outputTokens)} out`,
    usage.costUsd === undefined ? "" : `$${usage.costUsd.toFixed(3)}`,
    usage.durationMs === undefined ? "" : `${(usage.durationMs / 1000).toFixed(1)}s`,
  ].filter((p) => p.length > 0);
  return parts.join(" · ");
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function relativize(p: string, cwd: string): string {
  if (!p) return "";
  for (const sep of ["/", "\\"]) {
    if (p.startsWith(cwd + sep)) return p.slice(cwd.length + 1);
  }
  return p;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}
