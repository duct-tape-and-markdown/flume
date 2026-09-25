/**
 * `withTerminalRenderer` — the decorator that reads a stream-json transcript
 * into the condensed lines a terminal shows, and lifts the `result` event's
 * usage facts off the same read.
 *
 * This is the one module that knows what a provider's tools are *called*:
 * the argument summary below is a table of Claude Code tool names, which is
 * presentation and not seam. The event alphabet it walks is shared
 * (`src/streamJson.ts`); the provider that produces the stream is
 * `src/claudeCode.ts`.
 */

import { basename } from "node:path";
import {
  contentBlocksOfType,
  isAssistantEvent,
  isErrorResult,
  isResultEvent,
  parseNdjsonLine,
  type NdjsonEvent,
} from "./streamJson.js";
import type { Agent, AgentInvocation, AgentResult, AgentUsage } from "./Agent.js";

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
 * — pair this wrapper with `withSessionCapture` (`src/sessionCapture.ts`,
 * innermost) when full-fidelity transcripts are still wanted on disk:
 *
 *     withTerminalRenderer(
 *       withSessionCapture(claudeCode({ outputFormat: "stream-json" }), { dir })
 *     )
 *
 * The wrapped agent MUST produce stream-json NDJSON — for `claudeCode`
 * (`src/claudeCode.ts`), that means `outputFormat: "stream-json"`. Without
 * it, every line falls through
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
