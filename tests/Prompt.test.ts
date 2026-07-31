// execFile mocked so inline-exec tests can simulate a win32 ENOENT without a
// real Windows host; the custom-promisify symbol mirrors Node's real
// child_process decoration so execGate's `{ stdout, stderr }` destructure
// (promisify(execFile)) still resolves correctly through the mock.
vi.mock("node:child_process", () => {
  const execFileMock = vi.fn();
  Object.assign(execFileMock, {
    [Symbol.for("nodejs.util.promisify.custom")]: (
      cmd: string,
      args: string[],
      opts: unknown,
    ) =>
      new Promise((resolve, reject) => {
        execFileMock(
          cmd,
          args,
          opts,
          (err: unknown, stdout: string, stderr: string) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          },
        );
      }),
  });
  return { execFile: execFileMock };
});

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderPrompt } from "../src/Prompt.ts";
import type { Phase } from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";

const execFileMock = vi.mocked(execFile);

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

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "flume-prompt-"));
  execFileMock.mockReset();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function phase(overrides: Partial<Phase> = {}): Phase {
  return {
    name: "plan",
    description: "test phase",
    promptPath: "prompt.md",
    concurrency: "singleton",
    writablePaths: ["**"],
    gates: [],
    handoff: () => [],
    ...overrides,
  };
}

function entry(overrides: Partial<PendingEntry> = {}): PendingEntry {
  return {
    tag: "TEST-TAG",
    summary: "test entry",
    per: { path: "spec/RELEASE-v0.1.md", section: "5. Tests" },
    gate: { kind: "open" },
    dependsOnForks: [],
    files: { new: [], edit: [], retire: [] },
    schemaDelta: "none",
    tests: [],
    acceptance: "green",
    ...overrides,
  };
}

describe("renderPrompt — reserved {{FLUME_DIR}} arg (§16)", () => {
  it("auto-injects FLUME_DIR so a prompt resolves it with no chain-declared arg", async () => {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "read {{FLUME_DIR}}/plan/pending.json\n", "utf8");

    const out = await renderPrompt({
      phase: phase(),
      flumeDir: "/abs/state-root",
      promptFile,
      cwd: dir,
      args: {}, // chain supplies nothing
    });

    expect(out).toContain("read /abs/state-root/plan/pending.json");
    expect(out).not.toContain("{{FLUME_DIR}}");
  });

  it("FLUME_DIR is reserved — a chain-supplied arg cannot shadow the resolved root", async () => {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "root={{FLUME_DIR}}\n", "utf8");

    const out = await renderPrompt({
      phase: phase(),
      flumeDir: "/resolved",
      promptFile,
      cwd: dir,
      args: { FLUME_DIR: "/chain-supplied-WRONG" },
    });

    expect(out).toContain("root=/resolved");
    expect(out).not.toContain("chain-supplied-WRONG");
  });
});

describe("renderPrompt — <harness> states the effective fence (RELEASE-v0.7 §2)", () => {
  async function render(
    p: Phase,
    assignedEntry?: PendingEntry,
  ): Promise<string> {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "task body\n", "utf8");
    return renderPrompt({
      phase: p,
      flumeDir: "/state-root",
      promptFile,
      cwd: dir,
      args: {},
      ...(assignedEntry ? { assignedEntry } : {}),
    });
  }

  it("unscoped tick (no assignedEntry): byte-identical to the pre-§2 collapsed rendering", async () => {
    const p = phase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "tests/**"],
      gates: [
        { name: "tsc", when: "afterCommit", run: async () => ({ ok: true, message: "" }) },
      ],
    });

    const out = await render(p);

    expect(out).toBe(
      [
        `<harness>`,
        `Phase: build`,
        `Concurrency: fanout`,
        `Writable paths (anything else you modify will revert the commit):`,
        `  - src/**`,
        `  - tests/**`,
        `Gates (run automatically after your commit):`,
        `  - tsc (afterCommit)`,
        `</harness>`,
      ].join("\n") +
        "\n" +
        "task body\n",
    );
    expect(out).not.toContain("Effective fence");
    expect(out).not.toContain("Outer ceiling");
  });

  it("scoped tick: names entry.files ∪ entryChannelPaths as the effective fence and writablePaths as the outer ceiling", async () => {
    const p = phase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "tests/**"],
      entryChannelPaths: [".flume/plan/open-questions.md"],
      gates: [],
    });
    const e = entry({
      files: {
        new: [{ path: "src/New.ts", description: "new" }],
        edit: [{ path: "src/Existing.ts", description: "edit" }],
        retire: ["src/Old.ts"],
      },
    });

    const out = await render(p, e);

    expect(out).toContain(
      "Effective fence (your commit may touch exactly these; anything else reverts the commit whole):",
    );
    expect(out).toContain("  - src/New.ts");
    expect(out).toContain("  - src/Existing.ts");
    expect(out).toContain("  - src/Old.ts");
    expect(out).toContain("  - .flume/plan/open-questions.md");
    expect(out).toContain(
      "Outer ceiling (also enforced, independently of the fence above — a path must clear both):",
    );
    expect(out).toContain("  - src/**");
    expect(out).toContain("  - tests/**");
    // The unscoped label never appears alongside the scoped one.
    expect(out).not.toContain(
      "Writable paths (anything else you modify will revert the commit):",
    );

    // Effective fence is listed before the outer ceiling.
    const fenceIdx = out.indexOf("Effective fence");
    const ceilingIdx = out.indexOf("Outer ceiling");
    expect(fenceIdx).toBeGreaterThan(-1);
    expect(ceilingIdx).toBeGreaterThan(fenceIdx);
  });

  it("scoped tick with no entryChannelPaths: fence is exactly entry.files, no stray empty line", async () => {
    const p = phase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [],
    });
    const e = entry({
      files: {
        new: [],
        edit: [{ path: "src/only.ts", description: "edit" }],
        retire: [],
      },
    });

    const out = await render(p, e);

    expect(out).toContain("  - src/only.ts");
    // Nothing else named in the fence — the ceiling glob is separate.
    const fenceSection = out.slice(
      out.indexOf("Effective fence"),
      out.indexOf("Outer ceiling"),
    );
    expect(fenceSection).not.toContain("src/**");
  });
});

