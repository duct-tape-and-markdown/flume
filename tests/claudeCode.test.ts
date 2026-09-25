/**
 * The `claude` provider (`src/claudeCode.ts`): the argv its options render,
 * the win32 shim retry, what an abort takes down, and the closing prose it
 * lifts out of its own transcript.
 *
 * Driven against a mocked `node:child_process` throughout — what a signal
 * aimed at a real process group reaches is `tests/processTree.test.ts`'s
 * subject. The budget flag's own argv is `tests/agentBudget.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

import { spawn } from "node:child_process";

import {
  claudeCode,
  extractFinalMessage,
  type ClaudeCodeOptions,
} from "../src/claudeCode.ts";

import {
  FAKE_PID,
  fakeChildProcess,
  withPlatform,
} from "./helpers/fakeAgentChild.ts";

const spawnMock = vi.mocked(spawn);

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
      "--strict-mcp-config",
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
    expect(args).toEqual(["-p", "--dangerously-skip-permissions", "--strict-mcp-config"]);
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
      "--strict-mcp-config",
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
    expect(args).toEqual([
      "-p",
      "--dangerously-skip-permissions",
      "--strict-mcp-config",
      "--model",
      "opus",
    ]);
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

  it("the claude-code argv carries --strict-mcp-config by default", async () => {
    const proc = fakeChildProcess();
    spawnMock.mockReturnValueOnce(proc as never);

    const result = claudeCode({}).invoke({ cwd: "/tmp", prompt: "p" });
    proc.emit("close", 0);
    await result;

    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args).toContain("--strict-mcp-config");
  });

  // The omission is only the option's doing if the flag would otherwise be
  // there, so both legs run and the baseline is asserted first.
  it("inheritUserMcp omits --strict-mcp-config from the argv", async () => {
    const argvFor = async (opts: ClaudeCodeOptions): Promise<string[]> => {
      const proc = fakeChildProcess();
      spawnMock.mockReturnValueOnce(proc as never);
      const result = claudeCode(opts).invoke({ cwd: "/tmp", prompt: "p" });
      proc.emit("close", 0);
      await result;
      return spawnMock.mock.calls.at(-1)![1] as string[];
    };

    expect(await argvFor({})).toContain("--strict-mcp-config");

    const inherited = await argvFor({ inheritUserMcp: true });
    expect(inherited).not.toContain("--strict-mcp-config");
    expect(inherited).toEqual(["-p", "--dangerously-skip-permissions"]);
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

  // The retry hands its whole argv to a shell that re-parses it, and whether
  // this invocation's argv survives that is the shared predicate's verdict
  // (`wordShimRetryWouldRewrite`, `src/spawnShim.ts`). A declared budget puts
  // inline JSON on the argv, whose quotes the re-parse eats, so the fallback
  // that would reach a shim is refused rather than taken over a value it
  // would rewrite (`.claude/rules/engineering.md`, *Loud or nothing*) — an
  // argv of bare flags still retries, which the case above drives.
  it("claudeCode refuses the win32 shell retry when a declared budget put its settings JSON on the argv", async () => {
    await withPlatform("win32", async () => {
      const first = fakeChildProcess();
      // A second child nobody should reach: without it the pre-fix tree's
      // retry spawns `undefined` and reds on a TypeError inside an 'error'
      // handler rather than on the spawn count this case is about.
      const second = fakeChildProcess();
      spawnMock
        .mockReturnValueOnce(first as never)
        .mockReturnValueOnce(second as never);

      const result = claudeCode({
        budget: { contextWindow: 200_000 },
      }).invoke({ cwd: "C:\\wt", prompt: "p" });

      // The argv the refusal is about, asserted before it fires: a build that
      // stopped putting the flag there would leave the rejection below
      // passing over an argv no shell could have damaged.
      const [, args] = spawnMock.mock.calls[0]!;
      const flag = (args as string[]).indexOf("--settings");
      expect(flag).toBeGreaterThanOrEqual(0);
      const settings = (args as string[])[flag + 1]!;
      expect(settings).toContain('"hooks"');

      const err = enoent();
      first.emit("error", err);

      expect(spawnMock).toHaveBeenCalledOnce();
      const caught = await result.catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(Error);
      // The refusal names the word it would not carry, which here is the
      // settings JSON itself rather than the flag in front of it.
      expect((caught as Error).message).toContain(settings);
      // The spawn failure the caller is really looking at is still reachable.
      expect((caught as Error).cause).toBe(err);
    });
  });
});

/**
 * The abort half of the seam: an agent invocation runs in its own process
 * group and an abort takes that whole group down, settling on its exit rather
 * than on the abort — `AgentInvocation.signal` (`src/Agent.ts`).
 *
 * Driven against the mocked `node:child_process` like the rest of this file —
 * what a signal aimed at a real process group reaches is
 * `tests/processTree.test.ts`'s subject, and the end-to-end property both
 * halves exist for (a signalled `flume tick` releasing its claim over a dead
 * agent tree) is `tests/cli.test.ts`'s. Here the wiring between them is what
 * is judged: which group is signalled, and when the promise settles.
 */
