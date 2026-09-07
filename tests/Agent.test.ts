import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

import { spawn } from "node:child_process";

import {
  claudeCode,
  withSessionCapture,
  withTerminalRenderer,
  parseNdjsonLine,
  contentBlocksOfType,
  isAssistantEvent,
  isResultEvent,
  isErrorResult,
  extractResultUsage,
  extractFinalMessage,
  assistantTurnText,
  type Agent,
} from "../src/Agent.ts";

const spawnMock = vi.mocked(spawn);

interface FakeChildStream extends EventEmitter {
  setEncoding: (encoding: string) => void;
}
interface FakeChildStdin extends EventEmitter {
  write: (chunk: string) => void;
  end: () => void;
  written: string[];
}
interface FakeChildProcess extends EventEmitter {
  stdout: FakeChildStream;
  stderr: FakeChildStream;
  stdin: FakeChildStdin;
}

function fakeChildProcess(): FakeChildProcess {
  const proc = new EventEmitter() as FakeChildProcess;
  const stdout = new EventEmitter() as FakeChildStream;
  stdout.setEncoding = (): void => {};
  const stderr = new EventEmitter() as FakeChildStream;
  stderr.setEncoding = (): void => {};
  const stdin = new EventEmitter() as FakeChildStdin;
  stdin.written = [];
  stdin.write = (chunk: string): void => {
    stdin.written.push(chunk);
  };
  stdin.end = (): void => {};
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = stdin;
  return proc;
}

async function withPlatform(
  platform: NodeJS.Platform,
  fn: () => Promise<void>,
): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    await fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe("claudeCode — outputFormat flags", () => {
  it("injects --output-format stream-json --verbose for stream-json", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const result = claudeCode({ outputFormat: "stream-json" }).invoke({
      cwd: "/tmp",
      prompt: "p",
    });
    proc.emit("close", 0);
    await result;

    expect(spawnMock).toHaveBeenCalledOnce();
    const [bin, args, opts] = spawnMock.mock.calls[0]!;
    expect(bin).toBe("claude");
    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ]);
    expect(opts).toMatchObject({ cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] });
  });

  it("omits stream-json flags when outputFormat defaults to text", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const result = claudeCode().invoke({ cwd: "/tmp", prompt: "p" });
    proc.emit("close", 0);
    await result;

    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args).not.toContain("--output-format");
    expect(args).not.toContain("stream-json");
    expect(args).not.toContain("--verbose");
    expect(args).toEqual(["-p", "--dangerously-skip-permissions"]);
  });

  it("appends extraArgs after the format flags and respects dangerouslySkipPermissions=false", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const result = claudeCode({
      outputFormat: "stream-json",
      dangerouslySkipPermissions: false,
      extraArgs: ["--model", "opus"],
    }).invoke({ cwd: "/tmp", prompt: "p" });
    proc.emit("close", 0);
    await result;

    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "opus",
    ]);
  });

  it("appends --model <value> to argv when model is declared", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const result = claudeCode({ model: "opus" }).invoke({ cwd: "/tmp", prompt: "p" });
    proc.emit("close", 0);
    await result;

    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args).toEqual(["-p", "--dangerously-skip-permissions", "--model", "opus"]);
  });

  it("emits no --model flag when model is undeclared", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const result = claudeCode({}).invoke({ cwd: "/tmp", prompt: "p" });
    proc.emit("close", 0);
    await result;

    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args).not.toContain("--model");
  });
});

