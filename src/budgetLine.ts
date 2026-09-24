/**
 * The budget line — the facts a mid-session tool call hands the agent about
 * the room it has left, composed from the session transcript the provider
 * points the hook at (`spec/chain.md`, *The agent seam*).
 *
 * Stateless by construction: every fact on the line is read off that one
 * file, so the hook that prints it holds nothing between calls and the
 * adapter passes it nothing it could not read for itself. Facts, never a
 * verdict — what an agent does at eighty percent of its window is the
 * prompt's to say.
 *
 * The transcript speaks the event vocabulary the adapter's stdout reader
 * already knows, so the line parse, the assistant discriminant and the
 * content-block walk are imported from `src/streamJson.ts` rather than
 * spelled a second time here. What this module adds is the transcript's own shape: an
 * assistant event's usage, whose input, cache-read and cache-creation tokens
 * together are the context that turn occupied
 * (`.claude/rules/platform-facts.md`, *stream-json assistant events carry
 * per-message usage*), and the timestamp each event carries, whose earliest
 * is the session's clock origin.
 *
 * That usage fact carries a stated expiry — an assistant event arriving
 * without usage ends it. At that point this read composes no line and says
 * why, rather than reporting a context size it invented from missing fields
 * (`.claude/rules/engineering.md`, *Loud or nothing*). That is the one quiet
 * arm here, and the reason it carries is what keeps it from being silent.
 */

import { readFile } from "node:fs/promises";
import { toNamespacedPath } from "node:path";

import {
  contentBlocksOfType,
  isAssistantEvent,
  parseNdjsonLine,
} from "./streamJson.js";

/** What the chain declared, plus the clock the elapsed reading is taken on. */
export interface BudgetLineOptions {
  /**
   * The model's context window in tokens, as the chain declared it — a
   * provider fact the engine does not hold, so it is told rather than looked
   * up. Absent, the line states elapsed and tool calls alone: the window is
   * the only thing a context count can be reported against.
   */
  contextWindow?: number;
  /** Clock the elapsed reading is taken against. Default `Date.now()`. */
  now?: number;
}

/** The facts the line states, before they are formatted into it. */
export interface BudgetReading {
  /** Context tokens the transcript's latest assistant turn occupied. */
  contextTokens: number;
  /** Tool-use blocks across every assistant event in the transcript. */
  toolCalls: number;
  /** Milliseconds from the transcript's first timestamped event to now. */
  elapsedMs: number;
  /**
   * Context against the declared window, present only when one was
   * declared — the value the line's percentage rounds, and the one a
   * threshold is crossed against.
   */
  contextFraction?: number;
  /**
   * The same fraction one assistant turn earlier — the other side a
   * crossing is decided on, since a threshold is crossed by a turn that
   * passed it and not by every turn after. Absent where no window was
   * declared, where the latest turn is the transcript's first, or where the
   * turn before it reported no usage; a caller deciding a crossing reads
   * absence as "below every threshold", which re-reports a crossing rather
   * than swallowing one.
   */
  priorContextFraction?: number;
}

/**
 * Either the composed line with the reading behind it, or no line and the
 * reason there is none. A caller that wants the facts without the prose
 * reads `reading`; the hook prints `line`.
 */
export type BudgetLineRead =
  | { kind: "line"; line: string; reading: BudgetReading }
  | { kind: "none"; reason: string };

/**
 * The budget line for one session transcript, read at `transcriptPath`.
 *
 * A path that does not read throws: a transcript the provider named and the
 * host cannot open is a failure at the point of detection, not something to
 * compose a line around. What that failure does to the agent's turn is the
 * calling hook's to decide.
 */
export async function readBudgetLine(
  transcriptPath: string,
  opts: BudgetLineOptions = {},
): Promise<BudgetLineRead> {
  const { contextWindow } = opts;
  if (
    contextWindow !== undefined &&
    (!Number.isFinite(contextWindow) || contextWindow <= 0)
  ) {
    throw new Error(
      `budget: contextWindow must be a positive number of tokens, got ${contextWindow}`,
    );
  }
  const transcript = await readFile(toNamespacedPath(transcriptPath), "utf8");
  return budgetLineFrom(transcript, opts);
}

/** The three token fields whose sum is the context a turn occupied. */
const CONTEXT_TOKEN_FIELDS = [
  "input_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
] as const;

