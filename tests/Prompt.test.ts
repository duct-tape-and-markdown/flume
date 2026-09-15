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

import { shellGate, writablePathsGate } from "../src/builtinGates.ts";
import type { GateContext } from "../src/Gate.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import { entryWriteScope } from "../src/paths.ts";
import { NO_COMMIT_MODES, PRIOR_ATTEMPT_MODES } from "../src/index.ts";
import type { NoCommitMode } from "../src/index.ts";
import { renderPrompt, InlineExecRenderError } from "../src/Prompt.ts";
import type {
  GateRevertAttempt,
  CleanExitAttempt,
  PlatformPreemptAttempt,
  RenderRefusedAttempt,
  TipMovedAttempt,
  NotShippedAttempt,
  PriorAttempt,
} from "../src/Prompt.ts";
import type { Phase } from "../src/Phase.ts";
import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

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
    per: { path: "spec/pending.md", section: "5. Tests" },
    gate: { kind: "open" },
    dependsOnForks: [],
    files: { new: [], edit: [], retire: [] },
    tests: [],
    acceptance: "green",
    ...overrides,
  };
}

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

describe("renderPrompt — reserved {{FLUME_DIR}} arg", () => {
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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);
});

describe("renderPrompt — <harness> states the effective fence", () => {
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

  it("unscoped tick (no assignedEntry): byte-identical to the collapsed rendering that predates the effective fence", async () => {
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
  }, SPAWN_BUDGET_MS);

  it("scoped tick (no assignedEntry): byte-identical to a singleton tick's rendering", async () => {
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
        edit: [],
        retire: [],
      },
    });

    const out = await render(p, e);

    expect(out).toContain(
      "Writable paths (anything else you modify will revert the commit):",
    );
    expect(out).not.toContain("Effective fence");
    expect(out).not.toContain("Outer ceiling");
  }, SPAWN_BUDGET_MS);

  it("scoped tick with scopeWritesToEntry: true: names entry.files ∪ entryChannelPaths as the effective fence and writablePaths as the outer ceiling", async () => {
    const p = phase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "tests/**"],
      entryChannelPaths: [".flume/plan/open-questions.md"],
      scopeWritesToEntry: true,
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
  }, SPAWN_BUDGET_MS);

  it("scoped tick with no entryChannelPaths: fence is exactly entry.files, no stray empty line", async () => {
    const p = phase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
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

    const fenceIdx = out.indexOf("Effective fence");
    const ceilingIdx = out.indexOf("Outer ceiling");
    expect(fenceIdx).toBeGreaterThan(-1);
    expect(ceilingIdx).toBeGreaterThan(fenceIdx);

    // Fence is exactly entry.files — one bullet, no stray empty line, and
    // nothing from the ceiling glob leaking in.
    const fenceSection = out.slice(fenceIdx, ceilingIdx);
    expect(fenceSection).toBe(
      "Effective fence (your commit may touch exactly these; anything else reverts the commit whole):\n" +
        "  - src/only.ts\n",
    );
  }, SPAWN_BUDGET_MS);
});

describe("renderPrompt <harness> gate list names every declared gate regardless of concurrency", () => {
  async function render(p: Phase): Promise<string> {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "task body\n", "utf8");
    return renderPrompt({
      phase: p,
      flumeDir: "/state-root",
      promptFile,
      cwd: dir,
      args: {},
    });
  }

  it("a singleton phase declaring an afterMerge gate renders a harness block that names it (spec/worktrees.md 'Singleton runs in a worktree')", async () => {
    const p = phase({
      name: "plan",
      concurrency: "singleton",
      gates: [
        { name: "tsc", when: "afterCommit", run: async () => ({ ok: true, message: "" }) },
        { name: "vitest", when: "afterMerge", run: async () => ({ ok: true, message: "" }) },
      ],
    });

    const out = await render(p);

    expect(out).toContain("  - tsc (afterCommit)");
    expect(out).toContain("  - vitest (afterMerge)");
  }, SPAWN_BUDGET_MS);

  it("a fanout phase's harness block still names its afterMerge gates unchanged", async () => {
    const p = phase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [
        { name: "tsc", when: "afterCommit", run: async () => ({ ok: true, message: "" }) },
        { name: "vitest", when: "afterMerge", run: async () => ({ ok: true, message: "" }) },
      ],
    });

    const out = await render(p);

    expect(out).toContain("  - tsc (afterCommit)");
    expect(out).toContain("  - vitest (afterMerge)");
  }, SPAWN_BUDGET_MS);
});

