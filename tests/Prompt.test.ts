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
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shellGate, writablePathsGate } from "../src/builtinGates.ts";
import type { GateContext } from "../src/Gate.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import { entryWriteScope } from "../src/paths.ts";
import { NO_COMMIT_MODES, PRIOR_ATTEMPT_MODES } from "../src/index.ts";
import type { NoCommitMode } from "../src/index.ts";
import {
  renderPrompt,
  InlineExecRenderError,
  MissingPlaceholderRenderError,
  RenderRefusal,
} from "../src/Prompt.ts";
import type {
  GateRevertAttempt,
  CleanExitAttempt,
  PlatformPreemptAttempt,
  RenderRefusedAttempt,
  TipMovedAttempt,
  NotShippedAttempt,
  PriorAttempt,
  PriorAttemptEnvelope,
} from "../src/Prompt.ts";
import type { Phase } from "../src/Phase.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import {
  priorAttemptBlock,
  priorAttemptBlockIfAny,
} from "./helpers/priorAttemptBlock.ts";
import {
  harnessLeads,
  listingUnder,
  taskBody,
} from "./helpers/renderedPrompt.ts";
import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

const spawnMock = vi.mocked(spawn);

let dir: string;

beforeEach(async () => {
  dir = await mkTempDir("flume-prompt-");
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
    priority: 0,
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
    template: await readFile(promptFile, "utf8"),
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
      template: await readFile(promptFile, "utf8"),
      cwd: dir,
      args: {}, // chain supplies nothing
    });

    // The body as a total: the substituted path is there and no unresolved
    // copy of the placeholder is anywhere else in it, which a `toContain` of
    // the resolved line alone would not see.
    expect(taskBody(out)).toBe("read /abs/state-root/plan/pending.json\n");
  }, SPAWN_BUDGET_MS);

  it("FLUME_DIR is reserved — a chain-supplied arg cannot shadow the resolved root", async () => {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "root={{FLUME_DIR}}\n", "utf8");

    const out = await renderPrompt({
      phase: phase(),
      flumeDir: "/resolved",
      template: await readFile(promptFile, "utf8"),
      cwd: dir,
      args: { FLUME_DIR: "/chain-supplied-WRONG" },
    });

    // The body as a total: the chain's value reaches no part of it, not just
    // not the line the reserved key resolved.
    expect(taskBody(out)).toBe("root=/resolved\n");
  }, SPAWN_BUDGET_MS);
});

