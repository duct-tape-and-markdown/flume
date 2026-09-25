/**
 * `withTerminalRenderer` (`src/terminalRender.ts`): the condensed lines it
 * prints, the tool-argument summaries behind them, and the `AgentUsage` the
 * same read lifts off a `result` event.
 *
 * A hand-written agent emits the stream throughout: the renderer's subject
 * is what it does with NDJSON it is handed, and that the provider's own
 * stream is read the same way is `tests/streamJson.test.ts`'s agreement
 * gates.
 */

import { describe, expect, it } from "vitest";
import { sep } from "node:path";

import { withTerminalRenderer, extractResultUsage } from "../src/terminalRender.ts";
import type { Agent } from "../src/Agent.ts";

describe("withTerminalRenderer", () => {
  function ndjson(...events: unknown[]): string {
    return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }

  it("parses NDJSON, renders tool_use + result, drops thinking/text/system/tool_result", async () => {
    const stream = ndjson(
      { type: "system", subtype: "init", session_id: "abc" },
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "should-not-appear" },
            { type: "text", text: "should-not-appear-text" },
            { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "prose-only turn, drop me" }],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "x", content: "tool-output" },
          ],
        },
      },
      {
        type: "result",
        num_turns: 3,
        usage: { input_tokens: 1234, output_tokens: 5678 },
        total_cost_usd: 0.123,
        duration_ms: 2500,
      },
    );

    const fake: Agent = {
      name: "fake",
      async invoke(inv) {
        // Split mid-line to exercise the internal line buffer.
        const mid = Math.floor(stream.length / 2);
        inv.onStdout?.(stream.slice(0, mid));
        inv.onStdout?.(stream.slice(mid));
        return { exitCode: 0, stdout: stream, stderr: "" };
      },
    };

    const captured: string[] = [];
    const wrapped = withTerminalRenderer(fake);
    await wrapped.invoke({
      cwd: "/work/foo",
      prompt: "",
      onStdout: (chunk) => captured.push(chunk),
    });

    const out = captured.join("");
    expect(wrapped.name).toBe("fake+render");
    expect(out).toContain("[foo] Bash(ls -la)\n");
    expect(out).toContain("[foo] result");
    expect(out).toContain("3 turns");
    expect(out).toContain("1.2k in");
    expect(out).toContain("5.7k out");
    expect(out).toContain("$0.123");
    expect(out).toContain("2.5s");

    expect(out).not.toContain("should-not-appear");
    expect(out).not.toContain("prose-only");
    expect(out).not.toContain("tool_result");
    expect(out).not.toContain("tool-output");
    expect(out).not.toContain("session_id");
    expect(out).not.toContain("\"type\":");
  });

  describe("default tag", () => {
    // Renders one non-JSON line so the tag prefix surfaces verbatim.
    async function defaultTagOutputFor(cwd: string): Promise<string> {
      const fake: Agent = {
        name: "fake",
        async invoke(inv) {
          inv.onStdout?.("ping\n");
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };
      const captured: string[] = [];
      await withTerminalRenderer(fake).invoke({
        cwd,
        prompt: "",
        onStdout: (chunk) => captured.push(chunk),
      });
      return captured.join("");
    }

    it("renders the leaf dir for a POSIX-style cwd", async () => {
      expect(await defaultTagOutputFor("/work/wt-agent-1")).toBe(
        "[wt-agent-1] ping\n",
      );
    });

    // path.basename only treats "\" as a separator on win32 hosts, so the
    // drive-lettered regression is only observable there.
    it.runIf(process.platform === "win32")(
      "renders the leaf dir, not the full path, for a drive-lettered backslash cwd",
      async () => {
        expect(
          await defaultTagOutputFor(
            "C:\\Users\\dev\\repo\\.flume\\worktrees\\wt-agent-1",
          ),
        ).toBe("[wt-agent-1] ping\n");
      },
    );

    it("falls back to [tick] when the cwd is a bare root", async () => {
      expect(await defaultTagOutputFor(sep)).toBe("[tick] ping\n");
    });
  });

  describe("file_path relativizing", () => {
    async function readLineFor(cwd: string, filePath: string): Promise<string> {
      const stream =
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Read", input: { file_path: filePath } },
            ],
          },
        }) + "\n";
      const fake: Agent = {
        name: "fake",
        async invoke(inv) {
          inv.onStdout?.(stream);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };
      const captured: string[] = [];
      await withTerminalRenderer(fake).invoke({
        cwd,
        prompt: "",
        onStdout: (chunk) => captured.push(chunk),
      });
      return captured.join("");
    }

    it("renders relative under a backslash-separated cwd", async () => {
      expect(
        await readLineFor(
          "C:\\Users\\dev\\repo",
          "C:\\Users\\dev\\repo\\src\\Agent.ts",
        ),
      ).toContain("Read(src\\Agent.ts)\n");
    });

    it("keeps rendering relative under a POSIX cwd", async () => {
      expect(await readLineFor("/work/repo", "/work/repo/src/Agent.ts")).toContain(
        "Read(src/Agent.ts)\n",
      );
    });
  });

  it("the terminal renderer emits a non-JSON line trimmed behind the tag prefix", async () => {
    // A win32 child's CRLF leaves the CR on the line, and indented stray
    // output keeps its leading run — both differ from the trimmed form.
    const raw = "   warning: something off\r\n";
    const fake: Agent = {
      name: "fake",
      async invoke(inv) {
        inv.onStdout?.(raw);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const captured: string[] = [];
    const wrapped = withTerminalRenderer(fake, { tag: () => "[T]" });
    await wrapped.invoke({
      cwd: "/x",
      prompt: "",
      onStdout: (chunk) => captured.push(chunk),
    });
    const line = raw.replace(/\n$/, "");
    expect(line).not.toBe(line.trim());
    expect(captured.join("")).toBe("[T] warning: something off\n");
  });
});

