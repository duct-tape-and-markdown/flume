/**
 * The shared stream-json alphabet (`src/streamJson.ts`) — the line parse, the
 * block filter, and the event-type predicates both sides of the transcript
 * seam classify by.
 *
 * Each half closes on the agreement gate its vocabulary carries: one real
 * transcript through the real renderer (`src/terminalRender.ts`) and the real
 * extraction (`src/claudeCode.ts`), so a literal that moves on one side alone
 * turns the other red (`.claude/rules/engineering.md`, *A seam gate reads what
 * the real writer wrote*).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

import { spawn } from "node:child_process";

import {
  parseNdjsonLine,
  contentBlocksOfType,
  isAssistantEvent,
  isResultEvent,
  isErrorResult,
  assistantTurnText,
} from "../src/streamJson.ts";
import { claudeCode } from "../src/claudeCode.ts";
import { withTerminalRenderer } from "../src/terminalRender.ts";

import { fakeChildProcess } from "./helpers/fakeAgentChild.ts";

const spawnMock = vi.mocked(spawn);

beforeEach(() => {
  spawnMock.mockReset();
});

describe("parseNdjsonLine / contentBlocksOfType — shared NDJSON parse", () => {
  it("distinguishes blank, unparseable, non-object, and event lines", () => {
    expect(parseNdjsonLine("   ")).toEqual({ kind: "blank" });
    expect(parseNdjsonLine("not json")).toEqual({
      kind: "parse-error",
      raw: "not json",
    });
    expect(parseNdjsonLine("42")).toEqual({ kind: "non-object" });
    const line = JSON.stringify({ type: "assistant", message: { content: [] } });
    expect(parseNdjsonLine(line)).toEqual({
      kind: "event",
      event: { type: "assistant", message: { content: [] } },
    });
  });

  it("extracts content blocks by type, ignoring other block shapes", () => {
    const event = {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "x" },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
      },
    };
    expect(contentBlocksOfType(event, "tool_use")).toEqual([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    expect(contentBlocksOfType(event, "text")).toEqual([
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ]);
  });

  it("concatenates an assistant turn's text blocks and drops tool_use/thinking", () => {
    const event = {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "deliberating" },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
          { type: "text", text: "  hello  " },
          { type: "text", text: "world" },
        ],
      },
    };
    expect(assistantTurnText(event)).toBe("hello\n\nworld");
  });

  it("withTerminalRenderer's tool_use render and extractFinalMessage's closing prose agree on one assistant transcript", async () => {
    // Agreement gate (`.claude/rules/engineering.md`, *A seam gate reads what
    // the real writer wrote*): one transcript, both real readers, no stand-in.
    // The renderer consumes it line by line off the stream; `claudeCode` hands
    // the very same bytes to `extractFinalMessage` and reports that verdict as
    // `finalMessage`. Each reader keeps exactly what the other drops, so a
    // one-sided change to either block-type filter turns one half red.
    const transcript =
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
            { type: "text", text: "final prose" },
          ],
        },
      }) + "\n";

    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);
    const rendered: string[] = [];
    const pending = withTerminalRenderer(
      claudeCode({ outputFormat: "stream-json" }),
    ).invoke({
      cwd: "/work/foo",
      prompt: "p",
      onStdout: (chunk) => rendered.push(chunk),
    });
    proc.stdout.emit("data", transcript);
    proc.emit("close", 0);
    const result = await pending;

    const out = rendered.join("");
    expect(out).toContain("Bash(ls -la)");
    expect(out).not.toContain("final prose");
    expect(result.finalMessage).toBe("final prose");
    expect(result.finalMessage).not.toContain("Bash");
  });
});

describe("isAssistantEvent / isResultEvent / isErrorResult — shared event-type vocabulary", () => {
  it("classifies assistant and result events, and rejects other event types", () => {
    expect(isAssistantEvent({ type: "assistant" })).toBe(true);
    expect(isAssistantEvent({ type: "result" })).toBe(false);
    expect(isAssistantEvent({ type: "system", subtype: "init" })).toBe(false);

    expect(isResultEvent({ type: "result" })).toBe(true);
    expect(isResultEvent({ type: "assistant" })).toBe(false);
  });

  it("marks a result event as an error via is_error or a non-success subtype", () => {
    expect(isErrorResult({ type: "result" })).toBe(false);
    expect(isErrorResult({ type: "result", subtype: "success" })).toBe(false);
    expect(isErrorResult({ type: "result", is_error: true })).toBe(true);
    expect(isErrorResult({ type: "result", subtype: "error_max_turns" })).toBe(
      true,
    );
  });

  it("withTerminalRenderer's ERROR head and extractFinalMessage's result text agree on one error result transcript", async () => {
    // The renderer reaches `formatResult`'s ERROR head only by classifying
    // this line as a result event, and `extractFinalMessage` lifts its
    // `result` text only by classifying it the same way — one transcript,
    // both real readers (`.claude/rules/engineering.md`, *A seam gate reads
    // what the real writer wrote*). Should either side's `"result"` literal
    // move alone, that side stops recognizing the event: the render loses its
    // head line, or the extraction falls back to the raw transcript.
    const transcript =
      JSON.stringify({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        result: "stopped at the turn limit",
        num_turns: 1,
        usage: {},
      }) + "\n";

    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);
    const rendered: string[] = [];
    const pending = withTerminalRenderer(
      claudeCode({ outputFormat: "stream-json" }),
    ).invoke({
      cwd: "/work/foo",
      prompt: "p",
      onStdout: (chunk) => rendered.push(chunk),
    });
    proc.stdout.emit("data", transcript);
    proc.emit("close", 0);
    const result = await pending;

    expect(rendered.join("")).toContain("ERROR");
    expect(result.finalMessage).toBe("stopped at the turn limit");
    // Not the raw NDJSON line: the fallback a reader that missed the event
    // would have produced.
    expect(result.finalMessage).not.toContain("error_max_turns");
  });
});
