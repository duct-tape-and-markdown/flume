/**
 * The stream-json event vocabulary — one provider's NDJSON alphabet, known
 * here and read by every module that walks a transcript (`spec/chain.md`,
 * *The agent seam*).
 *
 * Its own file rather than a corner of the adapter, because the readers sit
 * on both sides of it: `src/Agent.ts` renders and extracts from the stream it
 * spawned, and `src/budgetLine.ts` reads the same events back off the session
 * transcript on disk. With the alphabet inside the adapter, the transcript
 * reader imports the process spawner to learn what an `assistant` event is,
 * and the hook the adapter registers closes that into a cycle
 * (`.claude/rules/engineering.md`, *A module is one job*).
 *
 * What lives here is classification only: the line parse, the event-type
 * discriminants, and the content-block walk. What an event *means* to a
 * reader — a final message, a usage row, a budget reading — stays with the
 * reader that needs it.
 */

/** One parsed `claude -p --output-format stream-json` NDJSON event. */
export type NdjsonEvent = Record<string, unknown>;

/**
 * Result of {@link parseNdjsonLine}: `"blank"` for a whitespace-only line,
 * `"parse-error"` for text that doesn't parse as JSON (carries the trimmed
 * raw text so a caller can pass it through), `"non-object"` for JSON that
 * parses but isn't an event object (e.g. a bare number or array), and
 * `"event"` for a genuine stream-json event.
 */
type NdjsonLineResult =
  | { kind: "blank" }
  | { kind: "parse-error"; raw: string }
  | { kind: "non-object" }
  | { kind: "event"; event: NdjsonEvent };

/**
 * Parse one line of a `claude -p --output-format stream-json` NDJSON
 * transcript, whether it arrived on the adapter's stdout or is being read
 * back off a session file. Every reader walks this one line-parse before
 * diverging on which event and block types it keeps.
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
 * an NDJSON event. The `"assistant"`/`"result"` literals and the
 * `is_error`/`subtype` error rule live here once so two readers can't drift
 * on what counts as which event.
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