describe("extractResultUsage — usage/cost facts off a stream-json result event", () => {
  it("extracts turns, duration, token counts, and a single-model modelUsage key", () => {
    const usage = extractResultUsage({
      type: "result",
      num_turns: 3,
      duration_ms: 2500,
      usage: {
        input_tokens: 1234,
        output_tokens: 5678,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 20,
      },
      modelUsage: {
        "claude-fable-5-1": { inputTokens: 1234, outputTokens: 5678 },
      },
    });
    expect(usage).toEqual({
      model: "claude-fable-5-1",
      turns: 3,
      durationMs: 2500,
      inputTokens: 1234,
      outputTokens: 5678,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 20,
    });
  });

  it("leaves a field the result event didn't report absent, not zero", () => {
    const usage = extractResultUsage({
      type: "result",
      num_turns: 1,
      usage: { input_tokens: 2 },
    });
    expect(usage).toEqual({ turns: 1, inputTokens: 2 });
    expect("durationMs" in usage).toBe(false);
    expect("outputTokens" in usage).toBe(false);
    expect("cacheCreationInputTokens" in usage).toBe(false);
    expect("cacheReadInputTokens" in usage).toBe(false);
    expect("model" in usage).toBe(false);
  });

  it("the usage decode lifts the result event's total_cost_usd onto costUsd", () => {
    const usage = extractResultUsage({
      type: "result",
      num_turns: 1,
      duration_ms: 900,
      total_cost_usd: 0.4213,
      usage: { input_tokens: 11, output_tokens: 22 },
    });
    expect(usage.costUsd).toBe(0.4213);
    // Same decode as the token fields, not a second pass: one call yields
    // both, and neither is rounded to the renderer's display precision.
    expect(usage).toEqual({
      turns: 1,
      durationMs: 900,
      costUsd: 0.4213,
      inputTokens: 11,
      outputTokens: 22,
    });
  });

  it("leaves costUsd absent when the result event reports no total_cost_usd", () => {
    const usage = extractResultUsage({
      type: "result",
      num_turns: 1,
      usage: { input_tokens: 2 },
    });
    expect("costUsd" in usage).toBe(false);
  });

  it("leaves model absent when modelUsage names more than one model — ambiguous, not guessed", () => {
    const usage = extractResultUsage({
      type: "result",
      modelUsage: {
        "claude-haiku-4-5-20251001": {},
        "claude-fable-5-1": {},
      },
    });
    expect("model" in usage).toBe(false);
  });
});

