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
   * Pass `--dangerously-skip-permissions`. v0 default is `true` because every
   * Flume tick runs in a worktree the harness controls. Disable if running
   * against a directory you don't trust the agent in.
   */
  dangerouslySkipPermissions?: boolean;
  /**
   * Output format. `"text"` (default) produces human-readable streaming
   * output. `"stream-json"` adds `--output-format stream-json --verbose` to
   * the argv — required by `withTerminalRenderer` and recommended whenever
   * a downstream consumer wants structured per-turn events.
   */
  outputFormat?: "text" | "stream-json";
  /** Extra flags appended to the `claude` argv (after the format flags). */
  extraArgs?: string[];
}

/**
 * Spawn `claude -p` with the rendered prompt on stdin. Captures stdout +
 * stderr, returns the exit code. Streaming callbacks fire on each chunk so
 * the dispatcher can surface progress.
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
          ...extra,
        ];

        const effective = combineSignals(signal, timeoutMs);
        const proc = spawn(binary, args, {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          ...(effective ? { signal: effective } : {}),
          ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
        });

        let stdout = "";
        let stderr = "";

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

        proc.on("error", (err) => reject(err));
        proc.on("close", (exitCode) =>
          resolve({ exitCode: exitCode ?? -1, stdout, stderr }),
        );

        proc.stdin.write(prompt);
        proc.stdin.end();
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
 * defaults to an ISO-timestamped `.txt` if omitted, so concurrent fanout
 * invocations don't collide on filename.
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
      const name = opts.filename?.(inv) ?? defaultCaptureFilename();
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

function defaultCaptureFilename(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
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
      const emitLine = (line: string): void => {
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
      try {
        return await agent.invoke(wrapped);
      } finally {
        if (buf.length > 0) {
          emitLine(buf);
          buf = "";
        }
      }
    },
  };
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
  const trimmed = line.trim();
  if (!trimmed) return null;
  let evt: unknown;
  try {
    evt = JSON.parse(trimmed);
  } catch {
    return `${tag} ${trimmed}`;
  }
  if (!evt || typeof evt !== "object") return null;
  const e = evt as Record<string, unknown>;
  const type = e.type;

  if (type === "assistant") {
    const msg = e.message as { content?: unknown } | undefined;
    const content = Array.isArray(msg?.content) ? msg!.content : [];
    const lines: string[] = [];
    for (const c of content) {
      if (c && typeof c === "object" && (c as Record<string, unknown>).type === "tool_use") {
        lines.push(`${tag} ${formatToolUse(c as ToolUseBlock, cwd)}`);
      }
    }
    return lines.length > 0 ? lines.join("\n") : null;
  }

  if (type === "result") {
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

function formatResult(e: Record<string, unknown>): string {
  const usage = (e.usage as Record<string, unknown> | undefined) ?? {};
  const turns = e.num_turns ?? "?";
  const ti = num(usage.input_tokens);
  const to = num(usage.output_tokens);
  const cost = typeof e.total_cost_usd === "number" ? `$${e.total_cost_usd.toFixed(3)}` : "";
  const dur = typeof e.duration_ms === "number" ? `${(e.duration_ms / 1000).toFixed(1)}s` : "";
  const head = e.is_error || (e.subtype && e.subtype !== "success") ? "ERROR" : "result";
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
  if (p.startsWith(cwd + "/")) return p.slice(cwd.length + 1);
  return p;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}