describe("claudeCode — win32 .cmd shim fallback", () => {
  function enoent(): NodeJS.ErrnoException {
    return Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
  }

  it("retries exactly once with shell:true when the direct win32 spawn ENOENTs", async () => {
    await withPlatform("win32", async () => {
      const first = fakeChildProcess();
      const second = fakeChildProcess();
      spawnMock
        .mockReturnValueOnce(first as never)
        .mockReturnValueOnce(second as never);

      const result = claudeCode().invoke({
        cwd: "C:\\wt",
        prompt: "the-prompt",
      });
      first.emit("error", enoent());
      // Real spawn failures can emit 'close' after 'error'; the abandoned
      // first proc must not settle the promise with empty output.
      first.emit("close", -1);

      second.stdout.emit("data", "shim-output");
      second.emit("close", 0);

      await expect(result).resolves.toEqual({
        exitCode: 0,
        stdout: "shim-output",
        stderr: "",
        finalMessage: "shim-output",
      });

      expect(spawnMock).toHaveBeenCalledTimes(2);
      const [, firstArgs, firstOpts] = spawnMock.mock.calls[0]!;
      const [retryBin, retryArgs, retryOpts] = spawnMock.mock.calls[1]!;
      expect("shell" in (firstOpts as Record<string, unknown>)).toBe(false);
      expect(retryBin).toBe("claude");
      expect(retryArgs).toEqual(firstArgs);
      expect(retryOpts).toMatchObject({ cwd: "C:\\wt", shell: true });
      expect(second.stdin.written.join("")).toBe("the-prompt");
    });
  });

  it("rejects without a third spawn when the shell retry also errors", async () => {
    await withPlatform("win32", async () => {
      const first = fakeChildProcess();
      const second = fakeChildProcess();
      spawnMock
        .mockReturnValueOnce(first as never)
        .mockReturnValueOnce(second as never);

      const result = claudeCode().invoke({ cwd: "C:\\wt", prompt: "p" });
      first.emit("error", enoent());
      const retryErr = enoent();
      second.emit("error", retryErr);

      await expect(result).rejects.toBe(retryErr);
      expect(spawnMock).toHaveBeenCalledTimes(2);
    });
  });

  it("rejects win32 non-ENOENT spawn errors without retrying", async () => {
    await withPlatform("win32", async () => {
      const proc = fakeChildProcess();
      spawnMock.mockReturnValueOnce(proc as never);

      const result = claudeCode().invoke({ cwd: "C:\\wt", prompt: "p" });
      const eacces = Object.assign(new Error("spawn claude EACCES"), {
        code: "EACCES",
      });
      proc.emit("error", eacces);

      await expect(result).rejects.toBe(eacces);
      expect(spawnMock).toHaveBeenCalledOnce();
    });
  });

  it("rejects ENOENT unchanged on non-win32 platforms", async () => {
    await withPlatform("linux", async () => {
      const proc = fakeChildProcess();
      spawnMock.mockReturnValueOnce(proc as never);

      const result = claudeCode().invoke({ cwd: "/tmp", prompt: "p" });
      const err = enoent();
      proc.emit("error", err);

      await expect(result).rejects.toBe(err);
      expect(spawnMock).toHaveBeenCalledOnce();
    });
  });
});

describe("claudeCode — timeoutMs combines via AbortSignal.any", () => {
  it("supplies AbortSignal.timeout when only timeoutMs is set", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const result = claudeCode().invoke({
      cwd: "/tmp",
      prompt: "",
      timeoutMs: 5_000,
    });

    const opts = spawnMock.mock.calls[0]![2] as { signal?: AbortSignal };
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.signal!.aborted).toBe(false);

    proc.emit("close", 0);
    await result;
  });

  it("combines user signal + timeoutMs so aborting the user signal aborts the merged signal", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const ctrl = new AbortController();
    const result = claudeCode().invoke({
      cwd: "/tmp",
      prompt: "",
      signal: ctrl.signal,
      timeoutMs: 60_000,
    });

    const opts = spawnMock.mock.calls[0]![2] as { signal?: AbortSignal };
    const merged = opts.signal!;
    expect(merged).toBeInstanceOf(AbortSignal);
    expect(merged).not.toBe(ctrl.signal);
    expect(merged.aborted).toBe(false);

    ctrl.abort();
    expect(merged.aborted).toBe(true);

    proc.emit("close", 1);
    await result;
  });

  it("passes the user signal through unchanged when timeoutMs is absent", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const ctrl = new AbortController();
    const result = claudeCode().invoke({
      cwd: "/tmp",
      prompt: "",
      signal: ctrl.signal,
    });

    const opts = spawnMock.mock.calls[0]![2] as { signal?: AbortSignal };
    expect(opts.signal).toBe(ctrl.signal);

    proc.emit("close", 0);
    await result;
  });

  it("omits the signal field entirely when neither signal nor timeoutMs is set", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const result = claudeCode().invoke({ cwd: "/tmp", prompt: "" });
    const opts = spawnMock.mock.calls[0]![2] as Record<string, unknown>;
    expect("signal" in opts).toBe(false);

    proc.emit("close", 0);
    await result;
  });
});

