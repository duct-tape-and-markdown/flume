import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";

import {
  claudeCode,
  withSessionCapture,
  withTerminalRenderer,
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