describe("renderPrompt <harness> gate list renders a declared command (spec/chain.md 'The builtin gates', spec/prompt.md 'The harness block')", () => {
  async function render(p: Phase): Promise<string> {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "task body\n", "utf8");
    return renderPrompt({
      phase: p,
      flumeDir: "/state-root",
      promptFile,
      cwd: dir,
      args: {},
    });
  }

  it("a gate with no declared command renders as 'name (when)' alone", async () => {
    const p = phase({
      gates: [
        { name: "hand-rolled", when: "afterCommit", run: async () => ({ ok: true, message: "" }) },
      ],
    });

    const out = await render(p);

    expect(out).toContain("  - hand-rolled (afterCommit)\n");
  }, SPAWN_BUDGET_MS);

  it("a gate with a declared command renders 'name (when): <command>', sourced from shellGate's own declaration", async () => {
    const gate = shellGate({
      name: "tsc",
      when: "afterCommit",
      cmd: "pnpm",
      args: ["tsc", "--noEmit"],
    });
    const p = phase({ gates: [gate] });

    const out = await render(p);

    expect(out).toContain(`  - tsc (afterCommit): ${gate.command}`);
    expect(out).toContain("  - tsc (afterCommit): pnpm tsc --noEmit");
  }, SPAWN_BUDGET_MS);
});

// Agreement case (ENTRY-WRITE-SCOPE-ONE-DERIVATION, per engineering.md "The
// fix lands at the mechanism"): the rendered effective-fence bullets and
// writablePathsGate's actual accepted scope must agree because both sides
// take the scope from the one `entryWriteScope` derivation — not because a
// comment says so. The gate's half is built by the same call the dispatcher
// makes, so a one-sided edit to either production site lands here; the
// earlier version hand-built `{ entryPaths, channelPaths }` and would have
// shipped such an edit green. This drives the real renderer's output through
// the real gate rather than comparing two hand-authored path lists, per "A
// seam gate reads what the real writer wrote".
describe("renderPrompt effective fence agrees with writablePathsGate's accepted scope", () => {
  function gateCtx(overrides: Partial<GateContext> = {}): GateContext {
    return {
      cwd: dir,
      flumeDir: "/state-root",
      // Relocated state root: the offset a dispatcher would hand this
      // fixture is genuinely absent, stated rather than omitted.
      stateRootRel: undefined,
      pendingPath: "/state-root/plan/pending.json",
      configDir: join(dir, ".flume"),
      repoRoot: dir,
      phaseName: "build",
      commitSha: "deadbeef",
      baseSha: "cafebabe",
      touchedPaths: [],
      log: () => {},
      ...overrides,
    };
  }

  it("the rendered effective fence names exactly the paths the write guard accepts for the same phase and entry", async () => {
    const p = phase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "tests/**", "notes/**"],
      entryChannelPaths: ["notes/open-questions.md"],
      scopeWritesToEntry: true,
      gates: [],
    });
    const e = entry({
      files: {
        new: [{ path: "src/New.ts", description: "new" }],
        edit: [],
        retire: [],
      },
    });

    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "task body\n", "utf8");
    const out = await renderPrompt({
      phase: p,
      flumeDir: "/state-root",
      promptFile,
      cwd: dir,
      args: {},
      assignedEntry: e,
    });

    // Parse the fence back out of the real renderer's output.
    const fenceStart = out.indexOf("Effective fence");
    const ceilingStart = out.indexOf("Outer ceiling");
    const fenceSection = out.slice(fenceStart, ceilingStart);
    const renderedFence = [...fenceSection.matchAll(/^ {2}- (.+)$/gm)].map(
      (m) => m[1]!,
    );
    expect(renderedFence).toEqual(["src/New.ts", "notes/open-questions.md"]);
    // Exactly, not merely compatibly: the bullets are the shared derivation's
    // output verbatim, in order.
    expect(renderedFence).toEqual(entryWriteScope(p, e));

    // The gate's half comes from the same derivation the dispatcher calls —
    // never rebuilt here (`.claude/rules/engineering.md`, "A seam gate reads
    // what the real writer wrote").
    const gate = writablePathsGate(p.writablePaths, entryWriteScope(p, e));

    for (const path of renderedFence) {
      const result = await gate.run(gateCtx({ touchedPaths: [path] }));
      expect(result.ok).toBe(true);
    }

    const rejected = await gate.run(
      gateCtx({ touchedPaths: ["tests/unlisted.test.ts"] }),
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.details).toContain("tests/unlisted.test.ts");
  }, SPAWN_BUDGET_MS);
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