describe("withSessionCapture", () => {
  it("tees stdout chunks to the configured capture file and still forwards to outer onStdout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-capture-"));
    try {
      const fake: Agent = {
        name: "fake",
        async invoke(inv) {
          inv.onStdout?.("hello ");
          inv.onStdout?.("world\n");
          inv.onStdout?.("second line\n");
          return {
            exitCode: 0,
            stdout: "hello world\nsecond line\n",
            stderr: "",
          };
        },
      };

      let outerSaw = "";
      const wrapped = withSessionCapture(fake, {
        dir,
        filename: () => "session.txt",
      });
      const result = await wrapped.invoke({
        cwd: "/tmp",
        prompt: "",
        onStdout: (chunk) => {
          outerSaw += chunk;
        },
      });

      expect(result.exitCode).toBe(0);
      expect(wrapped.name).toBe("fake+capture");
      expect(outerSaw).toBe("hello world\nsecond line\n");

      const captured = await readFile(join(dir, "session.txt"), "utf8");
      expect(captured).toBe("hello world\nsecond line\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates the capture directory if it does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "flume-capture-root-"));
    const dir = join(root, "nested", "deeper");
    try {
      const fake: Agent = {
        name: "fake",
        async invoke(inv) {
          inv.onStdout?.("bytes");
          return { exitCode: 0, stdout: "bytes", stderr: "" };
        },
      };
      const wrapped = withSessionCapture(fake, {
        dir,
        filename: () => "out.txt",
      });
      await wrapped.invoke({ cwd: "/tmp", prompt: "" });

      const captured = await readFile(join(dir, "out.txt"), "utf8");
      expect(captured).toBe("bytes");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not collide when two invocations with distinct cwds default the filename under a frozen clock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-capture-fanout-"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      const fake = (payload: string): Agent => ({
        name: "fake",
        async invoke(inv) {
          inv.onStdout?.(payload);
          return { exitCode: 0, stdout: payload, stderr: "" };
        },
      });

      const wrapped = withSessionCapture(fake("payload"), { dir });

      const [resultA, resultB] = await Promise.all([
        wrapped.invoke({ cwd: join("/tmp", "worktree-a"), prompt: "" }),
        wrapped.invoke({ cwd: join("/tmp", "worktree-b"), prompt: "" }),
      ]);

      expect(resultA.exitCode).toBe(0);
      expect(resultB.exitCode).toBe(0);

      const files = await readdir(dir);
      expect(files).toHaveLength(2);

      const contents = await Promise.all(
        files.map((f) => readFile(join(dir, f), "utf8")),
      );
      expect(contents).toEqual(["payload", "payload"]);
    } finally {
      vi.useRealTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

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

  it("passes non-JSON lines through verbatim with the tag prefix", async () => {
    const fake: Agent = {
      name: "fake",
      async invoke(inv) {
        inv.onStdout?.("warning: something off\n");
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
    expect(captured.join("")).toBe("[T] warning: something off\n");
  });
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

  it("feeds both withTerminalRenderer's tool_use rendering and a Dispatcher-shaped text extractor off the same parsed event — a one-sided change to either consumer's block-type filter doesn't touch the shared parse", async () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
          { type: "text", text: "final prose" },
        ],
      },
    });

    const fake: Agent = {
      name: "fake",
      async invoke(inv) {
        inv.onStdout?.(line + "\n");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const rendered: string[] = [];
    await withTerminalRenderer(fake).invoke({
      cwd: "/work/foo",
      prompt: "",
      onStdout: (chunk) => rendered.push(chunk),
    });
    const out = rendered.join("");
    expect(out).toContain("Bash(ls -la)");
    expect(out).not.toContain("final prose");

    const parsed = parseNdjsonLine(line);
    if (parsed.kind !== "event") throw new Error("expected an event line");
    expect(assistantTurnText(parsed.event)).toBe("final prose");
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

  it("drives withTerminalRenderer's ERROR head and a Dispatcher-shaped result reader off the same isResultEvent/isErrorResult verdict — a one-sided change to either literal comparison would desync them", async () => {
    const errorLine = JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      num_turns: 1,
      usage: {},
    });

    const fake: Agent = {
      name: "fake",
      async invoke(inv) {
        inv.onStdout?.(errorLine + "\n");
        return { exitCode: 0, stdout: errorLine + "\n", stderr: "" };
      },
    };
    const rendered: string[] = [];
    await withTerminalRenderer(fake).invoke({
      cwd: "/work/foo",
      prompt: "",
      onStdout: (chunk) => rendered.push(chunk),
    });
    expect(rendered.join("")).toContain("ERROR");

    // Stand-in for extractFinalMessage's result-event branch: same shared
    // isResultEvent/isErrorResult, independent of the renderer.
    const parsed = parseNdjsonLine(errorLine);
    if (parsed.kind !== "event") throw new Error("expected an event line");
    expect(isResultEvent(parsed.event)).toBe(true);
    expect(isErrorResult(parsed.event)).toBe(true);
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

describe("extractFinalMessage — the three transcript shapes (spec/chain.md \"The agent seam\")", () => {
  function ndjson(...events: unknown[]): string {
    return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }

  it("lifts the terminal result event's result text under stream-json", () => {
    const stdout = ndjson(
      { type: "system", subtype: "init" },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "intermediate turn" }] },
      },
      { type: "result", subtype: "success", result: "  final answer  " },
    );
    expect(extractFinalMessage(stdout)).toBe("final answer");
  });

  it("falls back to the last assistant turn's text when the result event carries none", () => {
    const stdout = ndjson(
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "first turn" }] },
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "last turn" }] },
      },
      { type: "result", subtype: "success" },
    );
    expect(extractFinalMessage(stdout)).toBe("last turn");
  });

  it("returns raw stdout trimmed for a plain-text agent (no stream-json events)", () => {
    expect(extractFinalMessage("  plain prose, no NDJSON here\n")).toBe(
      "plain prose, no NDJSON here",
    );
  });

  it("falls back to the raw transcript trimmed when stream-json parsed but no event carried text", () => {
    const stdout = ndjson(
      { type: "system", subtype: "init" },
      { type: "result", subtype: "success" },
    );
    expect(extractFinalMessage(stdout)).toBe(stdout.trim());
  });
});

describe("claudeCode — sets AgentResult.finalMessage from the captured stdout", () => {
  it("extracts the stream-json result text when outputFormat is stream-json", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const result = claudeCode({ outputFormat: "stream-json" }).invoke({
      cwd: "/tmp",
      prompt: "p",
    });
    proc.stdout.emit(
      "data",
      JSON.stringify({ type: "result", subtype: "success", result: "done." }) +
        "\n",
    );
    proc.emit("close", 0);

    await expect(result).resolves.toMatchObject({ finalMessage: "done." });
  });

  it("uses raw stdout as finalMessage for the default plain-text format", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const result = claudeCode().invoke({ cwd: "/tmp", prompt: "p" });
    proc.stdout.emit("data", "plain closing prose\n");
    proc.emit("close", 0);

    await expect(result).resolves.toMatchObject({
      finalMessage: "plain closing prose",
    });
  });
});
