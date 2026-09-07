/**
 * Agent — the seam between the dispatcher and an LLM CLI.
 *
 * v0 ships one implementation: `claudeCode()`. The interface exists so a
 * future provider (codex, gemini, etc.) can slot in without touching the
 * dispatcher. We deliberately do not abstract over streaming, structured
 * outputs, or session continuity; those are non-goals.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { basename, join } from "node:path";

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
  /** Optional abort signal for cancellation. */
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
   * Stream callback for stdout chunks. Chunks are NOT guaranteed to be
   * line-bounded — consumers that need lines must buffer and split on `\n`
   * themselves (see `withTerminalRenderer`).
   */
  onStdout?: (chunk: string) => void;
  /** Stream callback for stderr chunks. Same chunk-boundary caveat as stdout. */
  onStderr?: (chunk: string) => void;
  /**
   * Extra env vars to layer on top of `process.env` for the agent
   * subprocess. The dispatcher populates this from
   * `Phase.setupWorktree`'s `{ extraEnv }` return value for fanout
   * phases. Singleton phases never carry extraEnv.
   */
  extraEnv?: Record<string, string>;
}

/**
 * Cost/telemetry facts read off a `claude -p --output-format stream-json`
 * `result` event — the same event {@link formatResult} renders to the
 * terminal (spec/loop.md "The tick verdict — one facts artifact"). Each
 * field is present only when the event reported it; a field the agent's
 * result didn't carry is absent, never coerced to zero.
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
 * Provider seam. One implementation per LLM CLI; v0 ships `claudeCode()`
 * only. Decorators (`withSessionCapture`, `withTerminalRenderer`) wrap an
 * Agent and return another Agent, so they compose without dispatcher help.
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
   * Pass `--model <value>`. No default: undeclared, the flag is omitted and
   * the binary's own default applies.
   */
  model?: string;
  /** Extra flags appended to the `claude` argv (after the format flags). */
  extraArgs?: string[];
}

/**
 * Spawn `claude -p` with the rendered prompt on stdin. Captures stdout +
 * stderr, returns the exit code. Streaming callbacks fire on each chunk so
 * the dispatcher can surface progress.
 *
 * On Windows, an npm-installed `claude` is a `.cmd` shim, which Node
 * refuses to spawn without a shell (CVE-2024-27980 hardening). The direct
 * spawn is tried first so args keep exact quoting; a win32 ENOENT retries
 * once through the shell — argv is fixed flags plus chain-authored
 * `extraArgs`, the same quoting tradeoff `shellGate` accepts.
 */
