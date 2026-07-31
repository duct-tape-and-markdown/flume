// `spawn` is mocked with the real implementation as its default (via
// `importOriginal`) so most tests exercise a real `sh` child process end to
// end — only the transport-shape assertion below swaps in a fake child to
// inspect the call itself.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderPrompt } from "../src/Prompt.ts";
import type { Phase } from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";

const spawnMock = vi.mocked(spawn);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "flume-prompt-"));
  spawnMock.mockClear();
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

/**
 * A minimal fake `ChildProcess`: an `EventEmitter` with `stdout`/`stderr`
 * sub-emitters and a `stdin.end` that captures what was written, then
 * completes the process on a microtask (mirrors the real async spawn/close
 * ordering closely enough for `runInlineExec` to resolve).
 */
function fakeChild(stdout: string): {
  child: ReturnType<typeof spawn>;
  getWritten: () => string;
} {
  const child = new EventEmitter() as unknown as ReturnType<typeof spawn>;
  Object.assign(child, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  let written = "";
  Object.assign(child, {
    stdin: {
      end: (data: string) => {
        written += data;
        queueMicrotask(() => {
          (child.stdout as unknown as EventEmitter).emit(
            "data",
            Buffer.from(stdout),
          );
          child.emit("close", 0);
        });
      },
    },
  });
  return { child, getWritten: () => written };
}

describe("renderPrompt — inline-exec reaches sh through stdin (RELEASE-v0.10 §2)", () => {
  async function render(promptBody: string): Promise<string> {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, promptBody, "utf8");
    return renderPrompt({
      phase: phase(),
      flumeDir: "/state-root",
      promptFile,
      cwd: dir,
      args: {},
    });
  }

  it("spawns sh with no command argv and writes the command text to stdin — the pre-fix tree always passed ['-c', cmd] and never wrote stdin, on every platform", async () => {
    const { child, getWritten } = fakeChild("mock-output");
    spawnMock.mockImplementationOnce(() => child);

    const out = await render("value=!`echo hi`\n");

    expect(out).toContain("value=mock-output");
    expect(spawnMock).toHaveBeenCalledOnce();
    const [cmd, args] = spawnMock.mock.calls[0]!;
    expect(cmd).toBe("sh");
    expect(args).toEqual([]);
    expect(getWritten()).toBe("echo hi");
  });

  it("the U+2014 repro: a real sh child renders the command's actual output through stdin, non-ASCII intact", async () => {
    const out = await render(
      'value=!`echo "(no prior plan: commit — bootstrap tick)"`\n',
    );

    expect(out).toContain("value=(no prior plan: commit — bootstrap tick)");
  });

  it("the ASCII-hyphen twin of the U+2014 repro renders identically", async () => {
    const out = await render(
      'value=!`echo "(no prior plan: commit - bootstrap tick)"`\n',
    );

    expect(out).toContain("value=(no prior plan: commit - bootstrap tick)");
  });

  it("a non-zero exit still substitutes <exec-failed>, unchanged from before the transport change", async () => {
    const out = await render("value=!`exit 3`\n");

    expect(out).toContain('<exec-failed cmd="exit 3">');
  });
});