describe("renderPrompt — <harness> states the effective fence", () => {
  // The renderer's own lead lines. A case names the fence it expects by its
  // lead and asserts the block's leads as a total, so a reworded lead reds
  // rather than passing the negative it no longer matches.
  const UNSCOPED_LEAD =
    "Writable paths (anything else you modify will revert the commit):";
  const FENCE_LEAD =
    "Effective fence (your commit may touch exactly these; anything else reverts the commit whole):";
  const CEILING_LEAD =
    "Outer ceiling (also enforced, independently of the fence above — a path must clear both):";
  const GATES_LEAD = "Gates (run automatically after your commit):";

  async function render(
    p: Phase,
    assignedEntry?: PendingEntry,
  ): Promise<string> {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "task body\n", "utf8");
    return renderPrompt({
      phase: p,
      flumeDir: "/state-root",
      template: await readFile(promptFile, "utf8"),
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
    // The byte-exact total above is the whole claim — the scoped pair's
    // absence is part of it, so no negative is stated beside it.
  }, SPAWN_BUDGET_MS);

  it("a phase that declines scopeWritesToEntry renders the same bytes with an assignedEntry as without one", async () => {
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

    const withEntry = await render(p, e);
    const withoutEntry = await render(p);

    // The claim, byte for byte: the entry reaches the render through
    // `entryWriteScope` alone, and that returns nothing without the opt-in,
    // so the two renders are one string.
    expect(entryWriteScope(p, e)).toBeUndefined();
    expect(withEntry).toBe(withoutEntry);

    // Non-vacuity, both halves. The block the two agree on is the unscoped
    // one, populated — its leads as a total, so the scoped pair's absence is
    // this same assertion rather than a negative over everything else the
    // render quotes.
    expect(harnessLeads(withEntry)).toEqual([UNSCOPED_LEAD, GATES_LEAD]);
    expect(listingUnder(withEntry, UNSCOPED_LEAD)).toEqual([
      "src/**",
      "tests/**",
    ]);
    // And this entry is one that moves bytes once the phase opts in, so the
    // identity above is the declined opt-in's doing rather than an inert
    // entry's.
    const optedIn = { ...p, scopeWritesToEntry: true };
    expect(entryWriteScope(optedIn, e)?.length).toBeGreaterThan(0);
    expect(harnessLeads(await render(optedIn, e))).toEqual([
      FENCE_LEAD,
      CEILING_LEAD,
      GATES_LEAD,
    ]);
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

    // The leads as a total, in render order — the fence before the ceiling,
    // and no unscoped label beside them.
    expect(harnessLeads(out)).toEqual([FENCE_LEAD, CEILING_LEAD, GATES_LEAD]);
    // Each listing as a total: entry.files in declaration order then the
    // channel path for the fence, phase.writablePaths for the ceiling.
    expect(listingUnder(out, FENCE_LEAD)).toEqual([
      "src/New.ts",
      "src/Existing.ts",
      "src/Old.ts",
      ".flume/plan/open-questions.md",
    ]);
    expect(listingUnder(out, CEILING_LEAD)).toEqual(["src/**", "tests/**"]);
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
      template: await readFile(promptFile, "utf8"),
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
      template: await readFile(promptFile, "utf8"),
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

// Agreement case (ENTRY-WRITE-SCOPE-ONE-DERIVATION, per
// .claude/rules/engineering.md "The fix lands at the mechanism"): the rendered
// effective-fence bullets and writablePathsGate's actual accepted scope must
// agree because both sides take the scope from the one `entryWriteScope`
// derivation — not because a comment says so. The gate's half is built by the
// same call the dispatcher makes, so a one-sided edit to either production site
// lands here; the earlier version hand-built `{ entryPaths, channelPaths }` and
// would have shipped such an edit green. This drives the real renderer's output
// through the real gate rather than comparing two hand-authored path lists, per
// "A seam gate reads what the real writer wrote".
describe("renderPrompt effective fence agrees with writablePathsGate's accepted scope", () => {
  function gateCtx(overrides: Partial<GateContext> = {}): GateContext {
    return {
      cwd: dir,
      flumeDir: "/state-root",
      // Relocated state root: the offset a dispatcher would hand this
      // fixture is genuinely absent, stated rather than omitted.
      stateRootRel: undefined,
      pendingDir: "/state-root/plan/pending",
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
      template: await readFile(promptFile, "utf8"),
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

describe("renderPrompt — an unresolved {{KEY}} refuses the render", () => {
  it("names every missing key, sorted, in one refusal", async () => {
    await expect(render("a={{BETA}} b={{ALPHA}} c={{BETA}}\n")).rejects.toThrow(
      "prompt references missing args: ALPHA, BETA",
    );
  }, SPAWN_BUDGET_MS);

  it("refuses rather than returning a prompt whose resolvable keys were substituted", async () => {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "here={{HERE}} gone={{GONE}}\n", "utf8");

    await expect(
      renderPrompt({
        phase: phase(),
        flumeDir: "/state-root",
        template: await readFile(promptFile, "utf8"),
        cwd: dir,
        args: { HERE: "resolved-value" },
      }),
    ).rejects.toThrow("prompt references missing args: GONE");
  }, SPAWN_BUDGET_MS);

  it("the refusal is the render's own class, naming every missing key and the wall it signs", async () => {
    let caught: unknown;
    await render("a={{BETA}} b={{ALPHA}} c={{BETA}}\n").catch((err: unknown) => {
      caught = err;
    });

    // The type first: the tick classifies `render-refused` on `RenderRefusal`
    // (`src/tickAttempt.ts`), so a plain `Error` here would leave `runAttempt`
    // whole and tear the wave down instead of ending one slot.
    expect(caught).toBeInstanceOf(MissingPlaceholderRenderError);
    expect(caught).toBeInstanceOf(RenderRefusal);
    expect(caught).not.toBeInstanceOf(InlineExecRenderError);

    const err = caught as MissingPlaceholderRenderError;
    // Every key, deduped and sorted — not the first one found.
    expect(err.missing).toEqual(["ALPHA", "BETA"]);
    // The wall the repeated-failure backstop keys on: the keys, never the
    // prompt text around them.
    expect(err.signature).toBe("missing args: ALPHA, BETA");
    expect(err.name).toBe("MissingPlaceholderRenderError");
  }, SPAWN_BUDGET_MS);
});

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
      template: await readFile(promptFile, "utf8"),
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

  it("an inline-exec span aborted at the output cap rejects only after its killed child has exited", async () => {
    // A real `sh` (the mock's default implementation), so there is a live
    // child for the cap to kill and a handle on it to read afterwards.
    await expect(
      render("value=!`head -c 5000000 /dev/zero`\n"),
    ).rejects.toThrow(InlineExecRenderError);

    expect(spawnMock.mock.results).toHaveLength(1);
    const child = spawnMock.mock.results[0]!.value as ReturnType<typeof spawn>;
    expect(child.killed).toBe(true);
    // Both null means Node has not seen the child end: it was signalled and
    // the render returned anyway, leaving a live process holding `dir` open —
    // the win32 `EBUSY: rmdir` this case's own afterEach hit. One of them set
    // means the child was reaped before the rejection surfaced. The exit
    // event is a macrotask, so awaiting the rejection alone cannot have
    // delivered it.
    expect([child.exitCode, child.signalCode]).not.toEqual([null, null]);
  }, SPAWN_BUDGET_MS);
});

describe("renderPrompt <prior-attempt> — headSha/at anchor on every variant (spec/loop.md 'Every record is anchored')", () => {
  const HEAD_SHA = "a".repeat(40);
  const AT = "2024-06-01T12:00:00.000Z";
  /** The identity every fixture below was written under; the block renders the anchor, not this. */
  const KEYED_AS = "rendered-entry";
  /** The lead the `not-shipped` record's touched-path listing sits under. */
  const PATHS_LEAD = "Paths it touched:";
  /** A clean exit whose ref never moved: one tip for both ends of the span. */
  const UNMOVED_TIP = "d".repeat(40);

  async function renderWithPrior(prior: PriorAttempt): Promise<string> {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "task body\n", "utf8");
    return renderPrompt({
      phase: phase(),
      flumeDir: "/state-root",
      template: await readFile(promptFile, "utf8"),
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
    spanBase: UNMOVED_TIP,
    spanHead: UNMOVED_TIP,
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

  /**
   * The fields every record carries whatever tagged it — the envelope plus the
   * discriminant. Spelled as keys of {@link PriorAttemptEnvelope}, so a field
   * the envelope gains is a compile error here rather than a value the
   * per-mode case below starts demanding of the block.
   */
  const SHARED_FIELDS: ReadonlyArray<keyof PriorAttemptEnvelope | "mode"> = [
    "mode",
    "key",
    "keyedAs",
    "declaredAs",
    "headSha",
    "at",
  ];

  /**
   * Every line of every value a fixture carries *beyond* the envelope, paired
   * with the field holding it — read off the record rather than restated
   * beside it, so a field a variant gains is judged by the case already
   * running over that variant. Lines, not whole values: `indentBlock` prefixes
   * each line of a multi-line value, so the line is the unit that survives
   * into the block.
   */
  function ownFieldLines(prior: PriorAttempt): Array<[string, string]> {
    const lines: Array<[string, string]> = [];
    for (const [field, value] of Object.entries(prior)) {
      if ((SHARED_FIELDS as readonly string[]).includes(field)) continue;
      if (value === undefined) continue;
      for (const one of Array.isArray(value) ? value : [value]) {
        for (const line of String(one).split("\n")) {
          if (line.trim().length > 0) lines.push([field, line.trim()]);
        }
      }
    }
    return lines;
  }

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
    "%s: every prior-attempt mode's own fields reach the rendered block, alongside the anchor (headSha + at)",
    async (_mode, prior) => {
      const out = await renderWithPrior(prior);
      const block = priorAttemptBlock(out);

      // The mode's own half of the claim: every value this variant declares
      // beyond the envelope is inside the block, named by its field when it
      // is not. Vacuity first — a mode with no own fields would pass the loop
      // below over nothing, and five of the six modes had no field assertion
      // anywhere when the anchor was all this case read.
      const own = ownFieldLines(prior);
      expect(
        own.length,
        `the '${prior.mode}' fixture declares no fields of its own`,
      ).toBeGreaterThan(0);
      for (const [field, line] of own) {
        expect(
          block,
          `${prior.mode}.${field} never reached the rendered block`,
        ).toContain(line);
      }

      // The anchor's half: inside the block, before the task body.
      expect(block).toContain(`Recorded ${AT}, trunk tip ${HEAD_SHA}.`);
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

    const block = priorAttemptBlock(await renderWithPrior(cleanExit));

    // What the engine holds: a clean exit that committed nothing, plus the
    // agent's own closing prose, verbatim under a neutral label.
    expect(block).toContain("exited cleanly and committed");
    expect(block).toContain("Prior attempt's final message");
    expect(block).toContain(cleanExit.finalMessage);

    // What it must not hold: a reading of why the agent stopped. The old
    // rendering labelled the message a "Refused constraint" and told the
    // retry the prior judgment still held — an intent the engine inferred
    // (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
    expect(block).not.toMatch(/refused constraint/i);
    expect(block).not.toMatch(/refused to cross/i);
    expect(block).not.toMatch(/judgment likely still holds/i);
  }, SPAWN_BUDGET_MS);

  it("clean-exit names the span both ways: unmoved for an attempt that never committed, base..head for one whose span's diff was empty", async () => {
    // Vacuity: the two fixtures really do differ on the fact under test —
    // one ref moved, the other did not.
    expect(cleanExit.spanBase).toBe(cleanExit.spanHead);
    const emptySpan: CleanExitAttempt = {
      ...cleanExit,
      spanHead: "e".repeat(40),
    };
    expect(emptySpan.spanBase).not.toBe(emptySpan.spanHead);

    const unmoved = priorAttemptBlock(await renderWithPrior(cleanExit));
    expect(unmoved).toContain(`Span: ${UNMOVED_TIP}, unmoved`);
    expect(unmoved).toContain("committed nothing");
    expect(unmoved).not.toContain(`${UNMOVED_TIP}..`);

    // The empty span's own commits are named as a range, so the retry can
    // read what the prior attempt wrote before redoing it — and the block
    // says plainly that the span never reached the merge stage.
    const empty = priorAttemptBlock(await renderWithPrior(emptySpan));
    expect(empty).toContain(`Span: ${emptySpan.spanBase}..${emptySpan.spanHead}`);
    expect(empty).toContain("diff against its base was empty");
    expect(empty).toContain("never reached the merge stage");
    // Neither arm says *why* the agent stopped — that stays the chain's
    // reading of the quoted message (`.claude/rules/engine-boundary.md`,
    // *Told, not inferred*).
    expect(empty).not.toMatch(/refused/i);
  }, SPAWN_BUDGET_MS);

  it("not-shipped renders the landed sha and every touched path, and states the elision when the writer bounded the list", async () => {
    // Vacuity: the record under test actually carries paths to list.
    expect(notShipped.touchedPaths.length).toBeGreaterThan(0);

    const whole = priorAttemptBlock(await renderWithPrior(notShipped));
    expect(whole).toContain(`Landed commit: ${notShipped.mergedSha}`);
    // The listing as a total, so "no elision claimed when the list is whole"
    // is the same assertion as "every touched path" rather than a negative
    // over a render that also quotes the fence and the task body.
    expect(listingUnder(whole, PATHS_LEAD, "  ")).toEqual(
      notShipped.touchedPaths,
    );

    const bounded = priorAttemptBlock(
      await renderWithPrior({ ...notShipped, omittedPaths: 7 }),
    );
    expect(listingUnder(bounded, PATHS_LEAD, "  ")).toEqual([
      ...notShipped.touchedPaths,
      "…and 7 more path(s)",
    ]);
  }, SPAWN_BUDGET_MS);

  it("tip-moved names the recorded base and the observed HEAD, never a tip-start comparison on the ref", async () => {
    // Vacuity: the record under test carries two distinct shas to name.
    expect(tipMoved.expectedTip).not.toEqual(tipMoved.observedTip);

    const block = priorAttemptBlock(await renderWithPrior(tipMoved));

    // Both shas the operator needs, under labels that say which is which
    // (spec/loop.md "Tip verify — one writer per branch, absorption at the
    // merge": the observed HEAD and the recorded base, never the parent).
    expect(block).toContain(`Recorded base: ${tipMoved.expectedTip}`);
    expect(block).toContain(`Observed HEAD: ${tipMoved.observedTip}`);

    // What it must not claim: the leg that writes this record is an ancestry
    // check on the agent's own branch, not a sha comparison against the tip
    // the tick recorded on the ref.
    expect(block).not.toMatch(/tick start/i);
    expect(block).not.toMatch(/the ref moved/i);
  }, SPAWN_BUDGET_MS);

  it("absent priorAttempt renders no block and no anchor line at all", async () => {
    const promptFile = join(dir, "prompt.md");
    await writeFile(promptFile, "task body\n", "utf8");
    const out = await renderPrompt({
      phase: phase(),
      flumeDir: "/state-root",
      template: await readFile(promptFile, "utf8"),
      cwd: dir,
      args: {},
    });

    // The block cut answering absence, plus the task body as a total: no
    // block, and no anchor line loose in what the phase itself authored.
    expect(priorAttemptBlockIfAny(out)).toBeUndefined();
    expect(taskBody(out)).toBe("task body\n");
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
      template: await readFile(promptFile, "utf8"),
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