describe("claudeCode — an aborted invocation takes its tree down", () => {
  /**
   * The signals `process.kill` was asked to deliver, as `<target> <signal>`
   * pairs — a negative target being the process group's, which is the whole
   * point of the spawn below. Installed per case so the engine's own
   * escalation timer can never reach a real pid.
   */
  function recordKills(): { sent: string[]; restore: () => void } {
    const sent: string[] = [];
    const original = process.kill;
    process.kill = ((pid: number, signal?: string | number): true => {
      sent.push(`${pid} ${String(signal)}`);
      return true;
    }) as typeof process.kill;
    return {
      sent,
      restore: () => {
        process.kill = original;
      },
    };
  }

  /** Let every already-queued microtask and I/O callback run. */
  function settleTurn(): Promise<void> {
    return new Promise((r) => setImmediate(r));
  }

  it("spawns the agent as its own process group leader on a host that has them", async () => {
    await withPlatform("linux", async () => {
      const proc = fakeChildProcess();
      spawnMock.mockReturnValueOnce(proc as never);

      const result = claudeCode().invoke({ cwd: "/tmp", prompt: "p" });
      proc.emit("close", 0);
      await result;

      const opts = spawnMock.mock.calls[0]![2] as { detached?: boolean };
      expect(opts.detached).toBe(true);
    });
  });

  it("spawns the agent exactly as spawn would on win32, which has no group to lead", async () => {
    await withPlatform("win32", async () => {
      const proc = fakeChildProcess();
      spawnMock.mockReturnValueOnce(proc as never);

      const result = claudeCode().invoke({ cwd: "C:\\wt", prompt: "p" });
      proc.emit("close", 0);
      await result;

      const opts = spawnMock.mock.calls[0]![2] as Record<string, unknown>;
      expect("detached" in opts).toBe(false);
    });
  });

  it("aborting the caller's signal SIGTERMs the agent's group, never the direct child alone", async () => {
    await withPlatform("linux", async () => {
      const kills = recordKills();
      try {
        const proc = fakeChildProcess();
        spawnMock.mockReturnValueOnce(proc as never);
        const ctrl = new AbortController();
        const result = claudeCode().invoke({
          cwd: "/tmp",
          prompt: "p",
          signal: ctrl.signal,
        });

        ctrl.abort();

        // The group, not the pid: `claude` spawns tools and MCP servers of
        // its own, and a kill aimed at the direct child reaches none of them.
        expect(kills.sent).toEqual([`-${FAKE_PID} SIGTERM`]);

        proc.emit("close", null);
        await expect(result).rejects.toMatchObject({ name: "AbortError" });
      } finally {
        kills.restore();
      }
    });
  });

  it("settles only once the aborted tree has exited, never on the abort itself", async () => {
    await withPlatform("linux", async () => {
      const kills = recordKills();
      try {
        const proc = fakeChildProcess();
        spawnMock.mockReturnValueOnce(proc as never);
        const ctrl = new AbortController();
        let settled = false;
        const result = claudeCode()
          .invoke({ cwd: "/tmp", prompt: "p", signal: ctrl.signal })
          .catch(() => {
            settled = true;
          });

        ctrl.abort();
        await settleTurn();
        // The caller releases the guards over the state root the moment this
        // settles, so a settlement here would be a release over a live
        // writer — the tree has been asked to go and has not gone.
        expect(settled).toBe(false);

        proc.emit("close", null);
        await result;
        expect(settled).toBe(true);
      } finally {
        kills.restore();
      }
    });
  });

  it("escalates to SIGKILL after the caller's declared grace when the tree ignores the SIGTERM", async () => {
    await withPlatform("linux", async () => {
      const kills = recordKills();
      vi.useFakeTimers();
      try {
        const proc = fakeChildProcess();
        spawnMock.mockReturnValueOnce(proc as never);
        const ctrl = new AbortController();
        const result = claudeCode().invoke({
          cwd: "/tmp",
          prompt: "p",
          signal: ctrl.signal,
          killGraceMs: 250,
        });

        ctrl.abort();
        expect(kills.sent).toEqual([`-${FAKE_PID} SIGTERM`]);

        // The declared grace, not the engine default: a tree that swallowed
        // the SIGTERM is still there at 249ms and killed at 250.
        await vi.advanceTimersByTimeAsync(249);
        expect(kills.sent).toEqual([`-${FAKE_PID} SIGTERM`]);
        await vi.advanceTimersByTimeAsync(1);
        expect(kills.sent).toEqual([
          `-${FAKE_PID} SIGTERM`,
          `-${FAKE_PID} SIGKILL`,
        ]);

        proc.emit("close", null);
        await expect(result).rejects.toMatchObject({ name: "AbortError" });
      } finally {
        vi.useRealTimers();
        kills.restore();
      }
    });
  });

  it("aborts through the merged signal when timeoutMs rides alongside the caller's", async () => {
    await withPlatform("linux", async () => {
      const kills = recordKills();
      try {
        const proc = fakeChildProcess();
        spawnMock.mockReturnValueOnce(proc as never);
        const ctrl = new AbortController();
        const result = claudeCode().invoke({
          cwd: "/tmp",
          prompt: "p",
          signal: ctrl.signal,
          // Far enough out that only the caller's abort can be what fired.
          timeoutMs: 600_000,
        });

        ctrl.abort();

        expect(kills.sent).toEqual([`-${FAKE_PID} SIGTERM`]);
        proc.emit("close", null);
        await expect(result).rejects.toMatchObject({ name: "AbortError" });
      } finally {
        kills.restore();
      }
    });
  });

  it("refuses to spawn at all when the signal was already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(
      claudeCode().invoke({ cwd: "/tmp", prompt: "p", signal: ctrl.signal }),
    ).rejects.toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
    // Spawning a tree only to signal it leaves a process the caller was
    // already told to stop.
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("wires no teardown at all when neither signal nor timeoutMs is set", async () => {
    await withPlatform("linux", async () => {
      const kills = recordKills();
      try {
        const proc = fakeChildProcess();
        spawnMock.mockReturnValueOnce(proc as never);

        const result = claudeCode().invoke({ cwd: "/tmp", prompt: "" });
        proc.emit("close", 0);
        await expect(result).resolves.toMatchObject({ exitCode: 0 });

        expect(kills.sent).toEqual([]);
        const opts = spawnMock.mock.calls[0]![2] as Record<string, unknown>;
        expect("signal" in opts).toBe(false);
      } finally {
        kills.restore();
      }
    });
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