function budgetLineFrom(
  transcript: string,
  opts: BudgetLineOptions,
): BudgetLineRead {
  let firstEventMs: number | undefined;
  let toolCalls = 0;
  let sawAssistant = false;
  let latestUsage: Record<string, unknown> | undefined;
  let priorUsage: Record<string, unknown> | undefined;

  for (const raw of transcript.split("\n")) {
    const parsed = parseNdjsonLine(raw);
    if (parsed.kind !== "event") continue;
    const event = parsed.event;
    if (firstEventMs === undefined) firstEventMs = eventTimeMs(event);
    if (!isAssistantEvent(event)) continue;
    sawAssistant = true;
    toolCalls += contentBlocksOfType(event, "tool_use").length;
    // Assigned every time, absence included: the reading is what the *latest*
    // assistant event carries, so an earlier turn's usage never stands in for
    // a later turn that reported none. The displaced value is the turn
    // before's, which is the only other turn a crossing needs.
    priorUsage = latestUsage;
    latestUsage = eventUsage(event);
  }

  if (!sawAssistant) {
    return {
      kind: "none",
      reason: "the transcript carries no assistant event yet",
    };
  }
  if (latestUsage === undefined) {
    return {
      kind: "none",
      reason:
        "the transcript's latest assistant event carries no usage, so the per-message usage this read is built on has expired",
    };
  }
  const contextTokens = contextTokensOf(latestUsage);
  if (contextTokens === undefined) {
    return {
      kind: "none",
      reason:
        "the latest assistant event's usage names no input, cache-read or cache-creation tokens",
    };
  }
  if (firstEventMs === undefined) {
    return {
      kind: "none",
      reason: "no event in the transcript carries a timestamp to elapse from",
    };
  }

  const { contextWindow } = opts;
  const elapsedMs = (opts.now ?? Date.now()) - firstEventMs;
  const contextFraction =
    contextWindow === undefined ? undefined : contextTokens / contextWindow;
  const priorTokens = priorUsage === undefined ? undefined : contextTokensOf(priorUsage);
  const priorContextFraction =
    contextWindow === undefined || priorTokens === undefined
      ? undefined
      : priorTokens / contextWindow;
  const reading: BudgetReading = {
    contextTokens,
    toolCalls,
    elapsedMs,
    ...(contextFraction !== undefined ? { contextFraction } : {}),
    ...(priorContextFraction !== undefined ? { priorContextFraction } : {}),
  };

  const parts: string[] = [];
  if (contextWindow !== undefined && contextFraction !== undefined) {
    parts.push(
      `context ${groupDigits(contextTokens)}/${groupDigits(contextWindow)} tokens (${Math.round(contextFraction * 100)}%)`,
    );
  }
  parts.push(`elapsed ${formatElapsed(elapsedMs)}`);
  parts.push(`${toolCalls} tool call${toolCalls === 1 ? "" : "s"}`);

  return { kind: "line", line: `budget: ${parts.join(" | ")}`, reading };
}

/** An event's usage object, or nothing where the event carried none. */
function eventUsage(
  event: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const message = event.message as { usage?: unknown } | undefined;
  const usage = message?.usage;
  return usage && typeof usage === "object"
    ? (usage as Record<string, unknown>)
    : undefined;
}

/** An event's timestamp in epoch milliseconds, or nothing where unreadable. */
function eventTimeMs(event: Record<string, unknown>): number | undefined {
  const stamp = event.timestamp;
  if (typeof stamp !== "string") return undefined;
  const ms = Date.parse(stamp);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * The context a turn occupied: its input, cache-read and cache-creation
 * tokens summed, output excluded — output is what the turn produced, not
 * what it occupied. A field the usage did not name contributes nothing; a
 * usage naming none of the three yields nothing at all, rather than a
 * confident zero.
 */
function contextTokensOf(usage: Record<string, unknown>): number | undefined {
  let total = 0;
  let named = 0;
  for (const field of CONTEXT_TOKEN_FIELDS) {
    const value = usage[field];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    total += value;
    named += 1;
  }
  return named > 0 ? total : undefined;
}

/** Wall clock at the coarsest unit that still states it: seconds, minutes, hours. */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Thousands-grouped digits, spelled here rather than taken from a locale:
 * the line reads the same on every host the harness runs on, whatever ICU
 * data the runtime shipped with.
 */
function groupDigits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