describe("renderPrompt — inline-exec reaches sh through stdin", () => {
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
  }, SPAWN_BUDGET_MS);

  it("the U+2014 repro: a real sh child renders the command's actual output through stdin, non-ASCII intact", async () => {
    const out = await render(
      'value=!`echo "(no prior plan: commit — bootstrap tick)"`\n',
    );

    expect(out).toContain("value=(no prior plan: commit — bootstrap tick)");
  }, SPAWN_BUDGET_MS);

  it("the ASCII-hyphen twin of the U+2014 repro renders identically", async () => {
    const out = await render(
      'value=!`echo "(no prior plan: commit - bootstrap tick)"`\n',
    );

    expect(out).toContain("value=(no prior plan: commit - bootstrap tick)");
  }, SPAWN_BUDGET_MS);
});
describe("renderPrompt — a span's substituted value is shell text (spec/prompt.md 'The render pipeline')", () => {
  it("a placeholder substituted into a span's command reaches sh as text the engine neither quotes nor escapes", async () => {
    const promptFile = join(dir, "prompt.md");
    await writeFile(
      promptFile,
      "bare=!`printf '[%s]' {{VALUE}}`\nauthor=!`printf '[%s]' \"{{VALUE}}\"`\n",
      "utf8",
    );

    const out = await renderPrompt({
      phase: phase(),
      flumeDir: "/state-root",
      promptFile,
      cwd: dir,
      // A space and a backslash: the two bytes `sh` acts on when a word is
      // unquoted, which is what a state root path routinely carries.
      args: { VALUE: "a\\b c" },
    });

    // Unquoted, the value is two words with its backslash eaten — `printf`
    // reused its format once per word. The engine substituted text and did
    // nothing else to it.
    expect(out).toContain("bare=[ab][c]");
    // Quoted by the prompt's author, the same value arrives as one argument,
    // byte for byte: the quoting is the author's job because the engine
    // cannot know a placeholder was meant as one shell word.
    expect(out).toContain("author=[a\\b c]");
  }, SPAWN_BUDGET_MS);
});