export function claudeCode(opts: ClaudeCodeOptions = {}): Agent {
  const binary = opts.binary ?? "claude";
  const skipPerms = opts.dangerouslySkipPermissions ?? true;
  const outputFormat = opts.outputFormat ?? "text";
  const formatArgs =
    outputFormat === "stream-json"
      ? ["--output-format", "stream-json", "--verbose"]
      : [];
  const extra = opts.extraArgs ?? [];

  return {
    name: "claude-code",
    invoke({ cwd, prompt, signal, timeoutMs, onStdout, onStderr, extraEnv }) {
      return new Promise((resolve, reject) => {
        const args = [
          "-p",
          ...formatArgs,
          ...(skipPerms ? ["--dangerously-skip-permissions"] : []),
          ...(opts.model !== undefined ? ["--model", opts.model] : []),
          ...extra,
        ];

        const effective = combineSignals(signal, timeoutMs);

        const run = (useShell: boolean): void => {
          const proc = spawn(binary, args, {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
            ...(useShell ? { shell: true } : {}),
            ...(effective ? { signal: effective } : {}),
            ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
          });

          let stdout = "";
          let stderr = "";
          // Set when this proc is superseded by the shell retry; its late
          // 'close' (spawn failures can emit both) must not settle the promise.
          let abandoned = false;

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
            if (
              !useShell &&
              process.platform === "win32" &&
              (err as NodeJS.ErrnoException).code === "ENOENT"
            ) {
              abandoned = true;
              run(true);
              return;
            }
            reject(err);
          });
          proc.on("close", (exitCode) => {
            if (abandoned) return;
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
 */
export function withSessionCapture(
  agent: Agent,
  opts: SessionCaptureOpts,
): Agent {
  return {
    name: `${agent.name}+capture`,
    async invoke(inv) {
      await mkdir(opts.dir, { recursive: true });
      const name = opts.filename?.(inv) ?? defaultCaptureFilename(inv);
      const stream = createWriteStream(join(opts.dir, name), {
        encoding: "utf8",
      });
      const wrapped: AgentInvocation = {
        ...inv,
        onStdout: (chunk) => {
          stream.write(chunk);
          inv.onStdout?.(chunk);
        },
      };
      try {
        return await agent.invoke(wrapped);
      } finally {
        await new Promise<void>((r) => stream.end(r));
      }
    },
  };
}

function defaultCaptureFilename(inv: AgentInvocation): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
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
      // Set alongside the render when a `result` event is seen — the same
      // per-line walk `formatResult` already runs, not a second parser over
      // the transcript (spec/loop.md "The tick verdict", "Every agent
      // invocation leaves a usage row").
      let usage: AgentUsage | undefined;
      const emitLine = (line: string): void => {
        const parsed = parseNdjsonLine(line);
        if (parsed.kind === "event" && isResultEvent(parsed.event)) {
          usage = extractResultUsage(parsed.event);
        }
        const rendered = renderStreamJsonLine(line, tag, inv.cwd);
        if (rendered !== null) inv.onStdout?.(rendered + "\n");
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

/** One parsed `claude -p --output-format stream-json` NDJSON event. */
export type NdjsonEvent = Record<string, unknown>;

/**
 * Result of {@link parseNdjsonLine}: `"blank"` for a whitespace-only line,
 * `"parse-error"` for text that doesn't parse as JSON (carries the trimmed
 * raw text so a caller can pass it through), `"non-object"` for JSON that
 * parses but isn't an event object (e.g. a bare number or array), and
 * `"event"` for a genuine stream-json event.
 */
export type NdjsonLineResult =
  | { kind: "blank" }
  | { kind: "parse-error"; raw: string }
  | { kind: "non-object" }
  | { kind: "event"; event: NdjsonEvent };

/**
 * Parse one line of a `claude -p --output-format stream-json` NDJSON
 * transcript. Shared by {@link renderStreamJsonLine} (terminal rendering)
 * and the dispatcher's voluntary-bail message extraction — both walk the
 * same line-parse before diverging on which event/block types they keep.
 */
export function parseNdjsonLine(line: string): NdjsonLineResult {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "blank" };
  let evt: unknown;
  try {
    evt = JSON.parse(trimmed);
  } catch {
    return { kind: "parse-error", raw: trimmed };
  }
  if (!evt || typeof evt !== "object") return { kind: "non-object" };
  return { kind: "event", event: evt as NdjsonEvent };
}

/**
 * Blocks of `blockType` in a stream-json `assistant`/`user` event's
 * `message.content[]` (e.g. `"tool_use"`, `"text"`). Non-array/missing
 * `content` yields no blocks.
 */
export function contentBlocksOfType(
  event: NdjsonEvent,
  blockType: string,
): Record<string, unknown>[] {
  const msg = event.message as { content?: unknown } | undefined;
  const content = Array.isArray(msg?.content) ? msg!.content : [];
  return content.filter(
    (c): c is Record<string, unknown> =>
      !!c && typeof c === "object" && (c as Record<string, unknown>).type === blockType,
  );
}

/**
 * Stream-json event-type vocabulary, shared by every reader that classifies
 * an NDJSON event: `renderStreamJsonLine` below and `extractFinalMessage`.
 * The `"assistant"`/`"result"` literals and the `is_error`/`subtype` error
 * rule live here once so two readers can't drift on what counts as which
 * event.
 */
export function isAssistantEvent(event: NdjsonEvent): boolean {
  return event.type === "assistant";
}

export function isResultEvent(event: NdjsonEvent): boolean {
  return event.type === "result";
}

/** A `result` event's `is_error`/non-`"success"` `subtype` marks failure. */
export function isErrorResult(event: NdjsonEvent): boolean {
  return Boolean(event.is_error) || Boolean(event.subtype && event.subtype !== "success");
}

/**
 * Concatenated `text` blocks of one stream-json `assistant` event;
 * `tool_use`/`thinking` blocks are dropped (they are not the agent's prose).
 */
export function assistantTurnText(e: NdjsonEvent): string {
  const parts = contentBlocksOfType(e, "text")
    .filter((c) => typeof c.text === "string")
    .map((c) => (c.text as string).trim());
  return parts.join("\n\n").trim();
}

/**
 * The agent's final message, lifted from the full captured stdout — the
 * spec/chain.md "agent seam" extraction every `Agent.invoke` implementation
 * owns for its own transcript shape. Unbound: a caller that persists this
 * (the dispatcher's §6 voluntary-bail record) applies its own size policy —
 * record-size bounding is not provider shape.
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
 * to the raw transcript trimmed — never empty, which would silently drop a
 * bail's refused constraint (`.claude/rules/engineering.md`, "Loud or
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

/**
 * Render one NDJSON line to a condensed terminal string, or null to drop it.
 * Non-JSON input is passed through verbatim (prefixed with the tag) so stray
 * warnings or non-stream output still surface.
 */
function renderStreamJsonLine(
  line: string,
  tag: string,
  cwd: string,
): string | null {
  const result = parseNdjsonLine(line);
  if (result.kind === "blank" || result.kind === "non-object") return null;
  if (result.kind === "parse-error") return `${tag} ${result.raw}`;
  const e = result.event;

  if (isAssistantEvent(e)) {
    const lines = contentBlocksOfType(e, "tool_use").map(
      (c) => `${tag} ${formatToolUse(c as unknown as ToolUseBlock, cwd)}`,
    );
    return lines.length > 0 ? lines.join("\n") : null;
  }

  if (isResultEvent(e)) {
    return `${tag} ${formatResult(e)}`;
  }

  return null;
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
 * Lift {@link AgentUsage} out of a stream-json `result` event — the same
 * event object {@link formatResult} renders to the terminal. A field the
 * event didn't report is left absent, never defaulted to `0`.
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
  return out;
}

function formatResult(e: Record<string, unknown>): string {
  const usage = (e.usage as Record<string, unknown> | undefined) ?? {};
  const turns = e.num_turns ?? "?";
  const ti = num(usage.input_tokens);
  const to = num(usage.output_tokens);
  const cost = typeof e.total_cost_usd === "number" ? `$${e.total_cost_usd.toFixed(3)}` : "";
  const dur = typeof e.duration_ms === "number" ? `${(e.duration_ms / 1000).toFixed(1)}s` : "";
  const head = isErrorResult(e) ? "ERROR" : "result";
  const parts = [head, `${turns} turns`, `${formatTokens(ti)} in`, `${formatTokens(to)} out`, cost, dur].filter(
    (p) => p && p.length > 0,
  );
  return parts.join(" · ");
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
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