describe("withTerminalRenderer merges extractResultUsage's reading onto the resolved AgentResult", () => {
  function ndjson(...events: unknown[]): string {
    return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }

  it("attaches usage when the transcript carries a result event", async () => {
    const stream = ndjson(
      { type: "system", subtype: "init" },
      {
        type: "result",
        num_turns: 2,
        duration_ms: 1000,
        usage: { input_tokens: 5, output_tokens: 7 },
        modelUsage: { "claude-fable-5-1": {} },
      },
    );
    const fake: Agent = {
      name: "fake",
      async invoke(inv) {
        inv.onStdout?.(stream);
        return { exitCode: 0, stdout: stream, stderr: "" };
      },
    };
    const result = await withTerminalRenderer(fake).invoke({
      cwd: "/work/foo",
      prompt: "",
    });
    expect(result.usage).toEqual({
      model: "claude-fable-5-1",
      turns: 2,
      durationMs: 1000,
      inputTokens: 5,
      outputTokens: 7,
    });
  });

  it("leaves usage undefined when the transcript carries no result event", async () => {
    const fake: Agent = {
      name: "fake",
      async invoke(inv) {
        inv.onStdout?.(ndjson({ type: "system", subtype: "init" }));
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const result = await withTerminalRenderer(fake).invoke({
      cwd: "/work/foo",
      prompt: "",
    });
    expect(result.usage).toBeUndefined();
  });
});

describe("the terminal result line and the reported usage are one decode", () => {
  function ndjson(...events: unknown[]): string {
    return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }

  // Drives the real renderer over a real transcript and hands back both
  // sides of the seam — the line it printed and the usage it resolved —
  // so neither is re-derived by the test's own hand.
  async function renderOne(event: unknown) {
    const stream = ndjson(event);
    const fake: Agent = {
      name: "fake",
      async invoke(inv) {
        inv.onStdout?.(stream);
        return { exitCode: 0, stdout: stream, stderr: "" };
      },
    };
    const captured: string[] = [];
    const result = await withTerminalRenderer(fake).invoke({
      cwd: "/work/foo",
      prompt: "",
      onStdout: (chunk) => captured.push(chunk),
    });
    return { line: captured.join("").trim(), usage: result.usage };
  }

  it("a rendered result line reports the same turn, token and cost figures the invocation's usage reports", async () => {
    const { line, usage } = await renderOne({
      type: "result",
      num_turns: 3,
      duration_ms: 2500,
      total_cost_usd: 0.123,
      usage: { input_tokens: 1234, output_tokens: 5678 },
    });
    // Vacuity: every figure the line prints was carried by the event, so
    // the comparisons below are over five present fields, not absences.
    expect(Object.keys(usage ?? {})).toHaveLength(5);
    expect(line).toContain(`${usage!.turns} turns`);
    expect(line).toContain(`$${usage!.costUsd!.toFixed(3)}`);
    expect(line).toContain(`${(usage!.durationMs! / 1000).toFixed(1)}s`);
    expect(usage!.inputTokens).toBe(1234);
    expect(usage!.outputTokens).toBe(5678);
    expect(line).toContain("1.2k in");
    expect(line).toContain("5.7k out");
  });

  it("a token count the result event omits is absent from the line, as it is from the usage", async () => {
    const { line, usage } = await renderOne({
      type: "result",
      num_turns: 2,
      usage: { output_tokens: 9 },
    });
    expect(usage).toEqual({ turns: 2, outputTokens: 9 });
    // The whole line, not a negative over it: an omitted input count is a
    // segment the renderer never emits, never a confident `0 in`.
    expect(line).toBe("[foo] result · 2 turns · 9 out");
  });
});