describe("renderPrompt — an unresolved inline-exec span aborts the render", () => {
  it("a non-zero exit throws InlineExecRenderError naming the command text and stderr — no <exec-failed> marker, no agent-bound output", async () => {
    let caught: unknown;
    try {
      await render('value=!`echo oops-stderr 1>&2; exit 3`\n');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(InlineExecRenderError);
    const err = caught as InlineExecRenderError;
    expect(err.failures).toHaveLength(1);
    expect(err.failures[0]!.cmd).toBe("echo oops-stderr 1>&2; exit 3");
    expect(err.failures[0]!.stderr).toContain("oops-stderr");
    expect(err.message).toContain("echo oops-stderr 1>&2; exit 3");
    expect(err.message).toContain("oops-stderr");
    expect(err.message).not.toContain("exec-failed");
  }, SPAWN_BUDGET_MS);

  it("names every failing span when more than one fails in the same prompt", async () => {
    let caught: unknown;
    try {
      await render("a=!`exit 1`\nb=!`exit 2`\n");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(InlineExecRenderError);
    const failures = (caught as InlineExecRenderError).failures;
    expect(failures.map((f) => f.cmd).sort()).toEqual(["exit 1", "exit 2"]);
  }, SPAWN_BUDGET_MS);

  it("a spawn failure (sh not found) also aborts the render rather than substituting a marker", async () => {
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as unknown as ReturnType<typeof spawn>;
      Object.assign(child, {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin: { end: () => {} },
        kill: vi.fn(),
      });
      queueMicrotask(() => child.emit("error", new Error("spawn sh ENOENT")));
      return child;
    });

    await expect(render("value=!`echo hi`\n")).rejects.toThrow(
      InlineExecRenderError,
    );
  }, SPAWN_BUDGET_MS);

  it("an empty-but-zero-exit command still renders — exit status decides, never output length", async () => {
    const out = await render("value=[!`printf ''`]\n");

    expect(out).toContain("value=[]\n");
  }, SPAWN_BUDGET_MS);

  it("stdout past the output cap rejects rather than resolving with truncated output", async () => {
    let caught: unknown;
    try {
      await render("value=!`head -c 5000000 /dev/zero`\n");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(InlineExecRenderError);
    const err = caught as InlineExecRenderError;
    expect(err.failures).toHaveLength(1);
    expect(err.failures[0]!.cmd).toBe("head -c 5000000 /dev/zero");
    expect(err.failures[0]!.stderr).toContain("exceeded");
    expect(err.message).toContain("exceeded");
  }, SPAWN_BUDGET_MS);
});

describe("renderPrompt <prior-attempt> — headSha/at anchor on every variant (spec/loop.md 'Every record is anchored')", () => {
  const HEAD_SHA = "a".repeat(40);
  const AT = "2024-06-01T12:00:00.000Z";
  /** The identity every fixture below was written under; the block renders the anchor, not this. */
  const KEYED_AS = "rendered-entry";

  async function renderWithPrior(prior: PriorAttempt): Promise<string> {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "task body\n", "utf8");
    return renderPrompt({
      phase: phase(),
      flumeDir: "/state-root",
      promptFile,
      cwd: dir,
      args: {},
      priorAttempt: prior,
    });
  }

  const gateRevert: GateRevertAttempt = {
    mode: "gate-revert",
    when: "afterCommit",
    gate: "revert-gate",
    message: "gate said no",
    details: "GATE-DETAIL",
    diffStat: "1 file changed",
    key: "entry",
    keyedAs: KEYED_AS,
    headSha: HEAD_SHA,
    at: AT,
  };
  const cleanExit: CleanExitAttempt = {
    mode: "clean-exit",
    finalMessage:
      "Stopping here: the entry's declared paths sit outside writablePaths.",
    key: "entry",
    keyedAs: KEYED_AS,
    headSha: HEAD_SHA,
    at: AT,
  };
  const platformPreempt: PlatformPreemptAttempt = {
    mode: "platform-preempt",
    failureClass: "exited with code 137",
    key: "entry",
    keyedAs: KEYED_AS,
    headSha: HEAD_SHA,
    at: AT,
  };
  const renderRefused: RenderRefusedAttempt = {
    mode: "render-refused",
    failures: "cmd: exit 3\nstderr: boom",
    key: "entry",
    keyedAs: KEYED_AS,
    headSha: HEAD_SHA,
    at: AT,
  };
  const tipMoved: TipMovedAttempt = {
    mode: "tip-moved",
    expectedTip: "b".repeat(40),
    observedTip: "c".repeat(40),
    key: "entry",
    keyedAs: KEYED_AS,
    headSha: HEAD_SHA,
    at: AT,
  };

  const notShipped: NotShippedAttempt = {
    mode: "not-shipped",
    mergedSha: "d".repeat(40),
    touchedPaths: ["src/one.ts", "src/two.ts"],
    key: "entry",
    keyedAs: KEYED_AS,
    headSha: HEAD_SHA,
    at: AT,
  };

  const variants: Array<[string, PriorAttempt]> = [
    ["gate-revert", gateRevert],
    ["clean-exit", cleanExit],
    ["platform-preempt", platformPreempt],
    ["render-refused", renderRefused],
    ["tip-moved", tipMoved],
    ["not-shipped", notShipped],
  ];

  it("every PRIOR_ATTEMPT_MODES member has a <prior-attempt> fixture the block renders", async () => {
    // Agreement between the taxonomy value and this block's coverage: the
    // modes are enumerated from the engine's own roster — the whole set the
    // renderer switches on, not the no-commit subset of it — so a mode added
    // to PRIOR_ATTEMPT_MODES with no fixture fails here rather than reaching
    // a tick's prompt unrendered. The switch's exhaustiveness is tsc's; that
    // a fixture exists to drive it through is this case's alone.
    expect(PRIOR_ATTEMPT_MODES.length).toBeGreaterThan(0);
    // Both directions, so neither side can drift alone: a fixture for a mode
    // the roster no longer names fails here too.
    expect(variants.length).toBe(PRIOR_ATTEMPT_MODES.length);

    for (const mode of PRIOR_ATTEMPT_MODES) {
      const match = variants.find(([, prior]) => prior.mode === mode);
      expect(match, `no <prior-attempt> fixture for mode '${mode}'`).toBeDefined();

      const out = await renderWithPrior(match![1]);
      expect(out).toContain("<prior-attempt>");
    }
  }, SPAWN_BUDGET_MS);

  it.each(variants)(
    "%s: the rendered block carries the anchor (headSha + at) alongside the mode's own fields",
    async (_mode, prior) => {
      const out = await renderWithPrior(prior);

      expect(out).toContain("<prior-attempt>");
      expect(out).toContain(`Recorded ${AT}, trunk tip ${HEAD_SHA}.`);
      // The anchor rides inside the block, before the task body.
      const blockStart = out.indexOf("<prior-attempt>");
      const anchorIdx = out.indexOf(`Recorded ${AT}, trunk tip ${HEAD_SHA}.`);
      const blockEnd = out.indexOf("</prior-attempt>");
      const bodyIdx = out.indexOf("task body");
      expect(blockStart).toBeGreaterThanOrEqual(0);
      expect(anchorIdx).toBeGreaterThan(blockStart);
      expect(anchorIdx).toBeLessThan(blockEnd);
      expect(bodyIdx).toBeGreaterThan(blockEnd);
    },
    SPAWN_BUDGET_MS,
  );

  it("the prior-attempt block quotes the prior attempt's final message without naming a refused constraint", async () => {
    // Vacuity: the record under test actually carries a message to quote.
    expect(cleanExit.finalMessage.length).toBeGreaterThan(0);

    const out = await renderWithPrior(cleanExit);

    // What the engine holds: a clean exit that committed nothing, plus the
    // agent's own closing prose, verbatim under a neutral label.
    expect(out).toContain("exited cleanly and committed");
    expect(out).toContain("Prior attempt's final message");
    expect(out).toContain(cleanExit.finalMessage);

    // What it must not hold: a reading of why the agent stopped. The old
    // rendering labelled the message a "Refused constraint" and told the
    // retry the prior judgment still held — an intent the engine inferred
    // (`engine-boundary.md`, *Told, not inferred*).
    expect(out).not.toMatch(/refused constraint/i);
    expect(out).not.toMatch(/refused to cross/i);
    expect(out).not.toMatch(/judgment likely still holds/i);
  }, SPAWN_BUDGET_MS);

  it("not-shipped renders the landed sha and every touched path, and states the elision when the writer bounded the list", async () => {
    const whole = await renderWithPrior(notShipped);
    expect(whole).toContain(`Landed commit: ${notShipped.mergedSha}`);
    expect(whole).toContain("src/one.ts");
    expect(whole).toContain("src/two.ts");
    // No elision claimed when the list is whole.
    expect(whole).not.toContain("more path(s)");

    const bounded = await renderWithPrior({ ...notShipped, omittedPaths: 7 });
    expect(bounded).toContain("…and 7 more path(s)");
  }, SPAWN_BUDGET_MS);

  it("tip-moved names the recorded base and the observed HEAD, never a tip-start comparison on the ref", async () => {
    // Vacuity: the record under test carries two distinct shas to name.
    expect(tipMoved.expectedTip).not.toEqual(tipMoved.observedTip);

    const out = await renderWithPrior(tipMoved);

    // Both shas the operator needs, under labels that say which is which
    // (spec/loop.md "Tip verify — one writer per branch, absorption at the
    // merge": the observed HEAD and the recorded base, never the parent).
    expect(out).toContain(`Recorded base: ${tipMoved.expectedTip}`);
    expect(out).toContain(`Observed HEAD: ${tipMoved.observedTip}`);

    // What it must not claim: the leg that writes this record is an ancestry
    // check on the agent's own branch, not a sha comparison against the tip
    // the tick recorded on the ref.
    expect(out).not.toMatch(/tick start/i);
    expect(out).not.toMatch(/the ref moved/i);
  }, SPAWN_BUDGET_MS);

  it("absent priorAttempt renders no block and no anchor line at all", async () => {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "task body\n", "utf8");
    const out = await renderPrompt({
      phase: phase(),
      flumeDir: "/state-root",
      promptFile,
      cwd: dir,
      args: {},
    });

    expect(out).not.toContain("<prior-attempt>");
    expect(out).not.toContain("Recorded ");
  }, SPAWN_BUDGET_MS);
});