type ExecCallback = (
  err: NodeJS.ErrnoException | null,
  stdout: string,
  stderr: string,
) => void;

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error("spawn sh ENOENT"), { code: "ENOENT" });
}

describe("renderPrompt — inline-exec win32 shell fallback (RELEASE-v0.4 §6)", () => {
  async function render(): Promise<string> {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "value=!`echo hi`\n", "utf8");
    return renderPrompt({
      phase: phase(),
      flumeDir: "/state-root",
      promptFile,
      cwd: dir,
      args: {},
    });
  }

  it("POSIX: spawns sh -c directly with no shell option — byte-identical to pre-fallback behavior", async () => {
    await withPlatform("linux", async () => {
      execFileMock.mockImplementation(((
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: ExecCallback,
      ) => {
        cb(null, "posix-output", "");
        return {} as never;
      }) as never);

      const out = await render();

      expect(out).toContain("value=posix-output");
      expect(execFileMock).toHaveBeenCalledOnce();
      const [cmd, args, opts] = execFileMock.mock.calls[0]!;
      expect(cmd).toBe("sh");
      expect(args).toEqual(["-c", "echo hi"]);
      expect("shell" in (opts as Record<string, unknown>)).toBe(false);
    });
  });

  it("win32 (simulated ENOENT): retries through the shell and substitutes the retry's stdout", async () => {
    await withPlatform("win32", async () => {
      let call = 0;
      execFileMock.mockImplementation(((
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: ExecCallback,
      ) => {
        call++;
        if (call === 1) {
          cb(enoent(), "", "");
        } else {
          cb(null, "shell-output", "");
        }
        return {} as never;
      }) as never);

      const out = await render();

      expect(out).toContain("value=shell-output");
      expect(out).not.toContain("<exec-failed");
      expect(execFileMock).toHaveBeenCalledTimes(2);
      const [firstCmd, firstArgs, firstOpts] = execFileMock.mock.calls[0]!;
      const [retryCmd, retryArgs, retryOpts] = execFileMock.mock.calls[1]!;
      expect(firstCmd).toBe("sh");
      expect(firstArgs).toEqual(["-c", "echo hi"]);
      expect("shell" in (firstOpts as Record<string, unknown>)).toBe(false);
      expect(retryCmd).toBe("sh");
      expect(retryArgs).toEqual(["-c", "echo hi"]);
      expect(retryOpts).toMatchObject({ shell: true });
    });
  });

  it("win32 (ENOENT on the shell retry too): falls back to <exec-failed> instead of throwing", async () => {
    await withPlatform("win32", async () => {
      execFileMock.mockImplementation(((
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: ExecCallback,
      ) => {
        cb(enoent(), "", "");
        return {} as never;
      }) as never);

      const out = await render();

      expect(out).toContain('<exec-failed cmd="echo hi">');
      expect(execFileMock).toHaveBeenCalledTimes(2);
    });
  });

  it("non-win32 ENOENT is not retried through the shell", async () => {
    await withPlatform("linux", async () => {
      execFileMock.mockImplementation(((
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: ExecCallback,
      ) => {
        cb(enoent(), "", "");
        return {} as never;
      }) as never);

      const out = await render();

      expect(out).toContain('<exec-failed cmd="echo hi">');
      expect(execFileMock).toHaveBeenCalledOnce();
    });
  });
});