describe("src/index.ts — the no-commit taxonomy as a value (NO-COMMIT-MODES-VALUE)", () => {
  it("the engine exports NO_COMMIT_MODES carrying the four no-commit modes", () => {
    // Imported from src/index.ts rather than src/Prompt.ts: the package root
    // is where a prompt renderer or a chain reaches for the taxonomy, which
    // is the whole reason it is a runtime value and not a type alone.
    expect(NO_COMMIT_MODES).toEqual([
      "gate-revert",
      "clean-exit",
      "platform-preempt",
      "render-refused",
    ]);

    // Derived, not restated beside: assignability both ways proves
    // `NoCommitMode` is the value's member type rather than a parallel union
    // a rename on either side could strand.
    const fromValue: NoCommitMode[] = [...NO_COMMIT_MODES];
    const fromType: (typeof NO_COMMIT_MODES)[number][] = fromValue;
    expect(fromType).toEqual([...NO_COMMIT_MODES]);
  });
});

describe("renderPrompt — Phase.promptDataKeys neutralizes substituted spans (PROMPT-DATA-KEYS)", () => {
  // Spans are assembled rather than written literally so this file can itself
  // be substituted into a prompt without arming them.
  const BANG = "!";
  const BREAK = "​";
  const span = (cmd: string) => BANG + "`" + cmd + "`";
  const inert = (cmd: string) => BANG + BREAK + "`" + cmd + "`";
  const spans = (text: string) => [...text.matchAll(/!\s*`([^`]+)`/g)];

  async function renderWith(opts: {
    body: string;
    args: Record<string, string>;
    dataKeys?: readonly string[];
  }): Promise<string> {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, opts.body, "utf8");
    return renderPrompt({
      phase: phase(opts.dataKeys ? { promptDataKeys: opts.dataKeys } : {}),
      flumeDir: "/state-root",
      promptFile,
      cwd: dir,
      args: opts.args,
    });
  }

  it("a declared data key's value carries an inline-exec span into the prompt without executing it", async () => {
    const value = `a cited section says ${span("echo pwned")} here.`;
    // Non-vacuity: the value really does carry a span the engine's own
    // grammar matches, so the assertions below judge something.
    expect(spans(value)).toHaveLength(1);

    const out = await renderWith({
      body: "cited:\n{{SECTION}}\n",
      args: { SECTION: value },
      dataKeys: ["SECTION"],
    });

    expect(out).toContain("echo pwned");
    expect(spawnMock).not.toHaveBeenCalled();
    // The substituted text no longer matches the grammar stage 2 scans with.
    expect(spans(out.slice(out.indexOf("cited:")))).toHaveLength(0);
  }, SPAWN_BUDGET_MS);

  it("a declared data key's neutralized span still shows the agent the command text", async () => {
    const out = await renderWith({
      body: "{{SECTION}}\n",
      args: { SECTION: `run ${span("pnpm tsc --noEmit")} first` },
      dataKeys: ["SECTION"],
    });

    expect(out).toContain(`run ${inert("pnpm tsc --noEmit")} first`);
    // Only the break was added: strip it and the value is byte-identical.
    expect(out.replaceAll(BREAK, "")).toContain(
      `run ${span("pnpm tsc --noEmit")} first`,
    );
  }, SPAWN_BUDGET_MS);

  it("a declared data key carrying an unresolvable span renders instead of refusing the tick", async () => {
    const out = await renderWith({
      body: "{{SECTION}}\n",
      args: { SECTION: `the repro was ${span("no-such-command-xyz")}` },
      dataKeys: ["SECTION"],
    });

    expect(out).toContain(inert("no-such-command-xyz"));
    expect(spawnMock).not.toHaveBeenCalled();
  }, SPAWN_BUDGET_MS);

  it("an undeclared key's value carrying an inline-exec span is still evaluated", async () => {
    const out = await renderWith({
      body: "{{OTHER}}\n",
      args: { OTHER: `live ${span("echo from-other")}` },
      dataKeys: ["SECTION"],
    });

    expect(out).toContain("live from-other");
  }, SPAWN_BUDGET_MS);

  it("neutralizing is per-key: a declared value goes inert beside an undeclared one in the same render", async () => {
    const out = await renderWith({
      body: "{{SECTION}}\n{{OTHER}}\n",
      args: {
        SECTION: `data ${span("echo from-data")}`,
        OTHER: `live ${span("echo from-other")}`,
      },
      dataKeys: ["SECTION"],
    });

    expect(out).toContain(`data ${inert("echo from-data")}`);
    expect(out).toContain("live from-other");
    expect(spawnMock).toHaveBeenCalledOnce();
  }, SPAWN_BUDGET_MS);

  it("a phase declaring no data keys evaluates every substituted span, as before", async () => {
    const out = await renderWith({
      body: "{{SECTION}}\n",
      args: { SECTION: `live ${span("echo still-live")}` },
    });

    expect(out).toContain("live still-live");
  }, SPAWN_BUDGET_MS);
});
