import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Partial mock: everything passes through to the real tsImport except in the
// one test below that simulates tsx 4.23's ERR_MODULE_NOT_FOUND/namespace-
// query signature (v0.7 §5) — a shape this installed tsx (4.21) never
// produces on its own, so it can only be exercised by injection.
vi.mock("tsx/esm/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("tsx/esm/api")>();
  return { ...actual, tsImport: vi.fn(actual.tsImport) };
});

import { tsImport } from "tsx/esm/api";
import {
  CjsContextLoadError,
  PendingParseFailure as realPendingParseFailure,
  Dispatcher,
  frictionCountLine,
  loadChainModule,
  superviseLoop,
  writeTickVerdict,
  clearTickVerdict,
  readTickVerdicts,
  EX_TERMINAL_MISCONFIG,
  EX_MOUNT_DEAD,
  worktreeDirName,
  type ChainModule,
  type DispatcherOptions,
  type Logger,
  type TickVerdict,
} from "../src/Dispatcher.ts";
import type { Agent } from "../src/Agent.ts";
import { Baton } from "../src/Baton.ts";
import {
  chainLoadGate,
  // §6 identity pin: the engine's own gate object, compared by reference
  // against what a chain factory receives.
  tscGate as realTscGate,
} from "../src/builtinGates.ts";
import type { Gate } from "../src/Gate.ts";
import type { Chain, Phase, TickContext, TickResult } from "../src/Phase.ts";
import {
  parsePending,
  TAG_MAX_LENGTH,
  type PendingEntry,
} from "../src/PendingSchema.ts";
import { InlineExecRenderError as realInlineExecRenderError } from "../src/Prompt.ts";
import * as git from "../src/git.ts";
// Barrel-export pin (engineering.md "An export earns its consumer"): both
// types are field types on the already-public TickVerdict/TickOutcome, so a
// chain author needs to be able to name them from the package entry point.
// This import fails tsc if either drops from src/index.ts.
import type { ProvisionFailure, TerminalMisconfiguration } from "../src/index.ts";

// Barrel-export pin (engineering.md "An export earns its consumer"):
// NoCommitMode is the field type of TickVerdict.noCommit / TickOutcome
// .noCommit / TickResult.noCommit, so a chain author needs to be able to
// name it from the package entry point. This import fails tsc if it drops
// from src/index.ts.
import type { NoCommitMode } from "../src/index.ts";

const exec = promisify(execFile);

const silent: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * A minimally-valid {@link TickVerdict} — every field `readTickVerdicts`'s
 * structural check requires, defaulted to a clean committed tick. Tests that
 * stub a real `flume tick` child process (writing `tick-verdict.json`
 * directly, as `superviseLoop`'s own suites do) build off this so a stub
 * missing a required field doesn't silently read back as "no verdict".
 */
function verdictFixture(over: Partial<TickVerdict> = {}): TickVerdict {
  return {
    phaseName: "build",
    tags: [],
    committed: true,
    gateResults: [],
    shippedTags: [],
    mergeOutcomes: [],
    summary: "build shipped nothing → hibernate",
    ...over,
  };
}

/**
 * Inject a fixed chain as the per-tick resolver — the `chainLoader` test
 * seam (DispatcherOptions no longer takes a prebuilt `Chain`). Returns the
 * same chain every tick unless the test mutates a closed-over reference.
 */
function staticLoader(chain: Chain): () => Promise<ChainModule> {
  return () => Promise.resolve({ chain });
}

// ---------- temp-repo fixture ----------

interface Fixture {
  repo: string;
  configDir: string;
  cleanup: () => Promise<void>;
}

async function makeFixture(): Promise<Fixture> {
  const repo = await mkdtemp(join(tmpdir(), "flume-dispatcher-repo-"));
  const opts = { cwd: repo };
  await exec("git", ["init", "-q"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  // Byte-exact checkout on Windows: revert-path assertions compare file
  // content, and a host-level autocrlf=true would rewrite LF on reset.
  await exec("git", ["config", "core.autocrlf", "false"], opts);
  // Deep-path fixtures (prior-attempts/<key>.reverted/<rel> etc.) push git
  // operations on this repo past win32's ~260-char default limit; without
  // this pin git itself — not just Node's fs calls — refuses the path.
  await exec("git", ["config", "core.longpaths", "true"], opts);
  await writeFile(join(repo, "README.md"), "seed\n");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "seed.ts"), "// seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);

  const configDir = await mkdtemp(join(tmpdir(), "flume-dispatcher-cfg-"));
  await writeFile(join(configDir, "prompt.md"), "dummy prompt\n", "utf8");

  return {
    repo,
    configDir,
    cleanup: async () => {
      await rm(repo, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    },
  };
}

let fx: Fixture;

beforeEach(async () => {
  fx = await makeFixture();
});

afterEach(async () => {
  await fx.cleanup();
});

// ---------- helpers ----------

async function head(cwd: string): Promise<string> {
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd });
  return stdout.trim();
}

async function writeAndCommit(
  cwd: string,
  rel: string,
  content: string,
  message: string,
): Promise<void> {
  const abs = join(cwd, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
  await exec("git", ["add", "--", rel], { cwd });
  await exec("git", ["commit", "-q", "-m", message], { cwd });
}

async function writePending(
  repo: string,
  entries: PendingEntry[],
): Promise<void> {
  const path = join(repo, ".flume", "plan", "pending.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(entries, null, 2) + "\n", "utf8");
}

async function readPendingFromDisk(repo: string): Promise<PendingEntry[]> {
  const path = join(repo, ".flume", "plan", "pending.json");
  const raw = await readFile(path, "utf8");
  const r = parsePending(raw);
  if (!r.ok) throw new Error("pending.json failed to parse");
  return r.entries;
}

function makeEntry(tag: string, editPaths: string[]): PendingEntry {
  return {
    tag,
    gate: { kind: "open" },
    dependsOnForks: [],
    files: {
      new: [],
      edit: editPaths.map((p) => ({ path: p, description: "edit" })),
      retire: [],
    },
  };
}

function makePhase(overrides: Partial<Phase>): Phase {
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

function singleAgent(action: (cwd: string) => Promise<void>): Agent {
  return {
    name: "fake-singleton",
    async invoke(inv) {
      await action(inv.cwd);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

/**
 * Fanout agent that dispatches to a per-worktree action by the cwd basename
 * (which equals `worktreeDirName(tag)` — the dispatcher's slug,
 * `tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-")`, unchanged for a tag
 * short enough not to need §9's length bound).
 */
function fanoutAgent(
  bySlug: Record<string, (cwd: string) => Promise<void>>,
): Agent {
  return {
    name: "fake-fanout",
    async invoke(inv) {
      const slug = basename(inv.cwd);
      const action = bySlug[slug];
      if (!action) {
        throw new Error(`fanoutAgent: no action registered for slug '${slug}'`);
      }
      await action(inv.cwd);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

/**
 * Minimal, otherwise-valid chain.ts: one singleton "build" phase, no gates,
 * empty handoff. `frictionExpr`, if given, is a raw TS expression spliced in
 * as the `friction` field's value (e.g. `JSON.stringify("friction")`);
 * omitted entirely when absent.
 */
async function writeMinimalChain(
  cfg: string,
  frictionExpr?: string,
): Promise<void> {
  await mkdir(cfg, { recursive: true });
  await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
  await writeFile(
    join(cfg, "chain.ts"),
    `export default () => ({ chain: { phases: [{ name: "build", ` +
      `description: "", promptPath: "prompt.md", concurrency: "singleton", ` +
      `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
      `humanOnly: []${frictionExpr ? `, friction: ${frictionExpr}` : ""} } });\n`,
    "utf8",
  );
}

// ---------- singleton ----------

describe("Dispatcher singleton — commit detected", () => {
  it("returns committed=true and the agent's new SHA, gates green", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/plan-output.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.hibernated).toBe(false);
    expect(outcome.phaseName).toBe("plan");
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.commitSha).toBeDefined();
    expect(outcome.result?.commitSha).not.toBe(preHead);

    const trunkHead = await head(fx.repo);
    expect(outcome.result?.commitSha).toBe(trunkHead);
    expect(outcome.result?.gateResults.length).toBeGreaterThan(0);
    expect(outcome.result?.gateResults.every((g) => g.ok)).toBe(true);
    // writable-paths gate is auto-attached even when phase.gates is empty.
    expect(
      outcome.result?.gateResults.some((g) => g.gate === "writable-paths"),
    ).toBe(true);

    // v0.8 §5: a committed tick's verdict carries the same facts — no
    // interpretation, and `tags` is empty (a singleton phase has no entries).
    expect(outcome.verdict).toBeDefined();
    expect(outcome.verdict?.phaseName).toBe("plan");
    expect(outcome.verdict?.tags).toEqual([]);
    expect(outcome.verdict?.committed).toBe(true);
    expect(outcome.verdict?.noCommit).toBeUndefined();
    expect(outcome.verdict?.shippedTags).toEqual([]);
    expect(outcome.verdict?.mergeOutcomes).toEqual([]);
    expect(
      outcome.verdict?.gateResults.some((g) => g.gate === "writable-paths"),
    ).toBe(true);
  });

  it("reports committed=false (no commit) when the agent does nothing", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // Agent that never commits.
    const agent: Agent = {
      name: "noop",
      async invoke() {
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.commitSha).toBeUndefined();
    expect(await head(fx.repo)).toBe(preHead);
    expect(outcome.result?.gateResults).toEqual([]);
  });
});

describe("Dispatcher singleton — afterCommit gate failure reverts the commit", () => {
  it("drops the agent's commit and reports the failing gate", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const failingGate: Gate = {
      name: "intentional-fail",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "boom", details: "stderr-context" };
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [failingGate],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/output.ts", "x\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.commitSha).toBeUndefined();
    // Trunk is back to preHead — the commit was reverted.
    expect(await head(fx.repo)).toBe(preHead);
    // Working tree is clean (dropLastCommit was a hard reset).
    expect(existsSync(join(fx.repo, "src", "output.ts"))).toBe(false);

    const reported = outcome.result?.gateResults ?? [];
    expect(reported.length).toBe(1);
    expect(reported[0]).toMatchObject({
      gate: "intentional-fail",
      ok: false,
      message: "boom",
    });
    // Loop short-circuits on first failure — writable-paths never ran.
    expect(reported.some((g) => g.gate === "writable-paths")).toBe(false);

    // v0.8 §5: the verdict carries the same gate-revert facts, `details`
    // included verbatim — a chain reading history sees exactly what the
    // gate reported, not a re-derived summary.
    expect(outcome.verdict?.committed).toBe(false);
    expect(outcome.verdict?.noCommit).toBe("gate-revert");
    expect(outcome.verdict?.gateResults).toEqual([
      { gate: "intentional-fail", ok: false, message: "boom", details: "stderr-context" },
    ]);
  });
});

describe("Dispatcher singleton — handoff wakes the successor", () => {
  it("sleeps the running phase and wakes only the named successor", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: (r) => (r.committed ? ["build"] : []),
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/derived.ts", "y\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    expect(baton.awake()).toEqual(["plan"]);
    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.awakeAfter).toEqual(["build"]);
    expect(baton.isAwake("plan")).toBe(false);
    expect(baton.isAwake("build")).toBe(true);
  });

  it("respects chain.humanOnly — does not wake handoff targets on the list", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "singleton",
      handoff: () => ["spec", "plan"],
    });
    const chain: Chain = { phases: [phase], humanOnly: ["spec"] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/done.ts", "z\n", "build: do");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.awakeAfter).toEqual(["plan"]);
    expect(baton.isAwake("spec")).toBe(false);
    expect(baton.isAwake("plan")).toBe(true);
    expect(baton.isAwake("build")).toBe(false);
  });

  it("hibernates when no phases are awake", async () => {
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.hibernated).toBe(true);
    expect(outcome.phaseName).toBeUndefined();
    expect(outcome.terminal).toBeUndefined();
    expect(outcome.awakeAfter).toEqual([]);
  });
});

// ---------- Axis-C terminal misconfiguration (§3) ----------

describe("Dispatcher — orphaned awake flags → Axis-C terminal (§3)", () => {
  it("returns terminal.kind='orphaned-awake' naming the phases, leaves the flags on disk, runs no agent", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("ghost");
    baton.wake("wraith");

    // The chain declares only "plan" — neither awake flag matches.
    const phase = makePhase({ name: "plan" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let invoked = false;
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {
        invoked = true;
      }),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Axis C, not Axis B (hibernated) and not Axis A (noCommit): no agent
    // ran, nothing exists to retry.
    expect(outcome.terminal).toEqual({
      kind: "orphaned-awake",
      phases: ["ghost", "wraith"],
    });
    expect(outcome.hibernated).toBe(false);
    expect(outcome.failed).toBeUndefined();
    expect(outcome.noCommit).toBeUndefined();
    expect(invoked).toBe(false);
    expect(outcome.summary).toMatch(/ghost, wraith/);

    // Silent-ack anti-pattern guard: the flags must survive the tick.
    expect(baton.isAwake("ghost")).toBe(true);
    expect(baton.isAwake("wraith")).toBe(true);
    expect(outcome.awakeAfter).toEqual(["ghost", "wraith"]);
  });

  it("a declared awake phase still runs when an orphaned flag rides alongside it", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    baton.wake("ghost");

    const phase = makePhase({ name: "plan" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Terminal fires only when *every* awake flag is orphaned; a runnable
    // phase runs and the stray flag persists for the next tick to classify.
    expect(outcome.terminal).toBeUndefined();
    expect(outcome.phaseName).toBe("plan");
    expect(baton.isAwake("ghost")).toBe(true);
  });
});

// ---------- fanout ----------

describe("Dispatcher fanout — two disjoint entries both ship", () => {
  it("cherry-picks both worktree commits onto trunk, updates pending.json, sets shippedTags", async () => {
    const entries = [
      makeEntry("TEST-A", ["src/a.ts"]),
      makeEntry("TEST-B", ["src/b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const preHead = await head(fx.repo);

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "test-a": (cwd) =>
        writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): ship"),
      "test-b": (cwd) =>
        writeAndCommit(cwd, "src/b.ts", "from-B\n", "build(TEST-B): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["TEST-A", "TEST-B"]);

    // Trunk advanced past preHead — two cherry-picks + chore commit.
    const trunkHead = await head(fx.repo);
    expect(trunkHead).not.toBe(preHead);

    // Both target files were written into trunk by the cherry-picks.
    expect(await readFile(join(fx.repo, "src/a.ts"), "utf8")).toBe("from-A\n");
    expect(await readFile(join(fx.repo, "src/b.ts"), "utf8")).toBe("from-B\n");

    // pending.json on disk is empty (both entries shipped).
    expect(await readPendingFromDisk(fx.repo)).toEqual([]);
    expect(outcome.result?.pendingAfter).toEqual([]);

    // Worktree dirs were cleaned up.
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "test-a"))).toBe(
      false,
    );
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "test-b"))).toBe(
      false,
    );
  }, 20_000);
});

/**
 * CHAIN-MAXPARALLEL-CHAIN-OVERRIDABLE — `Chain.supervisorPolicy.maxParallel`
 * (`src/Phase.ts`) joins `quarantineScope`/`abortThreshold` as a
 * chain-overridable default for `runFanout`'s batch width
 * (`partitionByFileOverlap`, `src/partition.ts`). Unlike those two knobs this
 * needs no `superviseLoop`/CLI pre-read: it is tick-scoped, not run-scoped —
 * `runFanout` reads it straight off the chain the tick already resolved.
 * Three disjoint, single-file entries make the batch-1 boundary observable
 * via `shippedTags`/`pendingAfter`, the same seam the "two disjoint entries
 * both ship" suite above exercises.
 */
describe("Dispatcher fanout — supervisorPolicy.maxParallel overrides the batch width (CHAIN-MAXPARALLEL-CHAIN-OVERRIDABLE)", () => {
  it("a chain declaring supervisorPolicy.maxParallel: 2 ships only the first two of three disjoint entries", async () => {
    const entries = [
      makeEntry("MP-A", ["src/mp-a.ts"]),
      makeEntry("MP-B", ["src/mp-b.ts"]),
      makeEntry("MP-C", ["src/mp-c.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      supervisorPolicy: { maxParallel: 2 },
    };

    const agent = fanoutAgent({
      "mp-a": (cwd) =>
        writeAndCommit(cwd, "src/mp-a.ts", "from-A\n", "build(MP-A): ship"),
      "mp-b": (cwd) =>
        writeAndCommit(cwd, "src/mp-b.ts", "from-B\n", "build(MP-B): ship"),
      "mp-c": (cwd) =>
        writeAndCommit(cwd, "src/mp-c.ts", "from-C\n", "build(MP-C): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      // DispatcherOptions.maxParallel deliberately unset — the chain's
      // declaration is what's under test, not the embedder fallback.
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    // Batch 1 closes on capacity (2) even though a third disjoint entry was
    // pickable — it stays pending for the next tick's fresh partition.
    expect(outcome.result?.shippedTags).toEqual(["MP-A", "MP-B"]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["MP-C"]);
    expect((await readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "MP-C",
    ]);
  }, 20_000);

  it("a chain declaring nothing gets maxParallel: 4 byte-identically to today", async () => {
    const entries = [
      makeEntry("MPD-A", ["src/mpd-a.ts"]),
      makeEntry("MPD-B", ["src/mpd-b.ts"]),
      makeEntry("MPD-C", ["src/mpd-c.ts"]),
      makeEntry("MPD-D", ["src/mpd-d.ts"]),
      makeEntry("MPD-E", ["src/mpd-e.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    // No supervisorPolicy at all — the undeclared-fields-fall-through case.
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "mpd-a": (cwd) =>
        writeAndCommit(cwd, "src/mpd-a.ts", "from-A\n", "build(MPD-A): ship"),
      "mpd-b": (cwd) =>
        writeAndCommit(cwd, "src/mpd-b.ts", "from-B\n", "build(MPD-B): ship"),
      "mpd-c": (cwd) =>
        writeAndCommit(cwd, "src/mpd-c.ts", "from-C\n", "build(MPD-C): ship"),
      "mpd-d": (cwd) =>
        writeAndCommit(cwd, "src/mpd-d.ts", "from-D\n", "build(MPD-D): ship"),
      "mpd-e": (cwd) =>
        writeAndCommit(cwd, "src/mpd-e.ts", "from-E\n", "build(MPD-E): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      // No DispatcherOptions.maxParallel either — proving the plain v0.2
      // default (4) survives both undeclared surfaces unchanged.
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual([
      "MPD-A",
      "MPD-B",
      "MPD-C",
      "MPD-D",
    ]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["MPD-E"]);
  }, 20_000);
});

describe("Dispatcher fanout — commitPendingUpdate rewrite reads fresh, not a tick-start snapshot (regression)", () => {
  it("ships one entry without clobbering a concurrent edit landed on an untouched entry mid-wave", async () => {
    // SHIP-PENDING-CLOBBER-BUG repro: a ship commit reintroduced a retired
    // field into entries it never shipped. Root cause was commitPendingUpdate
    // deriving its rewrite from the `pending` snapshot the dispatcher read at
    // tick start, before the wave's (possibly long-running) worktree/agent
    // work — so any write another process landed on trunk's pending.json in
    // that window got silently overwritten by the stale snapshot once this
    // wave finally wrote back. KEEP-B is parked (never picked this wave) so
    // it stands in for "an entry this wave doesn't touch"; the fanout
    // agent's action mutates pending.json on disk mid-wave, standing in for
    // that concurrent write.
    const keepB: PendingEntry = {
      ...makeEntry("KEEP-B", ["src/b.ts"]),
      gate: { kind: "parked", reason: "not picked this wave" },
    };
    await writePending(fx.repo, [makeEntry("SHIP-A", ["src/a.ts"]), keepB]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const pendingPath = join(fx.repo, ".flume", "plan", "pending.json");

    const concurrentKeepB: PendingEntry = {
      ...keepB,
      observedFiles: ["src/concurrent-marker.ts"],
    };

    const agent = fanoutAgent({
      "ship-a": async (cwd) => {
        const concurrent = [makeEntry("SHIP-A", ["src/a.ts"]), concurrentKeepB];
        await writeFile(
          pendingPath,
          JSON.stringify(concurrent, null, 2) + "\n",
          "utf8",
        );
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(SHIP-A): ship");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["SHIP-A"]);

    const after = await readPendingFromDisk(fx.repo);
    // The concurrent write's field survived, byte-for-byte — proof the
    // rewrite was derived from pending.json's state at write time, not the
    // stale pre-wave snapshot that never saw it. No reintroduced or
    // foreign keys, no lost edits.
    expect(after).toEqual([concurrentKeepB]);
  }, 20_000);
});

describe("Dispatcher fanout — two consecutive ship waves leave an untouched entry byte-identical", () => {
  it("KEEP survives two ship waves with exactly its pre-wave field set", async () => {
    const keep: PendingEntry = {
      ...makeEntry("KEEP", ["src/keep.ts"]),
      gate: { kind: "parked", reason: "not picked this run" },
    };
    await writePending(fx.repo, [makeEntry("SHIP-1", ["src/one.ts"]), keep]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "ship-1": (cwd) =>
        writeAndCommit(cwd, "src/one.ts", "one\n", "build(SHIP-1): ship"),
      "ship-2": (cwd) =>
        writeAndCommit(cwd, "src/two.ts", "two\n", "build(SHIP-2): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const first = await dispatcher.tick();
    expect(first.result?.shippedTags).toEqual(["SHIP-1"]);
    const afterFirst = await readPendingFromDisk(fx.repo);
    expect(afterFirst).toEqual([keep]);

    // A second entry lands between waves, as a plan tick would — committed,
    // not left dirty, so wave 2's rewrite (which reverts pending.json back
    // to just `keep`, byte-identical to wave 1's commit) has a real diff
    // against HEAD for git to commit.
    await writePending(fx.repo, [
      ...afterFirst,
      makeEntry("SHIP-2", ["src/two.ts"]),
    ]);
    await exec("git", ["add", "--", ".flume/plan/pending.json"], {
      cwd: fx.repo,
    });
    await exec("git", ["commit", "-q", "-m", "plan: add SHIP-2"], {
      cwd: fx.repo,
    });
    baton.wake("build");
    const second = await dispatcher.tick();
    expect(second.result?.shippedTags).toEqual(["SHIP-2"]);

    const afterSecond = await readPendingFromDisk(fx.repo);
    expect(afterSecond).toEqual([keep]);
  }, 20_000);
});

// ---------- trunk contract (v0.5 §2) ----------

describe("Trunk contract — HEAD-is-truth, trunkBranch purged (v0.5 §2)", () => {
  it("DispatcherOptions no longer carries trunkBranch (type-level)", () => {
    // Resolves to `never` (unassignable) if the key ever returns.
    type TrunkBranchPurged = "trunkBranch" extends keyof DispatcherOptions
      ? never
      : true;
    const purged: TrunkBranchPurged = true;
    expect(purged).toBe(true);
  });

  it("ships onto the checked-out branch — HEAD is the trunk", async () => {
    // Move the fixture off its init branch; the ship path must follow HEAD,
    // not any recorded branch name.
    const initBranch = (
      await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: fx.repo })
    ).stdout.trim();
    const initTip = await head(fx.repo);
    await exec("git", ["checkout", "-q", "-b", "job/elsewhere"], {
      cwd: fx.repo,
    });

    await writePending(fx.repo, [makeEntry("TRUNK-HEAD", ["src/t.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "trunk-head": (cwd) =>
        writeAndCommit(cwd, "src/t.ts", "on-head\n", "build(TRUNK-HEAD): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["TRUNK-HEAD"]);

    // Landed on the checked-out branch; the runtime never switched away.
    const onBranch = (
      await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: fx.repo })
    ).stdout.trim();
    expect(onBranch).toBe("job/elsewhere");
    expect(await readFile(join(fx.repo, "src/t.ts"), "utf8")).toBe("on-head\n");

    // The branch we left behind did not move.
    const initTipAfter = (
      await exec("git", ["rev-parse", initBranch], { cwd: fx.repo })
    ).stdout.trim();
    expect(initTipAfter).toBe(initTip);
  }, 20_000);
});

/**
 * v0.4 §2a — worktree base resolution:
 * `FLUME_WORKTREES_DIR ?? join(flumeDir, "worktrees")`. The override exists
 * so ephemeral worktrees can relocate outside every repo-path prefix (the
 * observed stray-write vector); the default tracks the state root, which is
 * itself relocatable via `flumeDir`. `createWorktree` reads the env var at
 * call time, so these tests stash/restore it around each case.
 */
describe("Dispatcher fanout — worktree base resolution (v0.4 §2a)", () => {
  const savedOverride = process.env.FLUME_WORKTREES_DIR;

  afterEach(() => {
    if (savedOverride === undefined) delete process.env.FLUME_WORKTREES_DIR;
    else process.env.FLUME_WORKTREES_DIR = savedOverride;
  });

  it("FLUME_WORKTREES_DIR set → worktree lands under resolve(override), default base never materializes", async () => {
    const container = await mkdtemp(join(tmpdir(), "flume-wt-override-"));
    try {
      // Absolute override — its own resolve() fixed point, so asserting
      // placement under it asserts the resolved base verbatim.
      const base = join(container, "wt-base");
      process.env.FLUME_WORKTREES_DIR = base;

      await writePending(fx.repo, [makeEntry("WT-OVER", ["src/wt-over.ts"])]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      let observedCwd: string | undefined;
      const agent = fanoutAgent({
        "wt-over": async (cwd) => {
          observedCwd = cwd;
          await writeAndCommit(cwd, "src/wt-over.ts", "over\n", "build(WT-OVER): ship");
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.committed).toBe(true);
      expect(outcome.result?.shippedTags).toEqual(["WT-OVER"]);
      // The agent ran inside `<resolve(override)>/<slug>` …
      expect(observedCwd).toBe(join(base, "wt-over"));
      // … and the default `<flumeDir>/worktrees` base was never created.
      expect(existsSync(join(fx.repo, ".flume", "worktrees"))).toBe(false);
      // Teardown cleaned the relocated worktree too.
      expect(existsSync(join(base, "wt-over"))).toBe(false);
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  }, 20_000);

  it("no override → worktree lands under join(flumeDir, 'worktrees')", async () => {
    delete process.env.FLUME_WORKTREES_DIR;
    const flumeDir = join(fx.repo, ".flume");

    await writePending(fx.repo, [makeEntry("WT-DEF", ["src/wt-def.ts"])]);
    new Baton(flumeDir).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let observedCwd: string | undefined;
    const agent = fanoutAgent({
      "wt-def": async (cwd) => {
        observedCwd = cwd;
        await writeAndCommit(cwd, "src/wt-def.ts", "def\n", "build(WT-DEF): ship");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["WT-DEF"]);
    // The agent ran inside `<flumeDir>/worktrees/<slug>` — the base tracks
    // the state root, not a hardcoded repo-relative location.
    expect(observedCwd).toBe(join(flumeDir, "worktrees", "wt-def"));
    // Teardown cleaned the slug dir under the state root.
    expect(existsSync(join(flumeDir, "worktrees", "wt-def"))).toBe(false);
  }, 20_000);
});

/**
 * v0.3 §13 posture — an out-of-tree dock is invisible to git by construction.
 * Ship bookkeeping must not `git add` a pendingPath outside repoRoot (the add
 * fatals *after* entries already merged); the disk write alone carries the
 * auto-unblock and observedFiles forward.
 */
describe("Dispatcher fanout — relocated flumeDir: ship bookkeeping skips the chore commit", () => {
  it("merges the entry to trunk, updates pending at the relocated path, no chore commit, no git fatal", async () => {
    const dock = await mkdtemp(join(tmpdir(), "flume-dock-"));
    try {
      const pendingPath = join(dock, "plan", "pending.json");
      await mkdir(dirname(pendingPath), { recursive: true });
      await writeFile(
        pendingPath,
        JSON.stringify([makeEntry("RELOC-A", ["src/reloc-a.ts"])], null, 2) +
          "\n",
        "utf8",
      );
      new Baton(dock).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const agent = fanoutAgent({
        "reloc-a": (cwd) =>
          writeAndCommit(cwd, "src/reloc-a.ts", "reloc\n", "build(RELOC-A): ship"),
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        flumeDir: dock,
        agent,
        log: silent,
      });

      const preHead = await head(fx.repo);
      const outcome = await dispatcher.tick();

      // The entry merged to trunk.
      expect(outcome.result?.committed).toBe(true);
      expect(outcome.result?.shippedTags).toEqual(["RELOC-A"]);
      expect(await readFile(join(fx.repo, "src/reloc-a.ts"), "utf8")).toBe(
        "reloc\n",
      );

      // Trunk gained exactly the cherry-picked entry commit — no chore
      // commit rides on top, and none is reported as this wave's commit.
      const { stdout: count } = await exec(
        "git",
        ["rev-list", "--count", `${preHead}..HEAD`],
        { cwd: fx.repo },
      );
      expect(count.trim()).toBe("1");
      const { stdout: subject } = await exec(
        "git",
        ["log", "-1", "--format=%s"],
        { cwd: fx.repo },
      );
      expect(subject.trim()).toBe("build(RELOC-A): ship");
      expect(outcome.result?.commitSha).toBeUndefined();

      // Pending was updated on disk at the relocated path.
      const parsed = parsePending(await readFile(pendingPath, "utf8"));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.entries).toEqual([]);
      expect(outcome.result?.pendingAfter).toEqual([]);

      // No state bled into the default in-repo location.
      expect(existsSync(join(fx.repo, ".flume"))).toBe(false);
    } finally {
      await rm(dock, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('Dispatcher fanout — commitMessage override (engine-boundary.md "Capability vs convention")', () => {
  it("a commitMessage override lands verbatim on the ledger ship commit, receiving the shipped tags", async () => {
    await writePending(fx.repo, [makeEntry("SHIP-MSG", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "ship-msg": (cwd) =>
        writeAndCommit(cwd, "src/a.ts", "a\n", "build(SHIP-MSG): ship"),
    });

    let captured: [readonly string[], readonly string[]] | undefined;
    const commitMessage = (
      shippedTags: readonly string[],
      footprintTags: readonly string[],
    ): string => {
      captured = [shippedTags, footprintTags];
      return `chain-custom: shipped=${shippedTags.join(",")} footprint=${footprintTags.join(",")}`;
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      commitMessage,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["SHIP-MSG"]);

    const { stdout: subject } = await exec(
      "git",
      ["log", "-1", "--format=%s"],
      { cwd: fx.repo },
    );
    expect(subject.trim()).toBe(
      "chain-custom: shipped=SHIP-MSG footprint=",
    );
    expect(captured).toEqual([["SHIP-MSG"], []]);
  }, 20_000);

  it("omitting commitMessage reproduces today's exact ship-commit text", async () => {
    await writePending(fx.repo, [makeEntry("SHIP-DEFAULT", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "ship-default": (cwd) =>
        writeAndCommit(cwd, "src/a.ts", "a\n", "build(SHIP-DEFAULT): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["SHIP-DEFAULT"]);

    const { stdout: subject } = await exec(
      "git",
      ["log", "-1", "--format=%s"],
      { cwd: fx.repo },
    );
    expect(subject.trim()).toBe("chore(flume): ship SHIP-DEFAULT");
  }, 20_000);

  it("omitting commitMessage reproduces today's exact merge-failure-footprint text", async () => {
    // Same FOOT-STRAY shape as the §13 footprint regression test above: an
    // entry-fence overreach reverts the whole in-worktree commit, but the
    // footprint still rides commitPendingUpdate's shippedTags=[] branch.
    await writePending(fx.repo, [makeEntry("FOOT-DEFAULT", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "foot-default": async (cwd) => {
        await writeFile(join(cwd, "src", "a.ts"), "a\n");
        await writeFile(join(cwd, "src", "stray.ts"), "stray\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(FOOT-DEFAULT): overreach"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual([]);

    const { stdout: subject } = await exec(
      "git",
      ["log", "-1", "--format=%s"],
      { cwd: fx.repo },
    );
    expect(subject.trim()).toBe(
      "chore(flume): record merge-failure footprints for FOOT-DEFAULT",
    );
  }, 20_000);
});

describe("Dispatcher fanout — stale-slug N≥2 wave: serialized worktree create/teardown (§4)", () => {
  it("creates every worktree + ships every entry despite seeded stale slugs; teardown leaves git worktree list clean", async () => {
    const entries = [
      makeEntry("RACE-A", ["src/race-a.ts"]),
      makeEntry("RACE-B", ["src/race-b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const repoOpts = { cwd: fx.repo };

    // Seed a stale slug for BOTH entries, exactly as a prior crashed run
    // leaves it: a *registered* `git worktree` at `.flume/worktrees/<slug>`
    // (so both `.git/worktrees/<slug>/` metadata and the dir exist). The
    // wave's createWorktree must `git worktree remove --force` each, then
    // re-`add` — the precise remove+add pair that, run N-wide in parallel
    // against the shared `.git/worktrees/` dir, fails a sibling's add
    // mid-validation. Serialized, every add lands.
    for (const slug of ["race-a", "race-b"]) {
      const wtPath = join(fx.repo, ".flume", "worktrees", slug);
      await mkdir(dirname(wtPath), { recursive: true });
      await exec(
        "git",
        ["worktree", "add", "-B", `stale/${slug}`, wtPath, "HEAD"],
        repoOpts,
      );
    }
    // Precondition: the stale worktrees are genuinely registered with git
    // (not just bare dirs) — proving the wave exercises the
    // `git worktree remove --force` path, not the rm-fallback.
    const { stdout: before } = await exec(
      "git",
      ["worktree", "list", "--porcelain"],
      repoOpts,
    );
    // git porcelain output prints forward slashes on every platform.
    expect(before).toContain(".flume/worktrees/race-a");
    expect(before).toContain(".flume/worktrees/race-b");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "race-a": (cwd) =>
        writeAndCommit(cwd, "src/race-a.ts", "A\n", "build(RACE-A): ship"),
      "race-b": (cwd) =>
        writeAndCommit(cwd, "src/race-b.ts", "B\n", "build(RACE-B): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Every worktree was created over its stale slug and every entry
    // shipped — no `git worktree add` failed on a sibling's concurrent
    // remove (§4 acceptance: stale-slug N≥2 wave completes).
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["RACE-A", "RACE-B"]);
    expect(await readFile(join(fx.repo, "src/race-a.ts"), "utf8")).toBe("A\n");
    expect(await readFile(join(fx.repo, "src/race-b.ts"), "utf8")).toBe("B\n");
    expect(await readPendingFromDisk(fx.repo)).toEqual([]);

    // Teardown left `git worktree list` clean: no `.flume/worktrees/`
    // entry survives, neither registered with git nor on disk.
    const { stdout: after } = await exec(
      "git",
      ["worktree", "list", "--porcelain"],
      repoOpts,
    );
    expect(after).not.toContain(join(".flume", "worktrees"));
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "race-a"))).toBe(
      false,
    );
    expect(existsSync(join(fx.repo, ".flume", "worktrees", "race-b"))).toBe(
      false,
    );
  }, 30_000);
});

/**
 * v0.7 §16 — replays the incident shape (`.flume/loop-20260729.log`, batch
 * 3): a deterministic pre-tick worktree provisioning failure on ONE entry's
 * slug must not crash the whole fanout wave when its siblings are perfectly
 * pickable. `git.addWorktree` is spied to fail for exactly one slug — the
 * dispatcher never distinguishes *which* git call inside `createWorktree`
 * threw, so this stands in for the incident's `git worktree remove`/`rm`
 * EBUSY wall without depending on genuine OS-level file locking.
 */
describe("Dispatcher fanout — pre-tick worktree provisioning failure isolates one entry (§16)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the held slug's entry stays pending with a signature; siblings still ship to batch completion", async () => {
    const entries = [
      makeEntry("HELD-ENTRY", ["src/held.ts"]),
      makeEntry("OK-A", ["src/ok-a.ts"]),
      makeEntry("OK-B", ["src/ok-b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const realAddWorktree = git.addWorktree;
    vi.spyOn(git, "addWorktree").mockImplementation(async (opts) => {
      if (opts.path.includes("held-entry")) {
        throw new Error(
          "worktree directory survived removal fallback: " + opts.path,
        );
      }
      return realAddWorktree(opts);
    });

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "ok-a": (cwd) =>
        writeAndCommit(cwd, "src/ok-a.ts", "A\n", "build(OK-A): ship"),
      "ok-b": (cwd) =>
        writeAndCommit(cwd, "src/ok-b.ts", "B\n", "build(OK-B): ship"),
    });

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    const outcome = await dispatcher.tick();

    // The other two entries batch-completed this same tick — the held
    // entry's failure never reached them.
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags?.slice().sort()).toEqual([
      "OK-A",
      "OK-B",
    ]);

    // The held entry carries a comparable signature and stays pending —
    // pending.json itself is never touched for a provisioning failure.
    expect(outcome.provisionFailures).toEqual([
      expect.objectContaining({
        tag: "HELD-ENTRY",
        signature: expect.stringContaining("worktree directory survived"),
      }),
    ]);
    const pendingTags = (await readPendingFromDisk(fx.repo)).map(
      (e) => e.tag,
    );
    expect(pendingTags).toEqual(["HELD-ENTRY"]);

    expect(
      warnings.some(
        (w) => w.includes("HELD-ENTRY") && w.includes("provisioning failed"),
      ),
    ).toBe(true);
  }, 30_000);
});

/**
 * WORKTREES-SETUPHOOK-ISOLATION — mirrors the `createWorktree` isolation test
 * above, one seam later: `phase.setupWorktree` throwing for one entry must
 * not reject the `Promise.all` and crash the whole wave. Before this fix the
 * hook ran unguarded, so this throw would propagate straight out of
 * `runFanout` and fail the tick even though the sibling was perfectly
 * pickable.
 */
describe("Dispatcher fanout — setupWorktree hook throw isolates one entry (WORKTREES-SETUPHOOK-ISOLATION)", () => {
  it("the throwing entry is recorded in provisionFailures and stays pending; the other proceeds to runFanoutEntry", async () => {
    const entries = [
      makeEntry("FAIL-HOOK", ["src/fail-hook.ts"]),
      makeEntry("OK-A", ["src/ok-a.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      setupWorktree: async (ctx) => {
        if (ctx.entryTag === "FAIL-HOOK") {
          throw new Error("setupWorktree boom for FAIL-HOOK");
        }
        return undefined;
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    // `fanoutAgent` throws if invoked for a slug with no registered action —
    // FAIL-HOOK's worktree must never reach the agent, so only "ok-a" is
    // registered.
    const agent = fanoutAgent({
      "ok-a": (cwd) =>
        writeAndCommit(cwd, "src/ok-a.ts", "A\n", "build(OK-A): ship"),
    });

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    const outcome = await dispatcher.tick();

    // The sibling shipped — the hook throw for FAIL-HOOK never reached it.
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["OK-A"]);

    // FAIL-HOOK is parked via provisionFailures exactly like a createWorktree
    // failure — tagged, with a comparable signature — and stays pending.
    expect(outcome.provisionFailures).toEqual([
      expect.objectContaining({
        tag: "FAIL-HOOK",
        signature: expect.stringContaining("setupWorktree boom"),
      }),
    ]);
    const pendingTags = (await readPendingFromDisk(fx.repo)).map(
      (e) => e.tag,
    );
    expect(pendingTags).toEqual(["FAIL-HOOK"]);

    expect(
      warnings.some(
        (w) => w.includes("FAIL-HOOK") && w.includes("setupWorktree hook failed"),
      ),
    ).toBe(true);
  }, 30_000);

  it("worktree/extraEnv indices stay aligned to the surviving entries after a sibling's hook failure is spliced out", async () => {
    const entries = [
      makeEntry("ENTRY-A", ["src/a.ts"]),
      makeEntry("ENTRY-B", ["src/b.ts"]),
      makeEntry("ENTRY-C", ["src/c.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      // ENTRY-B's hook throws; A and C each get an extraEnv value keyed to
      // their own tag, so a misaligned splice (surviving entry fed the
      // wrong neighbor's extraEnv/worktree) shows up as a mismatch below.
      setupWorktree: async (ctx) => {
        if (ctx.entryTag === "ENTRY-B") {
          throw new Error("setupWorktree boom for ENTRY-B");
        }
        return { extraEnv: { WT_TAG: ctx.entryTag } };
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const invokedSlugs: string[] = [];
    const seenExtraEnv: Record<string, string | undefined> = {};
    const agent: Agent = {
      name: "align-check-agent",
      async invoke(inv) {
        const slug = basename(inv.cwd);
        invokedSlugs.push(slug);
        seenExtraEnv[slug] = inv.extraEnv?.WT_TAG;
        if (slug === "entry-a") {
          await writeAndCommit(inv.cwd, "src/a.ts", "A\n", "build(ENTRY-A): ship");
        } else if (slug === "entry-c") {
          await writeAndCommit(inv.cwd, "src/c.ts", "C\n", "build(ENTRY-C): ship");
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(invokedSlugs.slice().sort()).toEqual(["entry-a", "entry-c"]);
    expect(seenExtraEnv["entry-a"]).toBe("ENTRY-A");
    expect(seenExtraEnv["entry-c"]).toBe("ENTRY-C");

    expect(outcome.result?.shippedTags?.slice().sort()).toEqual([
      "ENTRY-A",
      "ENTRY-C",
    ]);
    expect(outcome.provisionFailures).toEqual([
      expect.objectContaining({ tag: "ENTRY-B" }),
    ]);
    const pendingTags = (await readPendingFromDisk(fx.repo)).map(
      (e) => e.tag,
    );
    expect(pendingTags).toEqual(["ENTRY-B"]);
  }, 30_000);
});

/**
 * GITDELETEBRANCH-BROAD-SWALLOW — the teardown loop wraps `git.deleteBranch`
 * per §16's own removeWorktree/teardownWorktree pattern: a non-benign
 * failure (branch.ts now rethrows past the "not found" case) is logged by
 * branch name rather than lost, and the wave still ships.
 */
describe("Dispatcher fanout — teardown loop warns on deleteBranch failure (GITDELETEBRANCH-BROAD-SWALLOW)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a warning naming the branch when deleteBranch rejects for a non-benign reason", async () => {
    const entries = [makeEntry("BRANCH-WARN", ["src/branch-warn.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    vi.spyOn(git, "deleteBranch").mockRejectedValue(
      new Error(
        "Cannot delete branch 'flume/branch-warn' checked out at '/some/path'",
      ),
    );

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "branch-warn": (cwd) =>
        writeAndCommit(
          cwd,
          "src/branch-warn.ts",
          "x\n",
          "build(BRANCH-WARN): ship",
        ),
    });

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    const outcome = await dispatcher.tick();

    // The teardown loop's deleteBranch failure never blocks the ship.
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["BRANCH-WARN"]);

    expect(
      warnings.some((w) => w.includes("flume/branch-warn")),
    ).toBe(true);
  });
});

/**
 * v0.5 §4 — job-scoped fanout branches. The namespace arrives as a
 * `DispatcherOptions.namespace` field (the CLI resolves it from `FLUME_JOB`);
 * with it set, worktree branches are `flume/<namespace>/<slug>`, so two jobs
 * whose pending entries share a tag slug fan out onto disjoint branches.
 * Without it the legacy repo-global `flume/<slug>` stands — bare `.flume`
 * harnesses see no change.
 */
describe("Dispatcher fanout — job-scoped branch namespace (v0.5 §4)", () => {
  async function branchIn(cwd: string): Promise<string> {
    const { stdout } = await exec(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd },
    );
    return stdout.trim();
  }

  it("namespace set → worktree branch is flume/<job>/<slug>; teardown deletes the namespaced branch", async () => {
    await writePending(fx.repo, [makeEntry("NS-FAN", ["src/ns-fan.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let observedBranch: string | undefined;
    const agent = fanoutAgent({
      "ns-fan": async (cwd) => {
        observedBranch = await branchIn(cwd);
        await writeAndCommit(cwd, "src/ns-fan.ts", "ns\n", "build(NS-FAN): ship");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      namespace: "alpha",
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["NS-FAN"]);
    expect(observedBranch).toBe("flume/alpha/ns-fan");
    // Teardown deleted the branch under its namespaced name — the delete
    // follows the created name, not a re-derived legacy one.
    const { stdout: branches } = await exec(
      "git",
      ["branch", "--list", "flume/alpha/ns-fan"],
      { cwd: fx.repo },
    );
    expect(branches.trim()).toBe("");
  }, 20_000);

  it("two state roots with identical tags fan out onto disjoint branches", async () => {
    const dockA = await mkdtemp(join(tmpdir(), "flume-ns-a-"));
    const dockB = await mkdtemp(join(tmpdir(), "flume-ns-b-"));
    try {
      const seed = async (dock: string, editPath: string) => {
        const pendingPath = join(dock, "plan", "pending.json");
        await mkdir(dirname(pendingPath), { recursive: true });
        await writeFile(
          pendingPath,
          JSON.stringify([makeEntry("DUP-TAG", [editPath])], null, 2) + "\n",
          "utf8",
        );
        new Baton(dock).wake("build");
      };
      await seed(dockA, "src/dup-a.ts");
      await seed(dockB, "src/dup-b.ts");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const observed: string[] = [];
      const mkDispatcher = (dock: string, ns: string, file: string) =>
        new Dispatcher({
          chainLoader: staticLoader(chain),
          repoRoot: fx.repo,
          configDir: fx.configDir,
          flumeDir: dock,
          agent: fanoutAgent({
            "dup-tag": async (cwd) => {
              observed.push(await branchIn(cwd));
              await writeAndCommit(cwd, file, "dup\n", `build(DUP-TAG): ship ${ns}`);
            },
          }),
          log: silent,
          namespace: ns,
        });

      const a = await mkDispatcher(dockA, "alpha", "src/dup-a.ts").tick();
      const b = await mkDispatcher(dockB, "beta", "src/dup-b.ts").tick();

      expect(a.result?.shippedTags).toEqual(["DUP-TAG"]);
      expect(b.result?.shippedTags).toEqual(["DUP-TAG"]);
      // Identical tag slugs, disjoint branches — no cross-job clobber (§4).
      expect(observed).toEqual(["flume/alpha/dup-tag", "flume/beta/dup-tag"]);
    } finally {
      await rm(dockA, { recursive: true, force: true });
      await rm(dockB, { recursive: true, force: true });
    }
  }, 30_000);

  it("no namespace → legacy repo-global flume/<slug> (bare .flume harnesses unchanged)", async () => {
    await writePending(fx.repo, [makeEntry("LEGACY-FAN", ["src/legacy-fan.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let observedBranch: string | undefined;
    const agent = fanoutAgent({
      "legacy-fan": async (cwd) => {
        observedBranch = await branchIn(cwd);
        await writeAndCommit(
          cwd,
          "src/legacy-fan.ts",
          "legacy\n",
          "build(LEGACY-FAN): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["LEGACY-FAN"]);
    expect(observedBranch).toBe("flume/legacy-fan");
  }, 20_000);
});

/**
 * v0.5 §4 residual — job-scoped worktree PATHS. The branch namespace alone
 * left paths slug-keyed: two jobs sharing a tag slug under one
 * FLUME_WORKTREES_DIR collide on `<base>/<slug>`, and createWorktree's
 * stale-slug cleanup rm's the OTHER job's live worktree. With a namespace the
 * path mirrors the branch: `<base>/<namespace>/<slug>`; without one the
 * legacy `<base>/<slug>` stands.
 */
describe("Dispatcher fanout — job-scoped worktree paths (v0.5 §4)", () => {
  const savedOverride = process.env.FLUME_WORKTREES_DIR;

  afterEach(() => {
    if (savedOverride === undefined) delete process.env.FLUME_WORKTREES_DIR;
    else process.env.FLUME_WORKTREES_DIR = savedOverride;
  });

  it("namespace + FLUME_WORKTREES_DIR → worktree at <base>/<namespace>/<slug>; teardown cleans it", async () => {
    const container = await mkdtemp(join(tmpdir(), "flume-nspath-"));
    try {
      const base = join(container, "wt-base");
      process.env.FLUME_WORKTREES_DIR = base;

      await writePending(fx.repo, [makeEntry("NS-PATH", ["src/ns-path.ts"])]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      let observedCwd: string | undefined;
      const agent = fanoutAgent({
        "ns-path": async (cwd) => {
          observedCwd = cwd;
          await writeAndCommit(cwd, "src/ns-path.ts", "ns\n", "build(NS-PATH): ship");
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
        namespace: "alpha",
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.shippedTags).toEqual(["NS-PATH"]);
      // The path mirrors the branch namespacing under the shared base …
      expect(observedCwd).toBe(join(base, "alpha", "ns-path"));
      // … the legacy slug-keyed location never materializes …
      expect(existsSync(join(base, "ns-path"))).toBe(false);
      // … and teardown cleans the namespaced dir.
      expect(existsSync(join(base, "alpha", "ns-path"))).toBe(false);
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  }, 20_000);

  it("two namespaces, shared base, identical tag → disjoint paths; neither run rm's the other's live worktree", async () => {
    const container = await mkdtemp(join(tmpdir(), "flume-nspath-shared-"));
    const dockA = await mkdtemp(join(tmpdir(), "flume-nspath-a-"));
    const dockB = await mkdtemp(join(tmpdir(), "flume-nspath-b-"));
    try {
      const base = join(container, "wt-base");
      process.env.FLUME_WORKTREES_DIR = base;

      const seed = async (dock: string, editPath: string) => {
        const pendingPath = join(dock, "plan", "pending.json");
        await mkdir(dirname(pendingPath), { recursive: true });
        await writeFile(
          pendingPath,
          JSON.stringify([makeEntry("DUP-TAG", [editPath])], null, 2) + "\n",
          "utf8",
        );
        new Baton(dock).wake("build");
      };
      await seed(dockA, "src/dup-a.ts");
      await seed(dockB, "src/dup-b.ts");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      // Interleave: park job A mid-agent with its worktree LIVE, then run
      // job B's entire tick (create → agent → teardown) against the shared
      // base. Slug-keyed paths would make B's createWorktree treat
      // `<base>/dup-tag` as a stale remnant and rm A's live worktree out
      // from under its parked agent — the exact clobber this closes.
      let releaseA!: () => void;
      const gate = new Promise<void>((res) => (releaseA = res));
      let signalStarted!: () => void;
      const aStarted = new Promise<void>((res) => (signalStarted = res));

      let cwdA: string | undefined;
      let cwdB: string | undefined;

      const dispA = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        flumeDir: dockA,
        agent: fanoutAgent({
          "dup-tag": async (cwd) => {
            cwdA = cwd;
            signalStarted();
            await gate;
            await writeAndCommit(cwd, "src/dup-a.ts", "A\n", "build(DUP-TAG): ship alpha");
          },
        }),
        log: silent,
        namespace: "alpha",
      });
      const dispB = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        flumeDir: dockB,
        agent: fanoutAgent({
          "dup-tag": async (cwd) => {
            cwdB = cwd;
            await writeAndCommit(cwd, "src/dup-b.ts", "B\n", "build(DUP-TAG): ship beta");
          },
        }),
        log: silent,
        namespace: "beta",
      });

      const aTick = dispA.tick();
      try {
        await aStarted;

        const bOutcome = await dispB.tick();
        expect(bOutcome.result?.shippedTags).toEqual(["DUP-TAG"]);

        // Identical tag slugs, disjoint paths under the one shared base.
        expect(cwdA).toBe(join(base, "alpha", "dup-tag"));
        expect(cwdB).toBe(join(base, "beta", "dup-tag"));
        // B's full run — including its stale-slug cleanup and teardown —
        // left A's live worktree standing.
        expect(existsSync(join(base, "alpha", "dup-tag"))).toBe(true);
      } finally {
        releaseA();
      }

      const aOutcome = await aTick;
      // RELEASE-v0.11 §5: A's wave started on the tip before B ran at all,
      // and B's wave has since landed on it — a claim-less bare-tick
      // collision, exactly what the tip verify exists to catch (v0.11 §2:
      // running two ticks hot against one ref with no coordination is the
      // case the operator avoids by giving them different tips or
      // serializing on the §4 claim). A's cherry-pick refuses; its own
      // worktree commit, on its own disposable branch, is simply never
      // merged — not a lost or corrupted commit, just never landed.
      expect(aOutcome.result?.committed).toBe(false);
      expect(aOutcome.result?.shippedTags).toEqual([]);
      expect(aOutcome.tipMoved).toBe(true);
      expect(await readFile(join(fx.repo, "src/dup-b.ts"), "utf8")).toBe("B\n");
      expect(existsSync(join(fx.repo, "src/dup-a.ts"))).toBe(false);
    } finally {
      await rm(container, { recursive: true, force: true });
      await rm(dockA, { recursive: true, force: true });
      await rm(dockB, { recursive: true, force: true });
    }
  }, 30_000);

  it("no namespace → legacy <base>/<slug> (bare .flume harnesses unchanged)", async () => {
    const container = await mkdtemp(join(tmpdir(), "flume-nspath-legacy-"));
    try {
      const base = join(container, "wt-base");
      process.env.FLUME_WORKTREES_DIR = base;

      await writePending(fx.repo, [makeEntry("LEGACY-PATH", ["src/legacy-path.ts"])]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      let observedCwd: string | undefined;
      const agent = fanoutAgent({
        "legacy-path": async (cwd) => {
          observedCwd = cwd;
          await writeAndCommit(
            cwd,
            "src/legacy-path.ts",
            "legacy\n",
            "build(LEGACY-PATH): ship",
          );
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.shippedTags).toEqual(["LEGACY-PATH"]);
      expect(observedCwd).toBe(join(base, "legacy-path"));
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("Dispatcher fanout — cherry-pick conflict leaves the conflicting entry in pending", () => {
  it("ships the first entry; second cherry-pick aborts; entry persists in pending", async () => {
    // Both fake agents write their declared file plus a shared baseline file
    // with different content. Declared paths are disjoint so partition packs
    // them together;
    // the shared file is an entryChannelPaths allowance — the §5-era conflict
    // vector, since disjoint declared files can no longer collide directly.
    // The first cherry-pick succeeds; the second conflicts because trunk now
    // has 'from-A' where B's diff expects 'baseline'.
    await mkdir(join(fx.repo, "src"), { recursive: true });
    await writeFile(join(fx.repo, "src", "shared.ts"), "baseline\n");
    const repoOpts = { cwd: fx.repo };
    await exec("git", ["add", "--", "src/shared.ts"], repoOpts);
    await exec("git", ["commit", "-q", "-m", "seed shared"], repoOpts);

    const entries = [
      makeEntry("CONFLICT-A", ["src/decoy-a.ts"]),
      makeEntry("CONFLICT-B", ["src/decoy-b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      entryChannelPaths: ["src/shared.ts"],
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "conflict-a": async (cwd) => {
        await mkdir(join(cwd, "src"), { recursive: true });
        await writeFile(join(cwd, "src", "decoy-a.ts"), "a\n");
        await writeFile(join(cwd, "src", "shared.ts"), "from-A\n");
        await exec("git", ["add", "."], { cwd });
        await exec("git", ["commit", "-q", "-m", "build: A"], { cwd });
      },
      "conflict-b": async (cwd) => {
        await mkdir(join(cwd, "src"), { recursive: true });
        await writeFile(join(cwd, "src", "decoy-b.ts"), "b\n");
        await writeFile(join(cwd, "src", "shared.ts"), "from-B\n");
        await exec("git", ["add", "."], { cwd });
        await exec("git", ["commit", "-q", "-m", "build: B"], { cwd });
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Only A made it onto trunk.
    expect(outcome.result?.shippedTags).toEqual(["CONFLICT-A"]);
    expect(outcome.result?.committed).toBe(true);
    expect(await readFile(join(fx.repo, "src/shared.ts"), "utf8")).toBe(
      "from-A\n",
    );

    // pending.json now has only the un-shipped entry.
    const onDisk = await readPendingFromDisk(fx.repo);
    expect(onDisk.map((e) => e.tag)).toEqual(["CONFLICT-B"]);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual([
      "CONFLICT-B",
    ]);

    // v0.8 §5: the verdict's per-entry merge outcomes distinguish the two
    // fates — A merged cleanly, B's cherry-pick itself failed.
    expect(outcome.verdict?.tags.sort()).toEqual(["CONFLICT-A", "CONFLICT-B"]);
    expect(
      [...(outcome.verdict?.mergeOutcomes ?? [])].sort((a, b) =>
        a.tag.localeCompare(b.tag),
      ),
    ).toEqual([
      { tag: "CONFLICT-A", outcome: "merged" },
      {
        tag: "CONFLICT-B",
        outcome: "cherry-pick-conflict",
        footprint: ["src/decoy-b.ts", "src/shared.ts"],
      },
    ]);

    // No lingering cherry-pick state in the worktree — the dispatcher
    // aborted it so the next tick starts clean.
    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: fx.repo,
    });
    expect(status.trim()).toBe("");
  }, 20_000);
});

describe("Dispatcher fanout — afterMerge gate failure reverts only the offending entry (§7b)", () => {
  it("ships the N−1 clean siblings, reverts only the offending entry, keeps it pending with the §5 block; per-entry agent fanout stays parallel", async () => {
    // ISO-PASS and ISO-FAIL fan out concurrently (disjoint declared files →
    // same batch). The afterMerge gate vetoes any merged trunk carrying
    // ISO-FAIL's file, so it fails for ISO-FAIL's commit and passes for
    // ISO-PASS's — independent of cherry-pick order.
    const entries = [
      makeEntry("ISO-PASS", ["src/iso-pass.ts"]),
      makeEntry("ISO-FAIL", ["src/iso-fail.ts"]),
    ];
    await writePending(fx.repo, entries);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const preHead = await head(fx.repo);

    const isoVeto: Gate = {
      name: "iso-veto",
      when: "afterMerge",
      async run({ cwd }) {
        // Per-entry: the gate sees the trunk with exactly one more entry
        // cherry-picked. Veto iff that entry is the offending one.
        return existsSync(join(cwd, "src", "iso-fail.ts"))
          ? {
              ok: false,
              message: "iso veto",
              details: "ISO-FAIL-DETAIL-QQQ",
            }
          : { ok: true, message: "clean" };
      },
    };

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [isoVeto],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // Parallelism probe: per-entry afterMerge isolation must not serialize
    // the agent fanout. Hold both invocations open together so the overlap
    // is real, then assert two were in flight at once.
    let inFlight = 0;
    let maxInFlight = 0;
    const promptsBySlug: Record<string, string[]> = {};
    const agent: Agent = {
      name: "recording-fanout",
      async invoke(inv) {
        const slug = basename(inv.cwd);
        (promptsBySlug[slug] ??= []).push(inv.prompt);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 50));
        inFlight--;
        const file =
          slug === "iso-pass" ? "src/iso-pass.ts" : "src/iso-fail.ts";
        await writeAndCommit(inv.cwd, file, `${slug}\n`, `build(${slug})`);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const first = await dispatcher.tick();

    // Both agents ran concurrently — the fanout is still parallel.
    expect(maxInFlight).toBe(2);

    // Only ISO-PASS shipped; the offending entry's change is NOT on trunk.
    expect(first.result?.committed).toBe(true);
    expect(first.result?.shippedTags).toEqual(["ISO-PASS"]);
    expect(await readFile(join(fx.repo, "src/iso-pass.ts"), "utf8")).toBe(
      "iso-pass\n",
    );
    expect(existsSync(join(fx.repo, "src", "iso-fail.ts"))).toBe(false);

    // Trunk advanced past preHead (ISO-PASS cherry-pick + ship chore), NOT
    // reset to preHead — the whole-wave blast radius is gone.
    expect(await head(fx.repo)).not.toBe(preHead);

    // ISO-FAIL stays pending; ISO-PASS removed by the ship chore.
    const onDisk = await readPendingFromDisk(fx.repo);
    expect(onDisk.map((e) => e.tag)).toEqual(["ISO-FAIL"]);
    expect(first.result?.pendingAfter.map((e) => e.tag)).toEqual(["ISO-FAIL"]);

    // The reverted entry's *actual* commit footprint is recorded on the
    // entry, so the next partition separates the retry from whatever it
    // collided with even where declared `files` under-stated the reach.
    expect(onDisk[0]!.observedFiles).toEqual(["src/iso-fail.ts"]);

    // The offending entry's afterMerge gate failure is recorded; the clean
    // sibling's passing run is too.
    const gr = first.result?.gateResults ?? [];
    expect(gr.some((g) => g.gate === "iso-veto" && !g.ok)).toBe(true);
    expect(gr.some((g) => g.gate === "iso-veto" && g.ok)).toBe(true);

    // v0.8 §5: the verdict's merge outcomes distinguish "merged" from
    // "afterMerge-reverted" per entry, and the failing gate's own detail
    // (the fact behind the revert) rides along verbatim.
    expect(
      [...(first.verdict?.mergeOutcomes ?? [])].sort((a, b) =>
        a.tag.localeCompare(b.tag),
      ),
    ).toEqual([
      {
        tag: "ISO-FAIL",
        outcome: "afterMerge-reverted",
        footprint: ["src/iso-fail.ts"],
      },
      { tag: "ISO-PASS", outcome: "merged" },
    ]);
    const verdictVeto = first.verdict?.gateResults.find(
      (g) => g.gate === "iso-veto" && !g.ok,
    );
    expect(verdictVeto?.details).toBe("ISO-FAIL-DETAIL-QQQ");

    // Retry wave: only ISO-FAIL is still pickable. Its prompt carries the
    // §5 gate-revert block (afterMerge); ISO-PASS never runs again.
    baton.wake("build");
    await dispatcher.tick();

    const passPrompts = promptsBySlug["iso-pass"] ?? [];
    const failPrompts = promptsBySlug["iso-fail"] ?? [];
    expect(passPrompts.length).toBe(1); // shipped — never retried
    expect(passPrompts[0]).not.toContain("<prior-attempt>");
    expect(failPrompts.length).toBe(2); // reverted — retried
    // First attempt: no false signal.
    expect(failPrompts[0]).not.toContain("<prior-attempt>");
    // Retry: the §5 gate-revert block, afterMerge, with the gate detail.
    expect(failPrompts[1]).toContain("<prior-attempt>");
    expect(failPrompts[1]).toContain("Failing gate: iso-veto");
    expect(failPrompts[1]).toContain("Reverted at: afterMerge");
    expect(failPrompts[1]).toContain("ISO-FAIL-DETAIL-QQQ");
  }, 30_000);
});

// ---------- entry-scoped write guard (v0.4 §5) ----------

describe("Dispatcher fanout — entry-scoped write guard (§5)", () => {
  it("ships a scoped commit that stays inside entry.files ∪ entryChannelPaths", async () => {
    await writePending(fx.repo, [makeEntry("SCOPE-OK", ["src/ok.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "notes/**"],
      entryChannelPaths: ["notes/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // One commit touching the declared file AND an undeclared channel path.
    const agent = fanoutAgent({
      "scope-ok": async (cwd) => {
        await writeFile(join(cwd, "src", "ok.ts"), "ok\n");
        await mkdir(join(cwd, "notes"), { recursive: true });
        await writeFile(join(cwd, "notes", "finding.md"), "cross-tick\n");
        await exec("git", ["add", "."], { cwd });
        await exec("git", ["commit", "-q", "-m", "build(SCOPE-OK): ship"], {
          cwd,
        });
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["SCOPE-OK"]);
    expect(await readFile(join(fx.repo, "src/ok.ts"), "utf8")).toBe("ok\n");
    expect(await readFile(join(fx.repo, "notes/finding.md"), "utf8")).toBe(
      "cross-tick\n",
    );
    expect(await readPendingFromDisk(fx.repo)).toEqual([]);
  }, 20_000);

  it("scopeWritesToEntry undeclared: a fanout tick's write allowance is byte-identical to a singleton tick's — writablePaths ceiling only, entry.files ignored", async () => {
    await writePending(fx.repo, [makeEntry("SCOPE-UNDECLARED", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      // scopeWritesToEntry not set — default false.
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // Commit touches the declared file AND an undeclared sibling that is
    // inside phase.writablePaths but outside entry.files — ships because
    // narrowing to the entry never engages without the opt-in.
    const agent = fanoutAgent({
      "scope-undeclared": async (cwd) => {
        await writeFile(join(cwd, "src", "a.ts"), "a\n");
        await writeFile(join(cwd, "src", "stray.ts"), "stray\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(SCOPE-UNDECLARED): ship"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["SCOPE-UNDECLARED"]);
    expect(await readFile(join(fx.repo, "src/a.ts"), "utf8")).toBe("a\n");
    expect(await readFile(join(fx.repo, "src/stray.ts"), "utf8")).toBe(
      "stray\n",
    );
    expect(await readPendingFromDisk(fx.repo)).toEqual([]);
  }, 20_000);

  it("reverts a path outside entry scope but inside phase globs; the retry prompt names it", async () => {
    await writePending(fx.repo, [makeEntry("SCOPE-STRAY", ["src/a.ts"])]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-fanout",
      async invoke(inv) {
        prompts.push(inv.prompt);
        if (prompts.length === 1) {
          // Attempt 1: one commit touching the declared file AND a stray
          // sibling that is inside phase globs but undeclared by the entry.
          await writeFile(join(inv.cwd, "src", "a.ts"), "a\n");
          await writeFile(join(inv.cwd, "src", "stray.ts"), "stray\n");
          await exec("git", ["add", "."], { cwd: inv.cwd });
          await exec(
            "git",
            ["commit", "-q", "-m", "build(SCOPE-STRAY): overreach"],
            { cwd: inv.cwd },
          );
        } else {
          // Retry: stays inside the declared scope.
          await writeAndCommit(
            inv.cwd,
            "src/a.ts",
            "clean\n",
            "build(SCOPE-STRAY): retry",
          );
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();

    // Whole-commit revert: nothing shipped, neither file reached trunk, the
    // entry stays pending.
    expect(first.result?.shippedTags).toEqual([]);
    expect(existsSync(join(fx.repo, "src", "a.ts"))).toBe(false);
    expect(existsSync(join(fx.repo, "src", "stray.ts"))).toBe(false);
    expect((await readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "SCOPE-STRAY",
    ]);
    const gr = first.result?.gateResults ?? [];
    expect(gr.some((g) => g.gate === "writable-paths" && !g.ok)).toBe(true);

    // v0.8 §5: the wave's verdict carries this entry's tag and the
    // writable-paths gate's own violating-path detail — a chain reading
    // last-N verdicts sees `src/stray.ts` named, verbatim, no re-derivation.
    expect(first.verdict?.tags).toEqual(["SCOPE-STRAY"]);
    expect(first.verdict?.committed).toBe(false);
    expect(first.verdict?.noCommit).toBe("gate-revert");
    const verdictGate = first.verdict?.gateResults.find(
      (g) => g.gate === "writable-paths",
    );
    expect(verdictGate?.ok).toBe(false);
    expect(verdictGate?.details).toContain(
      "src/stray.ts (inside phase writablePaths but outside",
    );

    // Retry: the §5 prior-attempt block names the out-of-scope path.
    baton.wake("build");
    const second = await dispatcher.tick();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain("Failing gate: writable-paths");
    expect(prompts[1]).toContain("entry-scoped write allowance");
    // The gate's own detail line — not merely the diffStat — names the path.
    expect(prompts[1]).toContain(
      "src/stray.ts (inside phase writablePaths but outside",
    );
    // entry.files legitimately appearing in the harness block (RELEASE-v0.7
    // §2 effective fence) is correct post-§2 behavior, not a leak — only pin
    // that a.ts (in-scope) is never named as the out-of-scope offender.
    expect(prompts[1]).not.toContain(
      "src/a.ts (inside phase writablePaths but outside",
    );

    // The in-scope retry ships.
    expect(second.result?.shippedTags).toEqual(["SCOPE-STRAY"]);
    expect(await readFile(join(fx.repo, "src/a.ts"), "utf8")).toBe("clean\n");
  }, 30_000);

  it("reverts a path inside entry.files but outside phase globs — the ceiling still binds", async () => {
    await writePending(fx.repo, [
      makeEntry("SCOPE-CEIL", ["src/c.ts", "outside/d.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "scope-ceil": async (cwd) => {
        await writeFile(join(cwd, "src", "c.ts"), "c\n");
        await mkdir(join(cwd, "outside"), { recursive: true });
        await writeFile(join(cwd, "outside", "d.ts"), "d\n");
        await exec("git", ["add", "."], { cwd });
        await exec("git", ["commit", "-q", "-m", "build(SCOPE-CEIL): ship"], {
          cwd,
        });
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual([]);
    expect(existsSync(join(fx.repo, "outside", "d.ts"))).toBe(false);
    expect((await readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "SCOPE-CEIL",
    ]);

    // The persisted §5 record names the ceiling violation, path included.
    const record = JSON.parse(
      await readFile(
        join(fx.repo, ".flume", "prior-attempts", "scope-ceil.json"),
        "utf8",
      ),
    ) as { mode: string; gate: string; details?: string };
    expect(record.mode).toBe("gate-revert");
    expect(record.gate).toBe("writable-paths");
    expect(record.details).toContain("outside/d.ts");
    expect(record.details).toContain("outside phase writablePaths");
  }, 20_000);

  it("an in-worktree afterCommit gate revert leaves the same trunk footprint an afterMerge revert does (§13, RELEASE-v0.7)", async () => {
    // Same shape as "reverts a path outside entry scope but inside phase
    // globs" above — a writable-paths gate revert that never reaches
    // cherry-pick — but this asserts the §13 footprint, not just the revert
    // itself.
    await writePending(fx.repo, [makeEntry("FOOT-STRAY", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const preHead = await head(fx.repo);

    const agent = fanoutAgent({
      "foot-stray": async (cwd) => {
        await writeFile(join(cwd, "src", "a.ts"), "a\n");
        await writeFile(join(cwd, "src", "stray.ts"), "stray\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(FOOT-STRAY): overreach"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Whole-commit revert: nothing shipped, neither file reached trunk via
    // the entry's own commit, entry stays pending.
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(existsSync(join(fx.repo, "src", "a.ts"))).toBe(false);
    expect(existsSync(join(fx.repo, "src", "stray.ts"))).toBe(false);
    expect((await readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "FOOT-STRAY",
    ]);

    // Unlike a bare in-worktree revert, trunk still advances: the footprint
    // rides the existing footprint-commit mechanism (commitPendingUpdate),
    // the same one afterMerge failures use — this is the trunk footprint
    // the next plan tick's commit-delta needs, not just the gitignored
    // prior-attempt record.
    expect(await head(fx.repo)).not.toBe(preHead);

    const onDisk = await readPendingFromDisk(fx.repo);
    expect(onDisk[0]!.observedFiles).toEqual(
      expect.arrayContaining(["src/a.ts", "src/stray.ts"]),
    );

    // v0.8 §5: the footprint commit's file list is not a second, independent
    // capture — it traces straight back to this tick's own TickVerdict
    // record (mergeOutcomes), the same one `commitPendingUpdate` read to
    // build the footprint commit above.
    expect(outcome.verdict?.mergeOutcomes).toEqual([
      {
        tag: "FOOT-STRAY",
        outcome: "afterCommit-reverted",
        footprint: expect.arrayContaining(["src/a.ts", "src/stray.ts"]),
      },
    ]);
    expect(onDisk[0]!.observedFiles!.sort()).toEqual(
      [...outcome.verdict!.mergeOutcomes[0]!.footprint!].sort(),
    );
  }, 20_000);

  it("an in-worktree afterCommit gate revert derives the footprint from runAfterCommitGates' own gate-loop capture, not a second git show (engineering.md 'the fix lands at the mechanism')", async () => {
    // Same FOOT-STRAY shape as the footprint test above, but pinned on the
    // git call count: runAfterCommitGates already shells out to
    // `git show --name-only` once per commit to build the touchedPaths every
    // afterCommit gate reads. The fanout caller re-deriving the identical
    // commit's footprint via a second showNameOnly call is the duplicate
    // this test catches if it's ever reintroduced.
    await writePending(fx.repo, [makeEntry("FOOT-STRAY", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "foot-stray": async (cwd) => {
        await writeFile(join(cwd, "src", "a.ts"), "a\n");
        await writeFile(join(cwd, "src", "stray.ts"), "stray\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(FOOT-STRAY): overreach"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const showNameOnlySpy = vi.spyOn(git, "showNameOnly");

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual([]);
    expect(outcome.verdict?.mergeOutcomes).toEqual([
      {
        tag: "FOOT-STRAY",
        outcome: "afterCommit-reverted",
        footprint: expect.arrayContaining(["src/a.ts", "src/stray.ts"]),
      },
    ]);

    // The reverted commit's touched paths are computed exactly once — inside
    // runAfterCommitGates' own gate-loop capture — and reused by the fanout
    // caller's §13 footprint grab, not re-derived via a second git call.
    expect(showNameOnlySpy).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("singleton ticks keep phase-wide scope — undeclared paths inside globs still ship", async () => {
    // Pending declares a different file; a singleton tick is not entry-scoped,
    // so writing elsewhere inside writablePaths ships. entryChannelPaths on a
    // singleton phase is inert.
    await writePending(fx.repo, [makeEntry("SINGLETON-IGNORES", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      writablePaths: ["src/**", ".flume/**"],
      entryChannelPaths: ["notes/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/unrelated.ts", "u\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(
      outcome.result?.gateResults.some(
        (g) => g.gate === "writable-paths" && g.ok,
      ),
    ).toBe(true);
  }, 20_000);
});

describe("Dispatcher fanout — ship classification trusts the agent's own termination, not entry.files (spec/pending.md \"Ship detection requires a declared-files diff\", ruling 2026-08-03)", () => {
  it("a commit touching no declared file still ships when the agent's clean termination never states a park", async () => {
    // Pre-fix, this was the "channel-only" case: a commit outside the
    // entry's declared files stayed pending forever. The path predicate is
    // gone — a clean termination that never states a park ships regardless
    // of what the diff touches.
    await writePending(fx.repo, [makeEntry("NOTE-ONLY-SHIPS", ["src/ok.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "notes/**"],
      entryChannelPaths: ["notes/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // Commit touches only the channel path, never src/ok.ts — and the
    // agent's (default, empty) termination says nothing about parking.
    const agent = fanoutAgent({
      "note-only-ships": async (cwd) => {
        await mkdir(join(cwd, "notes"), { recursive: true });
        await writeFile(join(cwd, "notes", "finding.md"), "context\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(NOTE-ONLY-SHIPS): finding"],
          { cwd },
        );
      },
    });

    const warnings: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: { info: () => {}, warn: (l) => warnings.push(l), error: () => {} },
    });

    const outcome = await dispatcher.tick();

    expect(await readFile(join(fx.repo, "notes/finding.md"), "utf8")).toBe(
      "context\n",
    );
    expect(outcome.result?.shippedTags).toEqual(["NOTE-ONLY-SHIPS"]);
    expect(await readPendingFromDisk(fx.repo)).toEqual([]);
    expect(warnings.some((w) => w.includes("states a park"))).toBe(false);
  }, 20_000);

  it("a normal ship that also touches channels/CHANGELOG is unaffected", async () => {
    await writePending(fx.repo, [makeEntry("NORMAL-SHIP", ["src/ok.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "notes/**"],
      entryChannelPaths: ["notes/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // Ships the declared file and also touches an undeclared channel path —
    // neither commit content nor entry.files bears on the outcome anymore.
    const agent = fanoutAgent({
      "normal-ship": async (cwd) => {
        await writeFile(join(cwd, "src", "ok.ts"), "ok\n");
        await mkdir(join(cwd, "notes"), { recursive: true });
        await writeFile(join(cwd, "notes", "finding.md"), "context\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(NORMAL-SHIP): ship"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["NORMAL-SHIP"]);
    expect(await readFile(join(fx.repo, "src/ok.ts"), "utf8")).toBe("ok\n");
    expect(await readFile(join(fx.repo, "notes/finding.md"), "utf8")).toBe(
      "context\n",
    );
    expect(await readPendingFromDisk(fx.repo)).toEqual([]);
  }, 20_000);

  it("an entry whose agent states a park in its final message is not classified shipped, even though its commit landed and gates passed", async () => {
    await writePending(fx.repo, [makeEntry("STATED-PARK", ["src/ok.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**", "notes/**"],
      entryChannelPaths: ["notes/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // The commit touches the entry's own declared file — proof this isn't a
    // path check wearing a new name. What keeps it pending is the agent's
    // own final message, not the diff.
    const agent: Agent = {
      name: "parking-fanout",
      async invoke(inv) {
        const slug = basename(inv.cwd);
        if (slug !== "stated-park") {
          throw new Error(`parking-fanout: no action for slug '${slug}'`);
        }
        await writeFile(join(inv.cwd, "src", "ok.ts"), "partial\n");
        await exec("git", ["add", "."], { cwd: inv.cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(STATED-PARK): partial progress"],
          { cwd: inv.cwd },
        );
        return {
          exitCode: 0,
          stdout:
            "Parked: entry needs a design decision outside this tick's scope.\n",
          stderr: "",
        };
      },
    };

    const warnings: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: { info: () => {}, warn: (l) => warnings.push(l), error: () => {} },
    });

    const outcome = await dispatcher.tick();

    // Lands on trunk regardless — classification, not landing, is what
    // a stated park changes (spec/worktrees.md "In-worktree gate reverts
    // leave a trunk footprint" makes the same landed/classified split).
    expect(await readFile(join(fx.repo, "src/ok.ts"), "utf8")).toBe(
      "partial\n",
    );
    expect(outcome.result?.shippedTags).toEqual([]);
    expect((await readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "STATED-PARK",
    ]);
    expect(
      warnings.some(
        (w) => w.includes("STATED-PARK") && w.includes("states a park"),
      ),
    ).toBe(true);
  }, 20_000);
});

describe("Dispatcher fanout — empty pickable set", () => {
  it("returns no-commit when nothing in pending is pickable", async () => {
    // Single entry blocked by an upstream that's still in pending.
    const entries: PendingEntry[] = [
      {
        ...makeEntry("DOWN", ["src/down.ts"]),
        gate: { kind: "blockedBy", tag: "UP" },
      },
      {
        ...makeEntry("UP", ["src/up.ts"]),
        gate: { kind: "parked", reason: "human needed" },
      },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({});

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const preHead = await head(fx.repo);
    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(await head(fx.repo)).toBe(preHead);
    // pendingAfter unchanged.
    expect(outcome.result?.pendingAfter.map((e) => e.tag).sort()).toEqual([
      "DOWN",
      "UP",
    ]);
  });
});

describe("Dispatcher fanout — corrupt pending.json refuses instead of reading as empty (PENDING-PARSE-FAILURE-REFUSES)", () => {
  it("a tick whose pending.json fails to parse invokes no agent and returns failed, instead of nothing-pickable plus a clean hibernation", async () => {
    const pendingPath = join(fx.repo, ".flume", "plan", "pending.json");
    await mkdir(dirname(pendingPath), { recursive: true });
    await writeFile(pendingPath, "{ this is not valid json", "utf8");
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let invoked = false;
    const agent: Agent = {
      name: "fake-fanout",
      async invoke() {
        invoked = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const errors: string[] = [];
    const rec: Logger = { info: () => {}, warn: () => {}, error: (l) => errors.push(l) };

    const preHead = await head(fx.repo);
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: rec,
    });

    const outcome = await dispatcher.tick();

    expect(invoked).toBe(false);
    expect(outcome.failed).toBe(true);
    expect(outcome.hibernated).toBe(false);
    expect(outcome.result).toBeUndefined();
    expect(errors.some((e) => /pending\.json/.test(e) && /parse/.test(e))).toBe(
      true,
    );
    // No commit was made — the corrupt file is untouched.
    expect(await head(fx.repo)).toBe(preHead);
    expect(await readFile(pendingPath, "utf8")).toBe("{ this is not valid json");
  });

  it("a wave whose pending.json is corrupted after tick start leaves the file byte-identical rather than committing []", async () => {
    const entries = [makeEntry("SHIP-A", ["src/a.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const pendingPath = join(fx.repo, ".flume", "plan", "pending.json");

    // Stands in for a concurrent process corrupting pending.json mid-wave —
    // same mechanism the sibling "commitPendingUpdate rewrite reads fresh"
    // suite above uses to simulate a race, but this time the concurrent
    // write is unparseable rather than a valid concurrent edit.
    const corrupt = "{ corrupted mid-wave, not json";
    const agent = fanoutAgent({
      "ship-a": async (cwd) => {
        await writeFile(pendingPath, corrupt, "utf8");
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(SHIP-A): ship");
      },
    });

    const errors: string[] = [];
    const rec: Logger = { info: () => {}, warn: () => {}, error: (l) => errors.push(l) };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: rec,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.failed).toBe(true);
    // The rewrite never derived `[]` from the corrupted read and overwrote
    // it — the concurrent corruption survives byte-for-byte.
    expect(await readFile(pendingPath, "utf8")).toBe(corrupt);
  }, 20_000);

  it("LOOP-WAVE-VERDICT-LOST-ON-LEDGER-PARSEFAILURE: a wave that cherry-picks and gates entries clean, then fails commitPendingUpdate's rewrite read, still writes a tick verdict recording the shipped tags", async () => {
    const entries = [makeEntry("SHIP-A", ["src/a.ts"])];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const pendingPath = join(fx.repo, ".flume", "plan", "pending.json");

    // Same mechanism as the sibling test above: the agent corrupts
    // pending.json mid-wave, after the decide-read that picked SHIP-A but
    // before commitPendingUpdate's rewrite read runs. The cherry-pick and
    // afterMerge gate (none declared, so trivially clean) both land before
    // the corruption is ever read.
    const corrupt = "{ corrupted mid-wave, not json";
    const agent = fanoutAgent({
      "ship-a": async (cwd) => {
        await writeFile(pendingPath, corrupt, "utf8");
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(SHIP-A): ship");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // The refusal itself is unchanged: exit-69-worthy failure, ledger left
    // corrupt rather than overwritten with a rewrite derived from `[]`.
    expect(outcome.failed).toBe(true);
    expect(await readFile(pendingPath, "utf8")).toBe(corrupt);

    // The defect this test pins: the wave's shipped tags used to vanish
    // with the thrown PendingParseFailure instead of reaching a verdict.
    expect(outcome.verdict).toBeDefined();
    expect(outcome.verdict?.shippedTags).toEqual(["SHIP-A"]);
    expect(outcome.verdict?.committed).toBe(true);
    expect(outcome.verdict?.tags).toEqual(["SHIP-A"]);
    expect(outcome.verdict?.phaseName).toBe("build");
  }, 20_000);

  it("LOOP-WAVE-VERDICT-LOST-ON-LEDGER-PARSEFAILURE (multi-entry): a wave with one shipped and one declined entry still folds both facts into the verdict when the ledger rewrite fails", async () => {
    const entries = [
      makeEntry("SHIP-A", ["src/a.ts"]),
      makeEntry("DECLINE-B", ["src/b.ts"]),
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const pendingPath = join(fx.repo, ".flume", "plan", "pending.json");

    // Same corruption mechanism as the single-entry sibling above, but the
    // wave now carries a second, declined entry (RELEASE-v0.11 §8's
    // shouldRun seam) alongside the shipping one — the shape §"The tick
    // verdict" drift (b) actually describes: `waveDeclined`, computed from
    // the per-entry loop before `commitPendingUpdate` runs, must survive
    // onto `WaveLedgerParseFailure`'s carried verdict exactly like
    // `shippedTags` does, not just the trivial single-entry case.
    const corrupt = "{ corrupted mid-wave, not json";
    const invoked: string[] = [];
    const agent = fanoutAgent({
      "ship-a": async (cwd) => {
        invoked.push("SHIP-A");
        await writeFile(pendingPath, corrupt, "utf8");
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(SHIP-A): ship");
      },
      "decline-b": async () => {
        invoked.push("DECLINE-B");
      },
    });

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
      shouldRun: (ctx) => ctx.assignedEntry?.tag !== "DECLINE-B",
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // DECLINE-B never reached the agent; SHIP-A did and shipped.
    expect(invoked).toEqual(["SHIP-A"]);

    // The refusal itself is unchanged: exit-69-worthy failure, ledger left
    // corrupt rather than overwritten with a rewrite derived from `[]`.
    expect(outcome.failed).toBe(true);
    expect(await readFile(pendingPath, "utf8")).toBe(corrupt);

    // The defect this test pins: a multi-entry wave's mixed outcomes —
    // one shipped, one declined — must both fold into the verdict carried
    // on the thrown WaveLedgerParseFailure, not just the shipped tag.
    expect(outcome.verdict).toBeDefined();
    expect(outcome.verdict?.shippedTags).toEqual(["SHIP-A"]);
    expect(outcome.verdict?.committed).toBe(true);
    expect(outcome.verdict?.tags).toEqual(
      expect.arrayContaining(["SHIP-A", "DECLINE-B"]),
    );
    expect(outcome.verdict?.tags).toHaveLength(2);
    expect(outcome.verdict?.declined).toBe(true);
    expect(outcome.verdict?.phaseName).toBe("build");
  }, 20_000);
});

// ---------- foundations governor (§v0.3) ----------

describe("Dispatcher fanout — foundations governor skips fork-blocked entries", () => {
  it("builds the foundation-settled sibling and skips the one whose fork is open", async () => {
    const entries = [
      {
        ...makeEntry("BLOCKED", ["src/blocked.ts"]),
        dependsOnForks: ["open-fork"],
      },
      {
        ...makeEntry("SETTLED", ["src/settled.ts"]),
        dependsOnForks: ["done-fork"],
      },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      settled: (cwd) =>
        writeAndCommit(cwd, "src/settled.ts", "ok\n", "build(SETTLED): ship"),
      // No action registered for `blocked` — if it were selected, the agent throws.
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      // "done-fork" resolves, "open-fork" does not.
      forkResolver: () => (slug) => slug === "done-fork",
    });

    const outcome = await dispatcher.tick();

    // Only the settled entry shipped; the fork-blocked one was never built.
    expect(outcome.result?.shippedTags).toEqual(["SETTLED"]);
    expect(await readPendingFromDisk(fx.repo)).toEqual([
      expect.objectContaining({ tag: "BLOCKED" }),
    ]);
  }, 20_000);
});

describe("Dispatcher fanout — all entries fork-blocked", () => {
  it("idles with no commit rather than building on an open foundation", async () => {
    const entries = [
      { ...makeEntry("A", ["src/a.ts"]), dependsOnForks: ["open-fork"] },
      { ...makeEntry("B", ["src/b.ts"]), dependsOnForks: ["open-fork"] },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({}),
      log: silent,
      forkResolver: () => () => false, // nothing resolved
    });

    const preHead = await head(fx.repo);
    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(await head(fx.repo)).toBe(preHead);
    expect(outcome.result?.pendingAfter.map((e) => e.tag).sort()).toEqual([
      "A",
      "B",
    ]);
  });
});

describe("Dispatcher fanout — gate=requiresCapability (v0.8 §4)", () => {
  it("builds an entry gated on a capability the chain asserts", async () => {
    const entries: PendingEntry[] = [
      {
        ...makeEntry("GATED", ["src/gated.ts"]),
        gate: { kind: "requiresCapability", capability: "docker-host" },
      },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      capabilities: ["docker-host"],
    };

    const agent = fanoutAgent({
      gated: (cwd) =>
        writeAndCommit(cwd, "src/gated.ts", "ok\n", "build(GATED): ship"),
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["GATED"]);
    expect(await readPendingFromDisk(fx.repo)).toEqual([]);
  }, 20_000);

  it("skips an entry gated on a capability the chain does not assert", async () => {
    const entries: PendingEntry[] = [
      {
        ...makeEntry("GATED", ["src/gated.ts"]),
        gate: { kind: "requiresCapability", capability: "docker-host" },
      },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    // No `capabilities` declared — "docker-host" is not asserted.
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const preHead = await head(fx.repo);
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({}), // never invoked — GATED must not be selected
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(await head(fx.repo)).toBe(preHead);
    expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual(["GATED"]);
  });
});

describe("Dispatcher fanout — chain.ts forkResolver export gates selection", () => {
  it("a chain-module forkResolver overrides the constructor default per tick", async () => {
    const entries = [
      { ...makeEntry("ONLY", ["src/only.ts"]), dependsOnForks: ["open-fork"] },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    // The chain module supplies its own resolver — the stock-CLI adoption
    // path. It marks nothing resolved, so the only entry is fork-blocked.
    const loader = (): Promise<ChainModule> =>
      Promise.resolve({ chain, forkResolver: () => () => false });

    const dispatcher = new Dispatcher({
      chainLoader: loader,
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgent({}),
      log: silent,
    });

    const preHead = await head(fx.repo);
    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(await head(fx.repo)).toBe(preHead);
    expect(await readPendingFromDisk(fx.repo)).toEqual([
      expect.objectContaining({ tag: "ONLY" }),
    ]);
  }, 20_000);

  it("loadChainModule surfaces a chain.ts forkResolver export → governs selection, overrides the constructor default", async () => {
    // The closure-loader test above proves a ChainModule.forkResolver gates
    // selection, but bypasses loadChainModule — the §3 stock-CLI bridge.
    // This exercises the real extraction: a chain.ts that *exports*
    // forkResolver must have it picked up on disk, exactly as `agent` is.
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-forkresolver-"));
    try {
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      await writeFile(
        join(cfg, "chain.ts"),
        `export default () => ({ chain: { phases: [{ name: "build", description: "", ` +
          `promptPath: "prompt.md", concurrency: "fanout", ` +
          `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
          `humanOnly: [] },\n` +
          // Nothing resolved — the only entry rests on an open fork.
          `forkResolver: () => () => false });\n`,
        "utf8",
      );

      const entries = [
        {
          ...makeEntry("ONLY", ["src/only.ts"]),
          dependsOnForks: ["open-fork"],
        },
      ];
      await writePending(fx.repo, entries);
      new Baton(join(fx.repo, ".flume")).wake("build");

      // The agent must never run: a fork-blocked entry is filtered before
      // selection, so invocation here would mean the chain export was dropped.
      let invoked = false;
      const agent: Agent = {
        name: "never",
        async invoke() {
          invoked = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };

      const preHead = await head(fx.repo);
      const dispatcher = new Dispatcher({
        // No chainLoader → real diskChainLoader(cfg) runs loadChainModule.
        repoRoot: fx.repo,
        configDir: cfg,
        // Constructor default resolves everything; the chain export (which
        // resolves nothing) must override it, leaving the entry fork-blocked.
        forkResolver: () => () => true,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();

      expect(invoked).toBe(false);
      expect(outcome.result?.committed).toBe(false);
      expect(await head(fx.repo)).toBe(preHead);
      expect(await readPendingFromDisk(fx.repo)).toEqual([
        expect.objectContaining({ tag: "ONLY" }),
      ]);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("Dispatcher — per-phase agent resolution (§4)", () => {
  function recordingAgent(name: string, ran: string[]): Agent {
    return {
      name,
      async invoke() {
        ran.push(name);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
  }

  it("phase.agent runs that phase's tick; a silent sibling falls back to chainModule.agent over opts.agent", async () => {
    const ran: string[] = [];
    const phaseAgent = recordingAgent("phase-agent", ran);
    const chainAgent = recordingAgent("chain-agent", ran);
    const optsAgent = recordingAgent("opts-agent", ran);

    const withOwn = makePhase({ name: "plan", agent: phaseAgent });
    const silentPhase = makePhase({ name: "review" });
    const chain: Chain = { phases: [withOwn, silentPhase], humanOnly: [] };

    const loader = (): Promise<ChainModule> =>
      Promise.resolve({ chain, agent: chainAgent });

    const dispatcher = new Dispatcher({
      chainLoader: loader,
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: optsAgent,
      log: silent,
    });

    const baton = new Baton(join(fx.repo, ".flume"));

    // Innermost scope: the phase's own agent wins even with a chain-level
    // override present.
    baton.wake("plan");
    await dispatcher.tick();
    expect(ran).toEqual(["phase-agent"]);

    // Silent phase: the pre-§4 chain > constructor order is unchanged.
    baton.wake("review");
    await dispatcher.tick();
    expect(ran).toEqual(["phase-agent", "chain-agent"]);
  });

  it("opts.agent remains the default when phase and chain are both silent", async () => {
    const ran: string[] = [];
    const optsAgent = recordingAgent("opts-agent", ran);

    const chain: Chain = {
      phases: [makePhase({ name: "plan" })],
      humanOnly: [],
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: optsAgent,
      log: silent,
    });

    new Baton(join(fx.repo, ".flume")).wake("plan");
    await dispatcher.tick();
    expect(ran).toEqual(["opts-agent"]);
  });
});

describe("Dispatcher fanout — fork-blocked entry becomes pickable when the predicate flips", () => {
  it("skips the entry while its fork is open, then builds it once the fork resolves", async () => {
    const entries = [
      { ...makeEntry("GATED", ["src/gated.ts"]), dependsOnForks: ["the-fork"] },
    ];
    await writePending(fx.repo, entries);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      gated: (cwd) =>
        writeAndCommit(cwd, "src/gated.ts", "ok\n", "build(GATED): ship"),
    });

    // Mutable resolver state: the fork is unresolved on tick 1, resolved on 2.
    let resolved = false;
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      forkResolver: () => () => resolved,
    });

    // Tick 1: fork open → entry skipped, nothing ships, entry stays pending.
    const preHead = await head(fx.repo);
    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.result?.shippedTags).toEqual([]);
    expect(await head(fx.repo)).toBe(preHead);
    expect(await readPendingFromDisk(fx.repo)).toEqual([
      expect.objectContaining({ tag: "GATED" }),
    ]);

    // Predicate flips; re-wake the phase the idle handoff slept (() => []).
    resolved = true;
    baton.wake("build");

    // Tick 2: fork resolved → the same entry is now pickable and ships.
    const second = await dispatcher.tick();
    expect(second.result?.shippedTags).toEqual(["GATED"]);
    expect(await readPendingFromDisk(fx.repo)).toEqual([]);
  }, 20_000);
});

describe("Dispatcher fanout — no forkResolver supplied is identical to v0.2", () => {
  it("builds an entry that declares dependsOnForks because the default predicate resolves every slug", async () => {
    const entries = [
      { ...makeEntry("ONLY", ["src/only.ts"]), dependsOnForks: ["some-fork"] },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      only: (cwd) =>
        writeAndCommit(cwd, "src/only.ts", "ok\n", "build(ONLY): ship"),
    });

    // No forkResolver on the constructor and none on the chain module: the
    // governor's always-resolved default applies, so a declared dependsOnForks
    // never blocks — selection is identical to v0.2.
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["ONLY"]);
    expect(await readPendingFromDisk(fx.repo)).toEqual([]);
  }, 20_000);
});

describe("Dispatcher fanout — forkResolver invoked once per tick with the repo root", () => {
  it("calls the resolver once with repoRoot and lets its predicate govern selection", async () => {
    const entries = [
      { ...makeEntry("OPEN", ["src/open.ts"]), dependsOnForks: ["open-fork"] },
      { ...makeEntry("DONE", ["src/done.ts"]), dependsOnForks: ["done-fork"] },
    ];
    await writePending(fx.repo, entries);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      done: (cwd) =>
        writeAndCommit(cwd, "src/done.ts", "ok\n", "build(DONE): ship"),
      // No action for `open` — selecting it would throw.
    });

    const repoRootCalls: string[] = [];
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      forkResolver: (repoRoot) => {
        repoRootCalls.push(repoRoot);
        return (slug) => slug === "done-fork";
      },
    });

    const outcome = await dispatcher.tick();

    // Invoked exactly once for the tick, with the dispatcher's repo root.
    expect(repoRootCalls).toEqual([fx.repo]);
    // The injected predicate governs selection: only the resolved entry ships.
    expect(outcome.result?.shippedTags).toEqual(["DONE"]);
    expect(await readPendingFromDisk(fx.repo)).toEqual([
      expect.objectContaining({ tag: "OPEN" }),
    ]);
  }, 20_000);
});

// ---------- gate-failure feedback to the retrying tick (§5) ----------

describe("Dispatcher — gate-failure feedback to the retrying tick (§5)", () => {
  it("afterCommit gate-revert → next singleton tick's prompt carries gate name + full details + marker; first attempt absent", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const failing: Gate = {
      name: "boom-gate",
      when: "afterCommit",
      async run() {
        return {
          ok: false,
          message: "boom-msg",
          details: "boom-details-XYZ\nsecond line of details",
        };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [failing],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-singleton",
      async invoke(inv) {
        const n = prompts.length;
        prompts.push(inv.prompt);
        await writeAndCommit(
          inv.cwd,
          "src/o.ts",
          `attempt-${n}\n`,
          "plan: attempt",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick(); // attempt 1 → committed then reverted
    baton.wake("plan"); // re-wake (handoff () => [] slept it)
    await dispatcher.tick(); // attempt 2 → prompt carries the block

    expect(prompts.length).toBe(2);
    // First attempt: no false signal. (gate name/when also live in the
    // <harness> block, so assert on block-only substrings.)
    expect(prompts[0]).not.toContain("<prior-attempt>");
    expect(prompts[0]).not.toContain("boom-details-XYZ");
    // Retry: full block — marker, gate name, FULL details, when.
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain("Failing gate: boom-gate");
    expect(prompts[1]).toContain("Reverted at: afterCommit");
    expect(prompts[1]).toContain("boom-details-XYZ");
    expect(prompts[1]).toContain("second line of details");
    expect(prompts[1]).toContain("boom-msg");
  }, 20_000);

  it("afterMerge gate-revert → each reverted fanout entry's next prompt carries the block; first attempt absent", async () => {
    const entries = [
      makeEntry("WAVE-A", ["src/wa.ts"]),
      makeEntry("WAVE-B", ["src/wb.ts"]),
    ];
    await writePending(fx.repo, entries);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const failingMerge: Gate = {
      name: "merge-veto",
      when: "afterMerge",
      async run() {
        return {
          ok: false,
          message: "merge-msg",
          details: "merge-details-QQQ",
        };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failingMerge],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const promptsBySlug: Record<string, string[]> = {};
    const agent: Agent = {
      name: "recording-fanout",
      async invoke(inv) {
        const slug = basename(inv.cwd);
        (promptsBySlug[slug] ??= []).push(inv.prompt);
        const file = slug === "wave-a" ? "src/wa.ts" : "src/wb.ts";
        await writeAndCommit(inv.cwd, file, `${slug}\n`, `build(${slug})`);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    await dispatcher.tick(); // wave cherry-picked then reverted at afterMerge
    baton.wake("build"); // re-wake for the retry wave
    await dispatcher.tick(); // retry wave: each prompt carries the block

    for (const slug of ["wave-a", "wave-b"]) {
      const ps = promptsBySlug[slug] ?? [];
      expect(ps.length).toBe(2);
      // First attempt: silent (this path surfaced nothing pre-§5).
      expect(ps[0]).not.toContain("<prior-attempt>");
      expect(ps[0]).not.toContain("merge-details-QQQ");
      // Retry: afterMerge failure forwarded symmetrically.
      expect(ps[1]).toContain("<prior-attempt>");
      expect(ps[1]).toContain("Failing gate: merge-veto");
      expect(ps[1]).toContain("Reverted at: afterMerge");
      expect(ps[1]).toContain("merge-details-QQQ");
    }
  }, 30_000);

  it("clears the prior-attempt slot once a later attempt ships clean", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    let calls = 0;
    const flaky: Gate = {
      name: "flaky-gate",
      when: "afterCommit",
      async run() {
        calls++;
        return calls === 1
          ? { ok: false, message: "first fail", details: "DETAIL-ONCE" }
          : { ok: true, message: "ok now" };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [flaky],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-singleton",
      async invoke(inv) {
        const n = prompts.length;
        prompts.push(inv.prompt);
        await writeAndCommit(
          inv.cwd,
          "src/o.ts",
          `attempt-${n}\n`,
          "plan: attempt",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick(); // attempt 1 → reverted, slot written
    baton.wake("plan");
    await dispatcher.tick(); // attempt 2 → ships clean, slot cleared
    baton.wake("plan");
    await dispatcher.tick(); // attempt 3 → slot gone, no block

    expect(prompts.length).toBe(3);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain("DETAIL-ONCE");
    // Cleared on the clean ship → attempt 3 starts with no stale signal.
    expect(prompts[2]).not.toContain("<prior-attempt>");
    expect(
      existsSync(join(fx.repo, ".flume", "prior-attempts", "plan.json")),
    ).toBe(false);
  }, 20_000);
});

// ---------- no-commit outcome taxonomy (§6) ----------

// One test per causally-distinct no-commit mode. Each asserts (a) the
// distinct classification on `TickOutcome.noCommit` for the producing tick,
// and (b) that the next tick's rendered prompt carries the matching §5
// variant and *only* that variant (the three are mutually distinguishable,
// not one block with a label). Singleton path: a tick is one agent
// invocation, so "exactly one mode per no-commit tick" is exact and
// directly observable on the outcome. First attempt carries no
// <prior-attempt> — no false signal.

const GATE_REVERT_INTRO = "committed and was REVERTED by a gate";
const BAIL_INTRO = "exited deliberately WITHOUT committing";
const PREEMPT_INTRO = "cut short by a PLATFORM failure";
const RENDER_REFUSED_INTRO = "could not even be rendered";
const TIP_MOVED_INTRO = "was DISCARDED because the ref moved";

describe("Dispatcher — no-commit outcome taxonomy (§6)", () => {
  it("gate-revert: TickOutcome.noCommit==='gate-revert'; retry prompt carries only the gate-revert variant; first attempt empty", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const failing: Gate = {
      name: "revert-gate",
      when: "afterCommit",
      async run() {
        return {
          ok: false,
          message: "gate said no",
          details: "GATE-DETAIL-ZZZ",
        };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [failing],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        await writeAndCommit(inv.cwd, "src/o.ts", "x\n", "plan: attempt");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("gate-revert");

    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    // Distinct gate-revert variant, with the gate's full detail + when.
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain(GATE_REVERT_INTRO);
    expect(prompts[1]).toContain("Failing gate: revert-gate");
    expect(prompts[1]).toContain("Reverted at: afterCommit");
    expect(prompts[1]).toContain("GATE-DETAIL-ZZZ");
    // …and ONLY that variant — not the other two modes' phrasing.
    expect(prompts[1]).not.toContain(BAIL_INTRO);
    expect(prompts[1]).not.toContain(PREEMPT_INTRO);
  }, 20_000);

  it("voluntary-bail: TickOutcome.noCommit==='voluntary-bail'; retry prompt names the prior bail + its constraint; first attempt empty", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // No gates. The agent exits cleanly (exit 0) WITHOUT committing and
    // names the constraint it refused in its final message — exactly what
    // the build prompt instructs on a writablePaths/Rule-0 bail.
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const CONSTRAINT =
      "BAILED: entry.files names spec/RELEASE-v0.2.md, outside the build " +
      "phase writablePaths; not pivoting. Route as an open question.";

    const prompts: string[] = [];
    const agent: Agent = {
      name: "bailing-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        // Clean exit, no commit, constraint stated in the final message.
        return {
          exitCode: 0,
          stdout: `working…\n\n${CONSTRAINT}\n`,
          stderr: "",
        };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("voluntary-bail");
    // v0.8 §5: the verdict carries the same no-commit fact — no shipped
    // tags, no gates ran (the agent never committed), nothing to
    // cherry-pick/merge.
    expect(first.verdict?.committed).toBe(false);
    expect(first.verdict?.noCommit).toBe("voluntary-bail");
    expect(first.verdict?.shippedTags).toEqual([]);
    expect(first.verdict?.gateResults).toEqual([]);
    expect(first.verdict?.mergeOutcomes).toEqual([]);

    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    // Distinct voluntary-bail variant naming the refused constraint.
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain(BAIL_INTRO);
    expect(prompts[1]).toContain("Refused constraint");
    expect(prompts[1]).toContain(
      "spec/RELEASE-v0.2.md, outside the build phase writablePaths",
    );
    // …and ONLY that variant.
    expect(prompts[1]).not.toContain(GATE_REVERT_INTRO);
    expect(prompts[1]).not.toContain(PREEMPT_INTRO);
  }, 20_000);

  it("voluntary-bail under a stream-json agent: §5 block names the refused constraint legibly, free of NDJSON/cost noise; plain-text path is the test above", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // The dogfood chain runs the agent under
    // withTerminalRenderer(withSessionCapture(claudeCode({stream-json}))):
    // the decorators pass stdout through raw, so AgentResult.stdout is the
    // stream-json NDJSON transcript. Tailing it raw would forward
    // escaped-JSON assistant/result events + cost/usage metadata — the §6
    // noise this entry replaces with the refused constraint.
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const CONSTRAINT =
      "BAILED: entry.files names spec/RELEASE-v0.2.md and " +
      ".claude/rules/spec-plan-build.md, both outside the build phase " +
      "writablePaths. Not pivoting to a different path. Route as an open " +
      "question for a human.";

    // A realistic `claude -p --output-format stream-json --verbose`
    // transcript: system/init, an interim assistant turn, a tool_use +
    // tool_result pair, the final assistant text, and the terminal result
    // event carrying cost/usage. JSON.stringify so the test exercises the
    // genuine escaped-JSON shape, not a hand-written approximation.
    const ndjson =
      [
        {
          type: "system",
          subtype: "init",
          session_id: "s1",
          model: "claude",
          tools: ["Read", "Edit"],
        },
        {
          type: "assistant",
          message: {
            id: "m1",
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Inspecting the assigned entry's writable paths.",
              },
            ],
          },
        },
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "Read",
                input: { file_path: ".flume/chain.ts" },
              },
            ],
          },
        },
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "t1",
                content: "writablePaths: src/**, tests/**",
              },
            ],
          },
        },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: CONSTRAINT }] },
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 81234,
          duration_api_ms: 79000,
          num_turns: 6,
          result: CONSTRAINT,
          session_id: "s1",
          total_cost_usd: 0.4213,
          usage: {
            input_tokens: 12000,
            output_tokens: 800,
            cache_read_input_tokens: 250000,
            cache_creation_input_tokens: 1800,
          },
        },
      ]
        .map((o) => JSON.stringify(o))
        .join("\n") + "\n";

    const prompts: string[] = [];
    const agent: Agent = {
      name: "bailing-stream-json-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        // Clean exit, no commit; the constraint is the final message,
        // delivered only inside the stream-json transcript.
        return { exitCode: 0, stdout: ndjson, stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("voluntary-bail");

    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");

    const retry = prompts[1]!;
    // The constraint is forwarded as clean prose, in the voluntary-bail
    // variant only.
    expect(retry).toContain("<prior-attempt>");
    expect(retry).toContain(BAIL_INTRO);
    expect(retry).toContain("Refused constraint");
    expect(retry).toContain(
      "spec/RELEASE-v0.2.md and .claude/rules/spec-plan-build.md",
    );
    expect(retry).not.toContain(GATE_REVERT_INTRO);
    expect(retry).not.toContain(PREEMPT_INTRO);

    // …and the raw NDJSON / cost-usage noise the pre-fix tail forwarded is
    // gone: no event envelopes, no escaped JSON, no cost/usage metadata.
    expect(retry).not.toContain('"type":"result"');
    expect(retry).not.toContain('"type":"assistant"');
    expect(retry).not.toContain('"type":"system"');
    expect(retry).not.toContain("tool_use");
    expect(retry).not.toContain("total_cost_usd");
    expect(retry).not.toContain("cache_read_input_tokens");
    expect(retry).not.toContain("duration_ms");
    expect(retry).not.toContain('\\"text\\"');
  }, 20_000);

  it("voluntary-bail under a stream-json agent with no result/assistant event: falls back to the bounded raw transcript, never an empty constraint", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // A stdout that parses as stream-json (every line has a `type` field, so
    // sawStreamJson flips true) but never emits a `result` or `assistant`
    // event — e.g. the process was cut off after the `system`/`init` line.
    // DISPATCHER-FINALAGENTMESSAGE-STREAMJSON-SILENT-EMPTY: pre-fix,
    // finalAgentMessage tailBound'd the empty string here, and the retry
    // prompt lost the bail entirely.
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const ndjson =
      [
        {
          type: "system",
          subtype: "init",
          session_id: "s1",
          model: "claude",
          tools: ["Read", "Edit"],
        },
      ]
        .map((o) => JSON.stringify(o))
        .join("\n") + "\n";

    const prompts: string[] = [];
    const agent: Agent = {
      name: "bailing-stream-json-no-text-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        return { exitCode: 0, stdout: ndjson, stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("voluntary-bail");

    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(2);
    const retry = prompts[1]!;
    expect(retry).toContain("<prior-attempt>");
    expect(retry).toContain(BAIL_INTRO);
    expect(retry).toContain("Refused constraint");
    // The raw transcript tail reached the retry prompt…
    expect(retry).toContain('"type":"system"');
    expect(retry).toContain("s1");
    // …instead of the silent-empty placeholder the pre-fix tree produced.
    expect(retry).not.toContain(
      "agent exited cleanly without committing and produced no final message",
    );
  }, 20_000);

  it("platform-preempt: TickOutcome.noCommit==='platform-preempt'; retry prompt marks it not-a-defect with the failure class; first attempt empty", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // No gates. The agent process fails for non-work reasons — a non-zero
    // exit (137 = SIGKILL / OOM / dispatcher-killed) with no commit.
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "preempted-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        return { exitCode: 137, stdout: "", stderr: "Killed" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("platform-preempt");

    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    // Distinct platform-preempt variant: explicitly NOT a defect, with the
    // non-work failure class forwarded.
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain(PREEMPT_INTRO);
    expect(prompts[1]).toContain("NOT a");
    expect(prompts[1]).toContain("Failure class");
    expect(prompts[1]).toContain("exited with code 137");
    // …and ONLY that variant.
    expect(prompts[1]).not.toContain(GATE_REVERT_INTRO);
    expect(prompts[1]).not.toContain(BAIL_INTRO);
  }, 20_000);

  it("render-refused (RELEASE-v0.10 §3): an unresolved inline-exec span aborts the render — the agent is never invoked, and the mode is distinguishable from voluntary-bail", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const promptPath = join(fx.configDir, "prompt.md");
    await writeFile(
      promptPath,
      "digest: !`echo boom-detail 1>&2; exit 3`\n",
      "utf8",
    );

    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "must-not-run-while-render-fails",
      async invoke(inv) {
        prompts.push(inv.prompt);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();

    // No agent invocation at all — the render never got far enough to hand
    // the agent a prompt.
    expect(prompts.length).toBe(0);
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("render-refused");
    expect(first.noCommit).not.toBe("voluntary-bail");
    expect(first.verdict?.committed).toBe(false);
    expect(first.verdict?.noCommit).toBe("render-refused");
    expect(first.verdict?.gateResults).toEqual([]);
    expect(first.verdict?.shippedTags).toEqual([]);
    expect(first.verdict?.mergeOutcomes).toEqual([]);

    // Fix the span so the second tick's render succeeds — only then can the
    // agent actually be invoked, and its prompt inspected for the retry's
    // <prior-attempt> block.
    await writeFile(promptPath, "digest: fixed\n", "utf8");
    baton.wake("plan");
    await dispatcher.tick();

    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain("<prior-attempt>");
    expect(prompts[0]).toContain(RENDER_REFUSED_INTRO);
    expect(prompts[0]).toContain("echo boom-detail 1>&2; exit 3");
    expect(prompts[0]).toContain("boom-detail");
    // …and ONLY that variant.
    expect(prompts[0]).not.toContain(GATE_REVERT_INTRO);
    expect(prompts[0]).not.toContain(BAIL_INTRO);
    expect(prompts[0]).not.toContain(PREEMPT_INTRO);
  }, 20_000);
});

// ---------- fanout wave-level noCommit precedence (§6, mixed causes) ----------

// Dispatcher.ts:1836-1853: when a fanout wave ships nothing, the single
// wave-level `noCommit` label is picked from the set of per-entry causes by
// precedence gate-revert > render-refused > platform-preempt >
// voluntary-bail. Every other test above drives one mode per wave in
// isolation, so a swapped or dropped precedence branch is invisible to the
// suite (engineering.md "A green verdict is proven non-vacuous"). These
// tests build waves whose entries fail via ≥2 distinct causes at once and
// pin the label at each boundary of the chain.
//
// `CMD` drives the shared prompt's inline-exec span per entry (rendered
// before the agent is invoked): every tag except RENDER-FOUR resolves to a
// no-op; RENDER-FOUR resolves to a command that fails, aborting only that
// entry's render.
function mixedCausePromptArgs(ctx: TickContext): Record<string, string> {
  return {
    CMD: ctx.assignedEntry?.tag === "RENDER-FOUR" ? "echo boom-detail 1>&2; exit 3" : "exit 0",
  };
}

// A fanout agent whose behavior is keyed by slug, producing gate-revert
// (commits, then the always-failing gate reverts it), platform-preempt
// (non-zero exit), and voluntary-bail (clean exit, no commit). RENDER-FOUR
// never reaches the agent — its render aborts first — so no case is
// registered for it; an accidental invocation throws.
const mixedCauseAgent: Agent = {
  name: "mixed-cause-fanout",
  async invoke(inv) {
    const slug = basename(inv.cwd);
    switch (slug) {
      case "gate-one":
        await writeAndCommit(inv.cwd, "src/a.ts", "x\n", "build(GATE-ONE): attempt");
        return { exitCode: 0, stdout: "", stderr: "" };
      case "preempt-two":
        return { exitCode: 137, stdout: "", stderr: "Killed" };
      case "bail-three":
        return { exitCode: 0, stdout: "bailing, nothing to commit\n", stderr: "" };
      default:
        throw new Error(`mixedCauseAgent: unexpected invocation for slug '${slug}'`);
    }
  },
};

const alwaysRevert: Gate = {
  name: "always-revert",
  when: "afterCommit",
  async run() {
    return { ok: false, message: "gate said no", details: "MIXED-CAUSE-REVERT" };
  },
};

describe("Dispatcher fanout — wave-level noCommit precedence across mixed per-entry causes (DISPATCHER-WAVE-NOCOMMIT-PRECEDENCE-TEST)", () => {
  it("gate-revert + render-refused + platform-preempt + voluntary-bail in one wave → wave-level noCommit is gate-revert (top precedence)", async () => {
    await writePending(fx.repo, [
      makeEntry("GATE-ONE", ["src/a.ts"]),
      makeEntry("RENDER-FOUR", ["src/d.ts"]),
      makeEntry("PREEMPT-TWO", ["src/b.ts"]),
      makeEntry("BAIL-THREE", ["src/c.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    await writeFile(join(fx.configDir, "prompt.md"), "digest: !`{{CMD}}`\n", "utf8");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      gates: [alwaysRevert],
      promptArgs: mixedCausePromptArgs,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const warnings: string[] = [];
    const log: Logger = { info: () => {}, warn: (l) => warnings.push(l), error: () => {} };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: mixedCauseAgent,
      log,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    // Non-vacuity: all four distinct causes actually fired this wave, not
    // just the winning one — otherwise "gate-revert wins" would be true
    // vacuously of a wave that only ever produced gate-revert.
    expect(warnings.some((w) => w.includes("GATE-ONE") && w.includes("commit reverted"))).toBe(true);
    expect(warnings.some((w) => w.includes("RENDER-FOUR") && w.includes("render-refused"))).toBe(true);
    expect(warnings.some((w) => w.includes("PREEMPT-TWO") && w.includes("platform-preempt"))).toBe(true);
    expect(warnings.some((w) => w.includes("BAIL-THREE") && w.includes("voluntary-bail"))).toBe(true);

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(outcome.noCommit).toBe("gate-revert");
    expect(outcome.verdict?.noCommit).toBe("gate-revert");
    expect(await readPendingFromDisk(fx.repo)).toHaveLength(4);
  }, 20_000);

  it("render-refused + platform-preempt + voluntary-bail, no gate-revert → wave-level noCommit is render-refused", async () => {
    await writePending(fx.repo, [
      makeEntry("RENDER-FOUR", ["src/d.ts"]),
      makeEntry("PREEMPT-TWO", ["src/b.ts"]),
      makeEntry("BAIL-THREE", ["src/c.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    await writeFile(join(fx.configDir, "prompt.md"), "digest: !`{{CMD}}`\n", "utf8");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      promptArgs: mixedCausePromptArgs,
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const warnings: string[] = [];
    const log: Logger = { info: () => {}, warn: (l) => warnings.push(l), error: () => {} };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: mixedCauseAgent,
      log,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(warnings.some((w) => w.includes("RENDER-FOUR") && w.includes("render-refused"))).toBe(true);
    expect(warnings.some((w) => w.includes("PREEMPT-TWO") && w.includes("platform-preempt"))).toBe(true);
    expect(warnings.some((w) => w.includes("BAIL-THREE") && w.includes("voluntary-bail"))).toBe(true);

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.noCommit).toBe("render-refused");
    expect(outcome.verdict?.noCommit).toBe("render-refused");
    expect(await readPendingFromDisk(fx.repo)).toHaveLength(3);
  }, 20_000);

  it("platform-preempt + voluntary-bail, no gate-revert/render-refused → wave-level noCommit is platform-preempt", async () => {
    await writePending(fx.repo, [
      makeEntry("PREEMPT-TWO", ["src/b.ts"]),
      makeEntry("BAIL-THREE", ["src/c.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const warnings: string[] = [];
    const log: Logger = { info: () => {}, warn: (l) => warnings.push(l), error: () => {} };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: mixedCauseAgent,
      log,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(warnings.some((w) => w.includes("PREEMPT-TWO") && w.includes("platform-preempt"))).toBe(true);
    expect(warnings.some((w) => w.includes("BAIL-THREE") && w.includes("voluntary-bail"))).toBe(true);

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.noCommit).toBe("platform-preempt");
    expect(outcome.verdict?.noCommit).toBe("platform-preempt");
    expect(await readPendingFromDisk(fx.repo)).toHaveLength(2);
  }, 20_000);
});

describe("Dispatcher — tip verify: commit only onto the tick's starting tip (RELEASE-v0.11 §5)", () => {
  it("singleton: an agent invocation that makes two commits has both undone by the tip-moved revert, not just the newest (LOOP-TIPMOVED-MULTICOMMIT-TICK)", async () => {
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let interloperSha = "";
    const agent = singleAgent(async (cwd) => {
      // Two commits in one invocation: the dispatcher only ever compares
      // `postHead`'s own parent against the tip it recorded, so the first of
      // the two — whether it's the agent's own or an operator's concurrent
      // commit landing mid-tick — reads identically as "something sits
      // between the recorded tip and postHead". Either way, nothing may be
      // left on the tip un-gated.
      await writeAndCommit(
        cwd,
        "src/interloper.ts",
        "external\n",
        "external: concurrent commit",
      );
      interloperSha = await head(cwd);
      await writeAndCommit(cwd, "src/plan-output.ts", "agent-work\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.commitSha).toBeUndefined();
    expect(outcome.result?.gateResults).toEqual([]);
    expect(outcome.noCommit).toBeUndefined();
    expect(outcome.tipMoved).toBe(true);
    expect(outcome.verdict?.committed).toBe(false);
    expect(outcome.verdict?.noCommit).toBeUndefined();
    expect(outcome.verdict?.tipMoved).toBe(true);
    expect(outcome.summary).toContain("tip-moved");

    // Both commits are undone — the tip lands back on exactly what the tick
    // recorded at start, not on the first of the tick's own two commits.
    expect(await head(fx.repo)).toBe(preHead);
    expect(await head(fx.repo)).not.toBe(interloperSha);

    // Agent output stays on disk, uncommitted — a soft reset, not the
    // gate-revert path's hard reset — for the *whole* span, not only the
    // newest commit.
    expect(existsSync(join(fx.repo, "src", "interloper.ts"))).toBe(true);
    expect(existsSync(join(fx.repo, "src", "plan-output.ts"))).toBe(true);
    expect(await readFile(join(fx.repo, "src", "plan-output.ts"), "utf8")).toBe(
      "agent-work\n",
    );
    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: fx.repo,
    });
    expect(status).toContain("plan-output.ts");
    expect(status).toContain("interloper.ts");
  }, 20_000);

  it("singleton: a single-commit tick built on a stale base is soft-reverted by exactly one commit — unchanged from before multi-commit accounting", async () => {
    // A commit sits ahead of the base the agent's own commit lands on (a
    // worktree that never advanced past that base, or a rewind) — the
    // recorded tip's own *parent* is where the agent's single commit
    // actually landed. Distance from the recorded tip to the agent's commit
    // is exactly one either way: only that one commit is undone.
    const staleBase = await head(fx.repo);
    await writeAndCommit(fx.repo, "src/trunk-advance.ts", "advance\n", "plan: advance");
    const preHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await exec("git", ["reset", "--hard", staleBase], { cwd });
      await writeAndCommit(cwd, "src/plan-output.ts", "agent-work\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.tipMoved).toBe(true);
    expect(outcome.summary).toContain("tip-moved");

    // Exactly one commit undone: the tip lands back on the stale base the
    // agent's single commit actually landed on, not further back than that.
    expect(await head(fx.repo)).toBe(staleBase);
    expect(await head(fx.repo)).not.toBe(preHead);

    expect(existsSync(join(fx.repo, "src", "plan-output.ts"))).toBe(true);
    expect(await readFile(join(fx.repo, "src", "plan-output.ts"), "utf8")).toBe(
      "agent-work\n",
    );
    const { stdout: status } = await exec("git", ["status", "--porcelain"], {
      cwd: fx.repo,
    });
    expect(status).toContain("plan-output.ts");
  }, 20_000);

  it("singleton: an unmoved tip commits exactly as before — no tip-moved fact", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/plan-output.ts", "ok\n", "plan: derive");
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.tipMoved).toBeUndefined();
    expect(outcome.verdict?.tipMoved).toBeUndefined();
  });

  it("singleton: the retry's prompt carries the tip-moved prior-attempt block, and only that variant — the retry against the new tip then commits clean", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    let firstAttempt = true;
    const agent: Agent = {
      name: "recording-singleton",
      async invoke(inv) {
        prompts.push(inv.prompt);
        if (firstAttempt) {
          firstAttempt = false;
          await writeAndCommit(
            inv.cwd,
            "src/interloper.ts",
            "external\n",
            "external: concurrent commit",
          );
        }
        await writeAndCommit(inv.cwd, "src/plan-output.ts", "x\n", "plan: attempt");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const first = await dispatcher.tick();
    expect(first.tipMoved).toBe(true);

    baton.wake("plan");
    const second = await dispatcher.tick();
    expect(second.result?.committed).toBe(true);
    expect(second.tipMoved).toBeUndefined();

    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("<prior-attempt>");
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain(TIP_MOVED_INTRO);
    // …and ONLY that variant.
    expect(prompts[1]).not.toContain(GATE_REVERT_INTRO);
    expect(prompts[1]).not.toContain(BAIL_INTRO);
    expect(prompts[1]).not.toContain(PREEMPT_INTRO);
  }, 20_000);

  it("fanout: an entry's own worktree commit whose parent isn't the tip it was provisioned from is soft-reverted — tip-moved, never reaches cherry-pick, entry stays pending", async () => {
    await writePending(fx.repo, [makeEntry("TEST-A", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "test-a": async (cwd) => {
        // Something rewrote this entry's own (private, per-tick) worktree
        // branch out from under the agent mid-run — the same race, scoped
        // to the worktree's own tip rather than trunk's.
        await writeAndCommit(
          cwd,
          "src/interloper.ts",
          "external\n",
          "external: concurrent commit",
        );
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): ship");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(outcome.tipMoved).toBe(true);
    expect(outcome.verdict?.tipMoved).toBe(true);
    expect(outcome.verdict?.noCommit).toBeUndefined();
    expect(outcome.verdict?.mergeOutcomes).toEqual([]);

    // Entry stays pending, byte-identical — nothing shipped or cherry-picked.
    expect(await readPendingFromDisk(fx.repo)).toEqual([
      makeEntry("TEST-A", ["src/a.ts"]),
    ]);
  }, 20_000);

  it("fanout: an entry's worktree commit is ready but trunk moved during the wave — refuses the cherry-pick, entry stays pending, recorded as tip-moved", async () => {
    await writePending(fx.repo, [makeEntry("TEST-A", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const phase = makePhase({ name: "build", concurrency: "fanout", gates: [] });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "test-a": async (cwd) => {
        // A concurrent actor commits directly to trunk while this entry's
        // agent is still running in its own worktree — the wave only
        // discovers it once cherry-picking starts, after every agent this
        // wave has already finished.
        await writeAndCommit(
          fx.repo,
          "src/interloper.ts",
          "external\n",
          "external: concurrent commit",
        );
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): ship");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.shippedTags).toEqual([]);
    expect(outcome.tipMoved).toBe(true);
    expect(outcome.verdict?.tipMoved).toBe(true);
    expect(outcome.verdict?.mergeOutcomes).toEqual([
      { tag: "TEST-A", outcome: "tip-moved" },
    ]);

    // Entry stays pending; the interloper's own commit stands untouched.
    expect(await readPendingFromDisk(fx.repo)).toEqual([
      makeEntry("TEST-A", ["src/a.ts"]),
    ]);
    expect(await readFile(join(fx.repo, "src/interloper.ts"), "utf8")).toBe(
      "external\n",
    );
    expect(existsSync(join(fx.repo, "src/a.ts"))).toBe(false);
  }, 20_000);

  it("fanout: trunk moved before the wave's own pending-ledger commit (no cherry-pick this wave) — refuses it, pending.json left untouched", async () => {
    await writePending(fx.repo, [makeEntry("TEST-A", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const failingGate: Gate = {
      name: "always-fail",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "boom" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failingGate],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "test-a": async (cwd) => {
        // The entry's own afterCommit gate always fails, so this wave's
        // only trunk-touching action is the trailing footprint-only
        // pending-ledger commit — exactly where a concurrent actor's commit,
        // landed here while the agent still runs in its own worktree, would
        // otherwise be silently overwritten.
        await writeAndCommit(
          fx.repo,
          "src/interloper.ts",
          "external\n",
          "external: concurrent commit",
        );
        await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(TEST-A): attempt");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
      maxParallel: 4,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.tipMoved).toBe(true);
    expect(outcome.verdict?.tipMoved).toBe(true);
    // The entry's own afterCommit gate-revert is a real, independent fact —
    // tip-moved rides alongside it, a sibling, not a replacement.
    expect(outcome.noCommit).toBe("gate-revert");

    // pending.json untouched: no footprint recorded, entry unchanged.
    expect(await readPendingFromDisk(fx.repo)).toEqual([
      makeEntry("TEST-A", ["src/a.ts"]),
    ]);
  }, 20_000);
});

describe("Dispatcher tip-moved — singleton/fanout agreement (DISPATCHER-TIPMOVED-CHECK-UNSHARED)", () => {
  it("both callsites persist same-shaped §5 records and emit a same-shaped log line for equivalent input, driven through the one shared method", async () => {
    // ---- singleton — same race as the tip-verify describe's first test:
    // an interloper commit lands on trunk after preHead is recorded, then
    // the agent's own commit stacks on top of it.
    const singletonPreHead = await head(fx.repo);
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const singletonPhase = makePhase({ name: "plan", concurrency: "singleton" });
    const singletonChain: Chain = { phases: [singletonPhase], humanOnly: [] };
    let singletonInterloperSha = "";
    const singletonAgent = singleAgent(async (cwd) => {
      await writeAndCommit(
        cwd,
        "src/interloper.ts",
        "external\n",
        "external: concurrent commit",
      );
      singletonInterloperSha = await head(cwd);
      await writeAndCommit(cwd, "src/plan-output.ts", "agent-work\n", "plan: derive");
    });
    const singletonWarnings: string[] = [];
    const singletonLog: Logger = {
      info: () => {},
      warn: (l) => singletonWarnings.push(l),
      error: () => {},
    };
    const singletonDispatcher = new Dispatcher({
      chainLoader: staticLoader(singletonChain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singletonAgent,
      log: singletonLog,
    });
    const singletonOutcome = await singletonDispatcher.tick();

    expect(singletonOutcome.tipMoved).toBe(true);
    const singletonRecord = await readFile(
      join(fx.repo, ".flume", "prior-attempts", "plan.json"),
      "utf8",
    );

    // ---- fanout — same race, scoped to the entry's own worktree, as the
    // tip-verify describe's fanout test. A fresh fixture: the singleton
    // portion above leaves its repo's working tree dirty (the soft-reset
    // agent output survives uncommitted, §5 "agent output stays on disk"),
    // and fanout worktree provisioning wants a clean starting repo.
    const fx2 = await makeFixture();
    try {
      await writePending(fx2.repo, [makeEntry("FANOUT-TWIN", ["src/a.ts"])]);
      new Baton(join(fx2.repo, ".flume")).wake("build");
      const fanoutPhase = makePhase({
        name: "build",
        concurrency: "fanout",
        gates: [],
      });
      const fanoutChain: Chain = { phases: [fanoutPhase], humanOnly: [] };
      const fanoutPreHead = await head(fx2.repo);
      let fanoutInterloperSha = "";
      const fanoutAgentInst = fanoutAgent({
        "fanout-twin": async (cwd) => {
          await writeAndCommit(
            cwd,
            "src/interloper.ts",
            "external\n",
            "external: concurrent commit",
          );
          fanoutInterloperSha = await head(cwd);
          await writeAndCommit(cwd, "src/a.ts", "from-A\n", "build(FANOUT-TWIN): ship");
        },
      });
      const fanoutWarnings: string[] = [];
      const fanoutLog: Logger = {
        info: () => {},
        warn: (l) => fanoutWarnings.push(l),
        error: () => {},
      };
      const fanoutDispatcher = new Dispatcher({
        chainLoader: staticLoader(fanoutChain),
        repoRoot: fx2.repo,
        configDir: fx2.configDir,
        agent: fanoutAgentInst,
        log: fanoutLog,
        maxParallel: 4,
      });
      const fanoutOutcome = await fanoutDispatcher.tick();

      expect(fanoutOutcome.tipMoved).toBe(true);
      const fanoutRecord = await readFile(
        join(fx2.repo, ".flume", "prior-attempts", "fanout-twin.json"),
        "utf8",
      );

      // §5 record shape (mode + field names + JSON formatting) is
      // byte-identical for equivalent input — a one-sided edit to either
      // callsite's persisted record breaks this pin once the two sides'
      // real, necessarily-distinct SHAs are normalized out.
      const normalize = (raw: string, expectedTip: string, observedTip: string) =>
        raw
          .split(expectedTip)
          .join("<EXPECTED>")
          .split(observedTip)
          .join("<OBSERVED>");
      expect(normalize(fanoutRecord, fanoutPreHead, fanoutInterloperSha)).toBe(
        normalize(singletonRecord, singletonPreHead, singletonInterloperSha),
      );
      expect(JSON.parse(singletonRecord).mode).toBe("tip-moved");
      expect(JSON.parse(fanoutRecord).mode).toBe("tip-moved");

      // Both callsites log through the same template —
      // "[flume] <label>: tip moved (no commit) — expected <sha>, found <sha>"
      // — with only the label (phase name vs. entry tag) and the shas
      // (necessarily distinct per side) differing.
      expect(singletonWarnings).toHaveLength(1);
      expect(fanoutWarnings).toHaveLength(1);
      const shape =
        /^\[flume\] (.+): tip moved \(no commit\) — expected (\S+), found (\S+)$/;
      const singletonMatch = singletonWarnings[0]!.match(shape);
      const fanoutMatch = fanoutWarnings[0]!.match(shape);
      expect(singletonMatch).not.toBeNull();
      expect(fanoutMatch).not.toBeNull();
      expect(singletonMatch![1]).toBe("plan");
      expect(fanoutMatch![1]).toBe("FANOUT-TWIN");
      expect(singletonMatch![2]).toBe(singletonPreHead);
      expect(singletonMatch![3]).toBe(singletonInterloperSha);
      expect(fanoutMatch![2]).toBe(fanoutPreHead);
      expect(fanoutMatch![3]).toBe(fanoutInterloperSha);
    } finally {
      await fx2.cleanup();
    }
  }, 20_000);
});

describe("superviseLoop — tip-moved counts as errored (RELEASE-v0.11 §5)", () => {
  it("a tip-moved tick is distinguishable in the run's errored-tick classification, even though it is never a NoCommitMode", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    const verdictPath = join(fx.repo, ".flume", "tick-verdict.json");

    const runTick = async (): Promise<{ exitCode: number | null }> => {
      await writeFile(
        verdictPath,
        JSON.stringify(
          verdictFixture({
            committed: false,
            tipMoved: true,
            summary: "build: no commit (tip-moved) → hibernate",
          }),
        ),
        "utf8",
      );
      baton.sleep("build");
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 5,
      runTick,
      log: silent,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(1);
    expect(res.erroredTicks).toHaveLength(1);
    expect(res.erroredTicks[0]).toContain("tip-moved");
  });
});

/**
 * v0.8 §5 — `writeTickVerdict`/`clearTickVerdict`/`readTickVerdicts` are the
 * primitives the CLI's `tick` command calls around `dispatcher.tick()`
 * (never `Dispatcher.tick()` itself — a plain unit test constructing a
 * `Dispatcher` directly, as every test above does, must not gain an
 * untracked `<flumeDir>/tick-verdict.json` side effect underfoot;
 * `superviseLoop`'s own accumulation from this same artifact is proved
 * below, in the `superviseLoop` suite, via a stub `runTick` that writes it
 * directly, the way a real `flume tick` child process would). This suite
 * proves the primitives' own round-trip, clear behavior, and bounded
 * history — and that the shape carries no interpretation field (no
 * `errored`; §5 derives that at the read site instead).
 */
describe("writeTickVerdict / clearTickVerdict / readTickVerdicts — the tick-verdict artifact (v0.8 §5)", () => {
  const latestPath = (): string => join(fx.repo, ".flume", "tick-verdict.json");
  const historyPath = (): string =>
    join(fx.repo, ".flume", "tick-verdicts.jsonl");

  it("writes a record readable back verbatim, appends it to the bounded history log", async () => {
    const v = verdictFixture({ shippedTags: ["TEST-A"] });
    await writeTickVerdict(join(fx.repo, ".flume"), v);

    const onDisk = JSON.parse(await readFile(latestPath(), "utf8"));
    expect(onDisk).toEqual(v);
    expect(existsSync(historyPath())).toBe(true);
    expect(await readTickVerdicts(join(fx.repo, ".flume"))).toEqual([v]);
  });

  it("carries only fact fields — no `errored`/interpretation field on the shape", async () => {
    const v = verdictFixture({
      committed: false,
      noCommit: "gate-revert",
      gateResults: [
        {
          gate: "writable-paths",
          ok: false,
          message: "commit touched 1 path(s) outside writablePaths",
          details: "  - src/Phase.ts (outside phase writablePaths)",
        },
      ],
    });
    await writeTickVerdict(join(fx.repo, ".flume"), v);
    const onDisk = JSON.parse(await readFile(latestPath(), "utf8"));

    expect(Object.keys(onDisk).sort()).toEqual(
      [
        "phaseName",
        "tags",
        "committed",
        "noCommit",
        "gateResults",
        "shippedTags",
        "mergeOutcomes",
        "summary",
      ].sort(),
    );
    // The violating path is a fact in the gate's own captured `details`, not
    // a re-derived summary — a chain reading history sees it verbatim.
    expect(onDisk.gateResults[0].details).toContain("src/Phase.ts");
  });

  it("clearTickVerdict removes the latest record without touching history; no-ops when absent", async () => {
    await writeTickVerdict(join(fx.repo, ".flume"), verdictFixture());
    expect(existsSync(latestPath())).toBe(true);

    await clearTickVerdict(join(fx.repo, ".flume"));
    expect(existsSync(latestPath())).toBe(false);
    expect(await readTickVerdicts(join(fx.repo, ".flume"))).toHaveLength(1);

    // No pre-existing file (fresh flumeDir, never ticked) — still a no-op.
    await expect(
      clearTickVerdict(join(fx.repo, ".flume", "never-created")),
    ).resolves.not.toThrow();
  });

  it("readTickVerdicts serves the last N, oldest first, for a chain to render recent history", async () => {
    for (let i = 0; i < 5; i++) {
      await writeTickVerdict(
        join(fx.repo, ".flume"),
        verdictFixture({ summary: `tick ${i}` }),
      );
    }
    const last2 = await readTickVerdicts(join(fx.repo, ".flume"), 2);
    expect(last2.map((v) => v.summary)).toEqual(["tick 3", "tick 4"]);
  });
});

// ---------- plan-tick prose durability (§8) ----------

// Plan is a singleton phase. When its pending.json fails the chain-local
// pendingParseGate, the whole commit is `git reset --hard`-ed away — the
// state.md / open-questions.md prose in that same commit dies with it,
// recoverable pre-§8 only by a human reading session logs. §8 mandates the
// findings stay recoverable without session logs. This asserts the chosen
// mechanism: a verbatim, durable, reset-surviving on-disk snapshot.

describe("Dispatcher — plan-tick prose durability (§8)", () => {
  it("gate-reverted plan tick: state.md/open-questions.md findings recoverable on disk w/o session logs; cleared on a later clean ship", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    // Stands in for the chain-local pendingParseGate: an afterCommit gate
    // that vetoes a schema-invalid pending.json on the first attempt only.
    // The §8 property is gate-agnostic — the dispatcher snapshots whatever
    // the reverted commit touched, with no "which file is prose" knowledge.
    let calls = 0;
    const pendingParses: Gate = {
      name: "pending.json parses",
      when: "afterCommit",
      async run() {
        calls++;
        return calls === 1
          ? {
              ok: false,
              message: "pending.json has 1 schema violation",
              details: "[0] gate.kind: invalid discriminant",
            }
          : { ok: true, message: "pending.json parsed (0 entries)" };
      },
    };
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [pendingParses],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const FINDING_OQ =
      "OPEN QUESTION: CLI-SEARCH-WALK — should `flume render` walk skill " +
      "paths? Needs a human call before plan can derive an entry.";
    const FINDING_STATE =
      "Plan continues: yes\nAudited bd5e6f4 §7b; filed the skill-path finding.";

    let attempt = 0;
    const agent: Agent = {
      name: "plan-prose-singleton",
      async invoke(inv) {
        const n = attempt++;
        const oq = join(inv.cwd, ".flume", "plan", "open-questions.md");
        const st = join(inv.cwd, ".flume", "plan", "state.md");
        const pj = join(inv.cwd, ".flume", "plan", "pending.json");
        await mkdir(dirname(oq), { recursive: true });
        await writeFile(oq, `# Open Questions\n\n${FINDING_OQ}\n`);
        await writeFile(st, `${FINDING_STATE}\n`);
        // Attempt 0's pending.json is schema-invalid (gate vetoes it);
        // attempt 1's is clean. Commit scoped to .flume/plan, exactly as
        // plan does — the harness writes the snapshot to gitignored
        // .flume/prior-attempts/, never into the agent's commit.
        await writeFile(pj, n === 0 ? "[ broken json " : "[]\n");
        await exec("git", ["add", "--", ".flume/plan"], { cwd: inv.cwd });
        await exec("git", ["commit", "-q", "-m", `plan: attempt ${n}`], {
          cwd: inv.cwd,
        });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const preHead = await head(fx.repo);
    const first = await dispatcher.tick(); // attempt 0 → committed, reverted

    // The broken pending.json never ships: commit reverted to preHead.
    expect(first.result?.committed).toBe(false);
    expect(first.noCommit).toBe("gate-revert");
    expect(await head(fx.repo)).toBe(preHead);
    // The prose is GONE from the worktree (git reset --hard) — proving the
    // loss §8 closes is real, and recovery cannot come from the worktree.
    expect(
      existsSync(join(fx.repo, ".flume", "plan", "open-questions.md")),
    ).toBe(false);

    // §8 acceptance: findings recoverable WITHOUT session logs — verbatim
    // on disk in the durable, reset-surviving snapshot mirror.
    const snapDir = join(fx.repo, ".flume", "prior-attempts", "plan.reverted");
    const recoveredOQ = await readFile(
      join(snapDir, ".flume", "plan", "open-questions.md"),
      "utf8",
    );
    const recoveredState = await readFile(
      join(snapDir, ".flume", "plan", "state.md"),
      "utf8",
    );
    expect(recoveredOQ).toContain(FINDING_OQ);
    expect(recoveredState).toContain(FINDING_STATE);

    // A later clean ship clears the recovery artifact — no stale prose
    // outliving the entry it belonged to (mirrors the §5 slot invariant).
    baton.wake("plan");
    const second = await dispatcher.tick(); // attempt 1 → ships clean
    expect(second.result?.committed).toBe(true);
    expect(existsSync(snapDir)).toBe(false);
  }, 20_000);
});

describe("Dispatcher fanout — render-refused: an unresolved inline-exec span aborts one entry's render (RELEASE-v0.10 §3)", () => {
  it("no agent invocation for the affected entry; the wave's TickOutcome.noCommit is 'render-refused', the entry stays pending", async () => {
    await writePending(fx.repo, [makeEntry("RENDER-BOOM", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    await writeFile(join(fx.configDir, "prompt.md"), "digest: !`exit 3`\n", "utf8");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    let invoked = false;
    const agent = fanoutAgent({
      "render-boom": async () => {
        invoked = true;
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(invoked).toBe(false);
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.noCommit).toBe("render-refused");
    expect(outcome.noCommit).not.toBe("voluntary-bail");
    expect(outcome.verdict?.noCommit).toBe("render-refused");
    expect(outcome.verdict?.gateResults).toEqual([]);
    // Never reached cherry-pick/merge — the entry stays pending for a retry
    // once the span is fixed.
    expect(await readPendingFromDisk(fx.repo)).toHaveLength(1);
  }, 20_000);
});

describe("Dispatcher render-refused — singleton/fanout agreement (DISPATCHER-RENDER-REFUSED-CATCH-UNSHARED)", () => {
  it("both callsites persist byte-identical §5 record content and emit a same-shaped log line for equivalent input, driven through the one shared persist+log method", async () => {
    await writeFile(
      join(fx.configDir, "prompt.md"),
      "digest: !`echo boom-detail 1>&2; exit 3`\n",
      "utf8",
    );

    // ---- singleton ----
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const singletonPhase = makePhase({ name: "plan", concurrency: "singleton" });
    const singletonChain: Chain = { phases: [singletonPhase], humanOnly: [] };
    let singletonInvoked = false;
    const singletonAgent: Agent = {
      name: "must-not-run-singleton",
      async invoke() {
        singletonInvoked = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const singletonWarnings: string[] = [];
    const singletonLog: Logger = {
      info: () => {},
      warn: (l) => singletonWarnings.push(l),
      error: () => {},
    };
    const singletonDispatcher = new Dispatcher({
      chainLoader: staticLoader(singletonChain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singletonAgent,
      log: singletonLog,
    });
    const singletonOutcome = await singletonDispatcher.tick();

    expect(singletonInvoked).toBe(false);
    expect(singletonOutcome.noCommit).toBe("render-refused");
    const singletonRecord = await readFile(
      join(fx.repo, ".flume", "prior-attempts", "plan.json"),
      "utf8",
    );

    // ---- fanout — same repo, own tag so its §5 slot never shares a path
    // with the singleton's above.
    await writePending(fx.repo, [makeEntry("FANOUT-TWIN", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");
    const fanoutPhase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
    });
    const fanoutChain: Chain = { phases: [fanoutPhase], humanOnly: [] };
    let fanoutInvoked = false;
    const fanoutAgentInst = fanoutAgent({
      "fanout-twin": async () => {
        fanoutInvoked = true;
      },
    });
    const fanoutWarnings: string[] = [];
    const fanoutLog: Logger = {
      info: () => {},
      warn: (l) => fanoutWarnings.push(l),
      error: () => {},
    };
    const fanoutDispatcher = new Dispatcher({
      chainLoader: staticLoader(fanoutChain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: fanoutAgentInst,
      log: fanoutLog,
    });
    const fanoutOutcome = await fanoutDispatcher.tick();

    expect(fanoutInvoked).toBe(false);
    expect(fanoutOutcome.noCommit).toBe("render-refused");
    const fanoutRecord = await readFile(
      join(fx.repo, ".flume", "prior-attempts", "fanout-twin.json"),
      "utf8",
    );

    // §5 record content (mode + failures) is byte-identical for equivalent
    // input — a one-sided edit to either callsite's persisted record breaks
    // this pin.
    expect(fanoutRecord).toBe(singletonRecord);

    // Both callsites log through the same template —
    // "[flume] <label>: render-refused (no commit): <message>" — with only
    // the label (phase name vs. entry tag) differing; the message text
    // itself agrees for equivalent input.
    expect(singletonWarnings).toHaveLength(1);
    expect(fanoutWarnings).toHaveLength(1);
    const shape = /^\[flume\] (.+): render-refused \(no commit\): ([\s\S]+)$/;
    const singletonMatch = singletonWarnings[0]!.match(shape);
    const fanoutMatch = fanoutWarnings[0]!.match(shape);
    expect(singletonMatch).not.toBeNull();
    expect(fanoutMatch).not.toBeNull();
    expect(singletonMatch![1]).toBe("plan");
    expect(fanoutMatch![1]).toBe("FANOUT-TWIN");
    expect(fanoutMatch![2]).toBe(singletonMatch![2]);
  }, 20_000);
});

describe("Dispatcher — Phase.shouldRun: decline before the invocation (RELEASE-v0.11 §8)", () => {
  it("singleton: shouldRun=false skips the agent entirely, produces no commit, and still hands off", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    const preHead = await head(fx.repo);

    let invoked = false;
    const agent: Agent = {
      name: "must-not-run-when-declined",
      async invoke() {
        invoked = true;
        throw new Error("shouldRun=false must never reach the agent");
      },
    };

    let handoffCalls = 0;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      shouldRun: () => false,
      handoff: () => {
        handoffCalls++;
        return ["build"];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(invoked).toBe(false);
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.commitSha).toBeUndefined();
    expect(await head(fx.repo)).toBe(preHead);
    expect(outcome.result?.gateResults).toEqual([]);

    // Declined is its own fact — never folded into noCommit/voluntary-bail.
    expect(outcome.declined).toBe(true);
    expect(outcome.noCommit).toBeUndefined();
    expect(outcome.noCommit).not.toBe("voluntary-bail");
    expect(outcome.verdict?.declined).toBe(true);
    expect(outcome.verdict?.noCommit).toBeUndefined();
    expect(outcome.verdict?.committed).toBe(false);
    expect(outcome.verdict?.gateResults).toEqual([]);

    // Baton mechanics unchanged: handoff still runs on the declined result,
    // sleeps this phase, wakes whatever handoff names.
    expect(handoffCalls).toBe(1);
    expect(outcome.awakeAfter).toEqual(["build"]);
    expect(baton.isAwake("plan")).toBe(false);
    expect(baton.isAwake("build")).toBe(true);
  });

  it("singleton: shouldRun=true is byte-identical (mod content-addressed shas) to a phase declaring no shouldRun", async () => {
    async function runOnce(shouldRun?: () => boolean) {
      const local = await makeFixture();
      try {
        new Baton(join(local.repo, ".flume")).wake("plan");
        const phase = makePhase({
          name: "plan",
          concurrency: "singleton",
          ...(shouldRun ? { shouldRun } : {}),
        });
        const chain: Chain = { phases: [phase], humanOnly: [] };
        const agent = singleAgent(async (cwd) => {
          await writeAndCommit(cwd, "src/plan-output.ts", "ok\n", "plan: derive");
        });
        const dispatcher = new Dispatcher({
          chainLoader: staticLoader(chain),
          repoRoot: local.repo,
          configDir: local.configDir,
          agent,
          log: silent,
        });
        return await dispatcher.tick();
      } finally {
        await local.cleanup();
      }
    }

    const declaredTrue = await runOnce(() => true);
    const undeclared = await runOnce(undefined);

    // Every fact both ticks produce is deterministic except the
    // content-addressed commit sha (author/committer timestamps differ
    // between the two independent commits) — blank those out before
    // comparing the rest byte-for-byte.
    const normalize = (o: unknown) =>
      JSON.parse(JSON.stringify(o).replace(/\b[0-9a-f]{7,40}\b/g, "<SHA>"));

    expect(normalize(declaredTrue)).toEqual(normalize(undeclared));
    expect(declaredTrue.declined).toBeUndefined();
    expect(undeclared.declined).toBeUndefined();
  });

  it("singleton: an undeclared shouldRun leaves declined absent on both TickOutcome and TickVerdict", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");
    const phase = makePhase({ name: "plan", concurrency: "singleton" });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "x\n", "plan: derive");
    });
    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.declined).toBeUndefined();
    expect(outcome.verdict?.declined).toBeUndefined();
  });

  it("shouldRun sees the same TickContext promptArgs sees (singleton: pending)", async () => {
    await writePending(fx.repo, [makeEntry("CTX-CHECK", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let shouldRunCtx: TickContext | undefined;
    let promptArgsCtx: TickContext | undefined;
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      shouldRun: (ctx) => {
        shouldRunCtx = ctx;
        return true;
      },
      promptArgs: (ctx) => {
        promptArgsCtx = ctx;
        return {};
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "x\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    expect(shouldRunCtx).toBeDefined();
    expect(shouldRunCtx).toBe(promptArgsCtx);
    expect(shouldRunCtx?.pending?.map((e) => e.tag)).toEqual(["CTX-CHECK"]);
  });

  it("fanout: shouldRun=false on the assigned entry skips only that entry's agent invocation; entry stays pending, wave still hands off", async () => {
    await writePending(fx.repo, [makeEntry("SHOULDRUN-FALSE", ["src/a.ts"])]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    let invoked = false;
    const agent = fanoutAgent({
      "shouldrun-false": async () => {
        invoked = true;
      },
    });

    let handoffCalls = 0;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shouldRun: () => false,
      handoff: () => {
        handoffCalls++;
        return ["plan"];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(invoked).toBe(false);
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.declined).toBe(true);
    expect(outcome.noCommit).toBeUndefined();
    expect(outcome.noCommit).not.toBe("voluntary-bail");
    expect(outcome.verdict?.declined).toBe(true);
    expect(outcome.verdict?.noCommit).toBeUndefined();
    expect(outcome.verdict?.shippedTags).toEqual([]);

    // Never invoked, never shipped — the entry stays pending.
    expect(await readPendingFromDisk(fx.repo)).toHaveLength(1);

    expect(handoffCalls).toBe(1);
    expect(outcome.awakeAfter).toEqual(["plan"]);
    expect(baton.isAwake("build")).toBe(false);
    expect(baton.isAwake("plan")).toBe(true);
  }, 20_000);

  it("fanout: shouldRun is consulted per assigned entry — one entry declines while its sibling ships normally", async () => {
    await writePending(fx.repo, [
      makeEntry("SHOULDRUN-DECLINE", ["src/a.ts"]),
      makeEntry("SHOULDRUN-SHIP", ["src/b.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const invoked: string[] = [];
    const agent = fanoutAgent({
      "shouldrun-decline": async () => {
        invoked.push("SHOULDRUN-DECLINE");
      },
      "shouldrun-ship": async (cwd) => {
        invoked.push("SHOULDRUN-SHIP");
        await writeAndCommit(cwd, "src/b.ts", "ok\n", "build: ship");
      },
    });

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shouldRun: (ctx) => ctx.assignedEntry?.tag !== "SHOULDRUN-DECLINE",
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(invoked).toEqual(["SHOULDRUN-SHIP"]);
    expect(outcome.result?.committed).toBe(true);
    expect(outcome.result?.shippedTags).toEqual(["SHOULDRUN-SHIP"]);
    // A wave that ships can still carry `declined` for a declined sibling —
    // the same coexistence `tipMoved` already establishes.
    expect(outcome.declined).toBe(true);
    expect(outcome.verdict?.declined).toBe(true);
    expect(outcome.verdict?.shippedTags).toEqual(["SHOULDRUN-SHIP"]);

    const remaining = await readPendingFromDisk(fx.repo);
    expect(remaining.map((e) => e.tag)).toEqual(["SHOULDRUN-DECLINE"]);
  }, 20_000);

  it("fanout: shouldRun sees the same TickContext promptArgs sees (assignedEntry)", async () => {
    await writePending(fx.repo, [makeEntry("CTX-CHECK-FANOUT", ["src/a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    let shouldRunCtx: TickContext | undefined;
    let promptArgsCtx: TickContext | undefined;
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      shouldRun: (ctx) => {
        shouldRunCtx = ctx;
        return true;
      },
      promptArgs: (ctx) => {
        promptArgsCtx = ctx;
        return {};
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };
    const agent = fanoutAgent({
      "ctx-check-fanout": async (cwd) => {
        await writeAndCommit(cwd, "src/a.ts", "x\n", "build: do");
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    expect(shouldRunCtx).toBeDefined();
    expect(shouldRunCtx?.assignedEntry?.tag).toBe("CTX-CHECK-FANOUT");
    expect(shouldRunCtx).toBe(promptArgsCtx);
  }, 20_000);
});

// ---------- TickResult carries the no-commit classification (§15) ----------

// SETUP-WORKTREE-HELPER bailed twice against the build fence and no plan
// tick woke: `Dispatcher.tick` computed the §6 classification but discarded
// it before calling `phase.handoff(result)`, so no chain's handoff could
// ever distinguish a voluntary-bail from a genuine nothing-pickable no-op.
// These assert the fix at the one seam that matters: what `handoff` itself
// receives.

describe("Dispatcher — TickResult.noCommit reaches phase.handoff (§15)", () => {
  it("voluntary-bail: the TickResult handed to handoff carries noCommit: 'voluntary-bail'", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const handoffResults: TickResult[] = [];
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: (r) => {
        handoffResults.push(r);
        return [];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent: Agent = {
      name: "bailing-singleton",
      async invoke() {
        // Clean exit, no commit — a voluntary bail per §6.
        return { exitCode: 0, stdout: "BAILED: no path forward\n", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(false);
    expect(outcome.noCommit).toBe("voluntary-bail");
    expect(handoffResults).toHaveLength(1);
    expect(handoffResults[0]?.noCommit).toBe("voluntary-bail");
  }, 20_000);

  it("committed tick: the TickResult handed to handoff has no noCommit field", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    const handoffResults: TickResult[] = [];
    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      handoff: (r) => {
        handoffResults.push(r);
        return [];
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/derived.ts", "y\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.committed).toBe(true);
    expect(outcome.noCommit).toBeUndefined();
    expect(handoffResults).toHaveLength(1);
    expect(handoffResults[0]?.noCommit).toBeUndefined();
    expect("noCommit" in handoffResults[0]!).toBe(false);
  });
});

// ---------- per-tick chain re-resolution (§2) ----------

describe("Dispatcher — per-tick chain re-resolution (§2)", () => {
  // The cross-tick rewrite guarantee is a *process boundary*, not an
  // in-process re-eval (Node's ESM registry is non-evictable; see
  // loadChainModule). A fake/closure loader cannot exercise it and is
  // explicitly insufficient per §2 — that bullet is covered by the real
  // integration test in tests/loop-process-boundary.test.ts (two real
  // `flume tick` subprocesses vs a chain.ts mutated on disk between them).
  // The unit-level guarantee here is narrower: a `Dispatcher` constructed
  // with only `configDir` resolves the on-disk chain.ts itself, in-process,
  // with no subprocess.

  it("constructs with only configDir → resolves the on-disk chain.ts", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-ondisk-"));
    try {
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      await writeFile(
        join(cfg, "chain.ts"),
        `export default () => ({ chain: { phases: [{ name: "ondisk", description: "", ` +
          `promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
          `humanOnly: [] } });\n`,
        "utf8",
      );

      new Baton(join(fx.repo, ".flume")).wake("ondisk");

      // No chainLoader → default diskChainLoader(configDir).
      const dispatcher = new Dispatcher({
        repoRoot: fx.repo,
        configDir: cfg,
        agent: singleAgent(async (cwd) => {
          await writeAndCommit(cwd, "src/ondisk.ts", "x\n", "build: ondisk");
        }),
        log: silent,
      });

      const outcome = await dispatcher.tick();
      expect(outcome.hibernated).toBe(false);
      expect(outcome.phaseName).toBe("ondisk");
      expect(outcome.result?.committed).toBe(true);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });
});

// ---------- chain-load gate + engine fallback (§3) ----------

describe("Dispatcher — chainLoadGate reverts a broken self-edited chain (§3)", () => {
  it("broken chain.ts with chainLoadGate declared → tick reverted, chain restored, loop continues", async () => {
    // Last-good chain.ts on trunk; the broken rewrite must revert to this.
    const goodChain =
      `export default () => ({ chain: { phases: [{ name: "build", description: "", ` +
      `promptPath: "prompt.md", concurrency: "singleton", ` +
      `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
      `humanOnly: [] } });\n`;
    await writeAndCommit(fx.repo, ".flume/chain.ts", goodChain, "seed chain");
    const preHead = await head(fx.repo);

    new Baton(join(fx.repo, ".flume")).wake("build");

    // The dispatcher resolves via the test seam (staticLoader); the on-disk
    // chain.ts is what the agent rewrites and chainLoadGate validates.
    const phase = makePhase({
      name: "build",
      concurrency: "singleton",
      gates: [chainLoadGate],
      handoff: () => [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(
        cwd,
        ".flume/chain.ts",
        "export default { phases: [",
        "build: rewrite chain (broken)",
      );
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Producing tick reverted: trunk back at preHead, no commit reported.
    expect(outcome.result?.committed).toBe(false);
    expect(outcome.result?.commitSha).toBeUndefined();
    expect(await head(fx.repo)).toBe(preHead);
    // chain.ts restored to the last-good version.
    expect(await readFile(join(fx.repo, ".flume", "chain.ts"), "utf8")).toBe(
      goodChain,
    );
    // chain-load is the recorded failure (it runs before writable-paths).
    const gr = outcome.result?.gateResults ?? [];
    expect(gr.some((g) => g.gate === "chain-load" && !g.ok)).toBe(true);
    expect(gr.some((g) => g.gate === "writable-paths")).toBe(false);
    // Loop survives the bad self-edit — tick() returned normally.
    expect(outcome.hibernated).toBe(false);
  }, 20_000);
});

// §3 acceptance bullet 1's per-§5 clause: a chainLoadGate revert is only
// *recovery* (not just containment) because the next tick's prompt carries
// the chain-load failure (§3/§12: chainLoadGate without feedback = a blind
// chain.ts revert loop). The §3 test above stops at the recorded-failure
// check (it predates §5); this asserts the composite end-to-end. §5
// forwarding is gate-uniform — no src/ change, only the asserting test.
describe("Dispatcher — chainLoadGate revert forwards the chain-load failure to the next tick (§3 bullet 1, per-§5)", () => {
  it("broken chain.ts reverted by chainLoadGate → next tick's prompt carries <prior-attempt> naming chain-load + its detail; chain.ts restored to last-good", async () => {
    // Last-good chain.ts on trunk; the broken rewrite must revert to this.
    const goodChain =
      `export default () => ({ chain: { phases: [{ name: "build", description: "", ` +
      `promptPath: "prompt.md", concurrency: "singleton", ` +
      `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
      `humanOnly: [] } });\n`;
    await writeAndCommit(fx.repo, ".flume/chain.ts", goodChain, "seed chain");

    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "singleton",
      gates: [chainLoadGate],
      handoff: () => [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const prompts: string[] = [];
    const agent: Agent = {
      name: "recording-chain-rewriter",
      async invoke(inv) {
        // Capture the rendered prompt *before* acting — the assertion is
        // on what the dispatcher handed this tick, not on its output.
        const n = prompts.length;
        prompts.push(inv.prompt);
        if (n === 0) {
          // Attempt 1: self-edit chain.ts into a syntactically-broken
          // state → chainLoadGate fails afterCommit → revert + restore.
          await writeAndCommit(
            inv.cwd,
            ".flume/chain.ts",
            "export default { phases: [",
            "build: rewrite chain (broken)",
          );
        } else {
          // Attempt 2: innocuous commit (chain.ts untouched → gate skips).
          await writeAndCommit(
            inv.cwd,
            "src/o.ts",
            "recovered\n",
            "build: recover",
          );
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick(); // attempt 1 → broken chain.ts committed, reverted
    baton.wake("build"); // re-wake (handoff () => [] slept it)
    await dispatcher.tick(); // attempt 2 → prompt carries the chain-load block

    expect(prompts.length).toBe(2);

    // First attempt: no false prior-attempt signal.
    expect(prompts[0]).not.toContain("<prior-attempt>");

    // Retry: the §5 block names the *chain-load* gate, reverted at
    // afterCommit, and forwards its full loader failure — not just the
    // one-line verdict — so the next tick does not blindly re-author the
    // same broken chain.ts.
    expect(prompts[1]).toContain("<prior-attempt>");
    expect(prompts[1]).toContain("Reverted at: afterCommit");
    expect(prompts[1]).toContain("Failing gate: chain-load");
    expect(prompts[1]).toContain(
      "Verdict: chain.ts is broken — commit reverted",
    );
    // The raw esbuild transform failure (chainLoadGate's `details`) is
    // forwarded, bounded but verbatim.
    expect(prompts[1]).toContain("Transform failed");
    expect(prompts[1]).toContain("Unexpected end of file");

    // chain.ts is back at the last-good version after the revert.
    expect(await readFile(join(fx.repo, ".flume", "chain.ts"), "utf8")).toBe(
      goodChain,
    );
  }, 20_000);
});

describe("Dispatcher — ungated chain resolution failure → loud no-work outcome (§3)", () => {
  it("tick() with a rejecting chainLoader returns a failed no-work outcome, logs loudly, does not throw", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    const errors: string[] = [];
    const rec: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    const dispatcher = new Dispatcher({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      chainLoader: () => Promise.reject(new Error("simulated broken chain.ts")),
      agent: singleAgent(async () => {}),
      log: rec,
    });

    // No retain-last-good in-process (moot under process-per-tick): a tick
    // whose chain won't resolve does no work and returns a `failed` outcome
    // rather than throwing or hibernating. Recovery is structural — the next
    // tick is a fresh process reading the (gate-restored, or human-fixed)
    // chain.ts.
    const outcome = await dispatcher.tick();

    expect(outcome.failed).toBe(true);
    expect(outcome.hibernated).toBe(false);
    expect(outcome.result).toBeUndefined();
    expect(outcome.phaseName).toBeUndefined();
    expect(errors.some((e) => /chain resolution failed/.test(e))).toBe(true);
    expect(errors.some((e) => /simulated broken chain\.ts/.test(e))).toBe(true);
  });
});

describe("superviseLoop — process-per-tick supervisor (§2)", () => {
  it("spawns exactly one child per iteration and stops at hibernation", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      // Simulate the child `flume tick`: after 3 ticks the phase sleeps
      // itself and hands off to nothing → the on-disk baton empties → the
      // supervisor reads hibernation (disk-is-truth) and stops.
      if (calls >= 3) baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 50,
      runTick,
      log: silent,
    });

    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(true);
  });

  it("stops at --max when the chain never hibernates", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan"); // never slept → never hibernates

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      return Promise.resolve({ exitCode: 0 });
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 4,
      runTick,
      log: silent,
    });

    expect(calls).toBe(4);
    expect(res.ticks).toBe(4);
    expect(res.hibernated).toBe(false);
  });

  it("mount-dead: child exits EX_MOUNT_DEAD → supervisor aborts on first occurrence, never burns to --max (v0.7 §4)", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan"); // an aborted tick does no baton work

    const errors: string[] = [];
    const rec: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      return Promise.resolve({ exitCode: EX_MOUNT_DEAD });
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 3,
      runTick,
      log: rec,
    });

    // Immediate stop: one tick's worth of work, never the remaining --max
    // ticks re-hitting the same unloadable chain.
    expect(calls).toBe(1);
    expect(res.ticks).toBe(1);
    expect(res.hibernated).toBe(false);
    expect(res.mountDead).toBe(true);
    expect(errors.some((e) => /mount-dead/.test(e))).toBe(true);
  });

  /**
   * v0.8 §5 — shipped/errored cross the child→supervisor boundary by disk
   * (`<flumeDir>/tick-verdict.json`), not stdio: child stdio stays
   * `inherit`, so the exit code alone can't carry a run-wide total. Two
   * ticks in one run: the first ships an entry and writes a clean verdict,
   * the second is a gate-revert (errored) and writes that verdict before
   * sleeping the phase so the loop hibernates. `runTick` here plays the real
   * child `flume tick` process — the CLI's `tick` command writes exactly
   * this artifact around its own `dispatcher.tick()` call (the write/clear
   * primitives' own round-trip is proved directly in the
   * `writeTickVerdict / clearTickVerdict / readTickVerdicts` suite above);
   * `errored` itself is derived from `noCommit`/`shippedTags` at the read
   * site, not stored on the verdict — this suite proves `superviseLoop`
   * derives and accumulates it correctly.
   */
  it("a run with one errored tick and one shipped entry: SuperviseResult reports shipped>0 and errored>0, error named", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    const verdictPath = join(fx.repo, ".flume", "tick-verdict.json");

    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls === 1) {
        await writeFile(
          verdictPath,
          JSON.stringify(
            verdictFixture({ committed: true, shippedTags: ["SHIPPED-ENTRY"] }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath,
          JSON.stringify(
            verdictFixture({
              committed: false,
              noCommit: "gate-revert",
              summary: "build: no commit (gate-revert) → hibernate",
            }),
          ),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 5,
      runTick,
      log: silent,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(2);
    expect(res.shippedTags).toEqual(["SHIPPED-ENTRY"]);
    expect(res.erroredTicks).toHaveLength(1);
    expect(res.erroredTicks[0]).toContain("gate-revert");
  });

  it("render-refused (RELEASE-v0.10 §3) counts as errored — a broken prompt is a genuine failure, not a voluntary-bail no-op", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");
    const verdictPath = join(fx.repo, ".flume", "tick-verdict.json");

    const runTick = async (): Promise<{ exitCode: number | null }> => {
      await writeFile(
        verdictPath,
        JSON.stringify(
          verdictFixture({
            committed: false,
            noCommit: "render-refused",
            summary: "build: no commit (render-refused) → hibernate",
          }),
        ),
        "utf8",
      );
      baton.sleep("build");
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 5,
      runTick,
      log: silent,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(1);
    expect(res.erroredTicks).toHaveLength(1);
    expect(res.erroredTicks[0]).toContain("render-refused");
  });

  /**
   * LOOP-ERRORED-TICKS-SILENT-EXIT — a child can exit non-zero without ever
   * reaching the verdict write: the CJS-context refusal (2), the
   * detached-HEAD/harness-error refusal (1), an uncaught throw out of
   * `Dispatcher.tick`. None of these are `EX_TERMINAL_MISCONFIG` (78) or
   * `EX_MOUNT_DEAD` (69) — those fail-fast on their own axis — so before this
   * fix they fell into the generic non-zero warn-and-continue branch and
   * contributed nothing to `erroredTicks`: a run that never shipped anything
   * and never wrote a single verdict still reported zero errored ticks.
   */
  it("a child exiting non-zero with no verdict written on disk is counted in the run's erroredTicks total", async () => {
    new Baton(join(fx.repo, ".flume")).wake("build"); // never slept → never hibernates

    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      // No tick-verdict.json write at all — this is the "died before
      // reaching the write" shape the fix targets.
      return { exitCode: 1 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 3,
      runTick,
      log: silent,
    });

    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.shippedTags).toEqual([]);
    expect(res.erroredTicks).toHaveLength(3);
    for (const line of res.erroredTicks) {
      expect(line).toContain("exited 1");
    }
  });

  it("fail-fasts on a child's 78: stops after one tick, names the orphaned phases, leaves the flags (§3)", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    // The orphaned flag keeps hibernating() false — the stop must come from
    // the exit signal alone, never from re-reading the broken baton state.
    baton.wake("ghost");

    const errors: string[] = [];
    const rec: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      return Promise.resolve({ exitCode: EX_TERMINAL_MISCONFIG });
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 5,
      runTick,
      log: rec,
    });

    // Immediate stop: no further ticks despite --max 5 and a non-empty baton.
    expect(calls).toBe(1);
    expect(res.ticks).toBe(1);
    expect(res.hibernated).toBe(false);
    expect(res.terminal).toEqual({ kind: "orphaned-awake", phases: ["ghost"] });
    expect(
      errors.some((e) => /terminal misconfiguration/.test(e) && /ghost/.test(e)),
    ).toBe(true);
    // The supervisor never clears the flag either — diagnosability over tidiness.
    expect(baton.isAwake("ghost")).toBe(true);
  });
});

/**
 * v0.7 §16 — the supervisor-level legs `superviseLoop` owns: a tagged
 * provisioning failure quarantines its slug for the rest of the run (and
 * that quarantine crosses to the next child tick via `runTick`'s
 * `quarantinedSlugs` argument, mirroring how the real CLI carries it over
 * `FLUME_QUARANTINED_SLUGS`); the same failure signature repeating on three
 * consecutive ticks with no successful tick between them aborts the run; a
 * signature that stops repeating resets the streak. `runTick` here plays the
 * real child `flume tick` process exactly as the §5 suite above does — it
 * writes `tick-verdict.json` directly rather than exercising a real fanout
 * wave (that mechanism is proved in the `Dispatcher fanout — pre-tick
 * worktree provisioning failure isolates one entry (§16)` suite).
 */
describe("superviseLoop — provisioning-failure quarantine & consecutive-failure abort backstop (§16)", () => {
  const verdictPath = (): string => join(fx.repo, ".flume", "tick-verdict.json");

  it("quarantines a tagged failure after its first tick and carries it to the next child tick", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async (
      quarantinedSlugs: ReadonlySet<string>,
    ): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls === 1) {
        await writeFile(
          verdictPath(),
          JSON.stringify(
            verdictFixture({
              committed: true,
              shippedTags: ["OK-A"],
              provisionFailures: [
                {
                  tag: "HELD-ENTRY",
                  signature: "EBUSY: resource busy or locked",
                  message: "EBUSY: resource busy or locked, rmdir '...'",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 5,
      runTick,
      log,
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(2);
    expect(res.shippedTags).toEqual(["OK-A"]);
    // Nothing quarantined yet going into the first tick; the slug the first
    // tick's failure names is quarantined going into the second.
    expect(receivedSlugs[0]).toEqual([]);
    expect(receivedSlugs[1]).toEqual(["held-entry"]);
    expect(
      warnings.some(
        (w) => w.includes("HELD-ENTRY") && w.includes("EBUSY"),
      ),
    ).toBe(true);
  });

  it("aborts after the same untagged signature fails 3 consecutive ticks with no successful tick between", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort must come from the backstop alone

    const SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(),
        JSON.stringify(
          verdictFixture({
            committed: false,
            summary: "build: no commit — worktree provisioning failed",
            provisionFailures: [{ signature: SIGNATURE, message: SIGNATURE }],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const errors: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 10,
      runTick,
      log,
    });

    // Aborted on the 3rd consecutive occurrence, never burning to --max 10.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({ signature: SIGNATURE, count: 3 });
    expect(errors.some((e) => e.includes(SIGNATURE))).toBe(true);
  });

  it("aborts on a repeated signature buried behind a varying sibling at index 0 every tick", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build"); // never hibernates — the abort must come from the backstop alone

    const REPEATED_SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(),
        JSON.stringify(
          verdictFixture({
            committed: false,
            summary: "build: no commit — worktree provisioning failed",
            // The repo-level failure (untagged) always lands first in
            // runFanout's push order; a distinct per-entry signature every
            // tick sits at index 0 and must not shadow the one that's
            // actually repeating behind it.
            provisionFailures: [
              {
                tag: `VARYING-${calls}`,
                signature: `EBUSY: resource busy or locked (attempt ${calls})`,
                message: `EBUSY: resource busy or locked (attempt ${calls})`,
              },
              { signature: REPEATED_SIGNATURE, message: REPEATED_SIGNATURE },
            ],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const errors: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: () => {},
      error: (l) => errors.push(l),
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 10,
      runTick,
      log,
    });

    // Aborted on the 3rd consecutive occurrence of the buried signature,
    // never burning to --max 10.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({
      signature: REPEATED_SIGNATURE,
      count: 3,
    });
    expect(errors.some((e) => e.includes(REPEATED_SIGNATURE))).toBe(true);
  });

  it("a failure that clears on the next tick resets the streak — the backstop never trips", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls === 1 || calls === 3) {
        await writeFile(
          verdictPath(),
          JSON.stringify(
            verdictFixture({
              committed: false,
              summary: "build: no commit — worktree provisioning failed",
              provisionFailures: [{ signature: SIGNATURE, message: SIGNATURE }],
            }),
          ),
          "utf8",
        );
      } else if (calls === 2) {
        // Transient — the wall didn't recur this tick.
        await writeFile(
          verdictPath(),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 10,
      runTick,
      log: silent,
    });

    expect(calls).toBe(4);
    expect(res.ticks).toBe(4);
    expect(res.hibernated).toBe(true);
    expect(res.repeatedFailure).toBeUndefined();
  });
});

/**
 * v0.8 §8 — `SuperviseLoopOptions.quarantineScope` /
 * `abortThreshold` open the two constants the suite above exercises at
 * their v0.7 §16 defaults (run-scoped quarantine; three-failure abort) as
 * chain-overridable config. The CLI forwards a resolved chain's
 * `supervisorPolicy` block into these same options (`src/cli.ts`); this
 * suite proves `superviseLoop` itself, the same seam the prior suite
 * already proves defaults through when neither option is passed.
 */
describe("superviseLoop — supervisor policy knobs override the §16 defaults (v0.8 §8)", () => {
  const verdictPath = (): string => join(fx.repo, ".flume", "tick-verdict.json");

  it("abortThreshold: 2 aborts on the second consecutive identical signature, not the third", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(),
        JSON.stringify(
          verdictFixture({
            committed: false,
            summary: "build: no commit — worktree provisioning failed",
            provisionFailures: [{ signature: SIGNATURE, message: SIGNATURE }],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 10,
      runTick,
      log: silent,
      abortThreshold: 2,
    });

    expect(calls).toBe(2);
    expect(res.ticks).toBe(2);
    expect(res.hibernated).toBe(false);
    expect(res.repeatedFailure).toEqual({ signature: SIGNATURE, count: 2 });
  });

  it("quarantineScope: \"none\" never quarantines a tagged failure — later ticks still see the empty set", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const receivedSlugs: Array<string[]> = [];
    let calls = 0;
    const runTick = async (
      quarantinedSlugs: ReadonlySet<string>,
    ): Promise<{ exitCode: number | null }> => {
      calls++;
      receivedSlugs.push([...quarantinedSlugs].sort());
      if (calls < 3) {
        await writeFile(
          verdictPath(),
          JSON.stringify(
            verdictFixture({
              committed: false,
              provisionFailures: [
                {
                  tag: "HELD-ENTRY",
                  signature: "EBUSY: resource busy or locked",
                  message: "EBUSY: resource busy or locked, rmdir '...'",
                },
              ],
            }),
          ),
          "utf8",
        );
      } else {
        await writeFile(
          verdictPath(),
          JSON.stringify(verdictFixture({ committed: false })),
          "utf8",
        );
        baton.sleep("build");
      }
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 5,
      runTick,
      log: silent,
      quarantineScope: "none",
    });

    expect(res.hibernated).toBe(true);
    expect(res.ticks).toBe(3);
    // Every tick sees an empty quarantine set — the same tagged slug that
    // §16's default suite proves gets quarantined after tick 1 here never
    // does, because the identical signature repeats only twice before the
    // baton sleeps (never reaching the untouched abortThreshold default).
    expect(receivedSlugs).toEqual([[], [], []]);
  });

  it("a chain declaring neither knob gets the v0.7 §16 defaults, byte-identical", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const SIGNATURE = "git worktree prune: fatal: not a git repository";
    let calls = 0;
    const runTick = async (): Promise<{ exitCode: number | null }> => {
      calls++;
      await writeFile(
        verdictPath(),
        JSON.stringify(
          verdictFixture({
            committed: false,
            summary: "build: no commit — worktree provisioning failed",
            provisionFailures: [{ signature: SIGNATURE, message: SIGNATURE }],
          }),
        ),
        "utf8",
      );
      return { exitCode: 0 };
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 10,
      runTick,
      log: silent,
    });

    // Undeclared abortThreshold still aborts on the 3rd consecutive tick —
    // the v0.7 §16 default, not the 2 the suite above overrides to.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.repeatedFailure).toEqual({ signature: SIGNATURE, count: 3 });
  });
});

/**
 * §6 (v0.6.2) — `superviseLoop`'s loop-end friction summary
 * (`logFrictionSummary`, `src/Dispatcher.ts:1730-1740`), and the fix it rode
 * in on: the chain it loads comes from `opts.configDir`, not always
 * `<repoRoot>/.flume` (the old always-used default). `fx.configDir` is a
 * separate temp dir from `fx.repo/.flume` in this suite's fixture, so
 * passing it as `configDir` while leaving `<repoRoot>/.flume` chain-less
 * proves the plumbing: a summary that still finds the chain must have used
 * `opts.configDir`.
 */
describe("superviseLoop — loop-end friction summary (§6) & configDir plumbing", () => {
  it("logs the friction count line at the hibernation stop when declared and non-empty, loading the chain from opts.configDir", async () => {
    // The repo default has no chain.ts at all — only opts.configDir does.
    expect(existsSync(join(fx.repo, ".flume", "chain.ts"))).toBe(false);

    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    await writeMinimalChain(fx.configDir, JSON.stringify("friction"));
    const frictionDir = join(fx.repo, ".flume", "friction");
    await mkdir(frictionDir, { recursive: true });
    await writeFile(join(frictionDir, "a.md"), "note\n");
    await writeFile(join(frictionDir, "b.md"), "note\n");

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls >= 2) baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      maxTicks: 5,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(true);
    expect(
      infos.some((l) => l.includes("friction: 2 note(s) await routing")),
    ).toBe(true);
  });

  it("omits the friction line at hibernation when the declared dir exists but holds no files", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    await writeMinimalChain(fx.configDir, JSON.stringify("friction"));
    await mkdir(join(fx.repo, ".flume", "friction"), { recursive: true });

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls >= 2) baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      maxTicks: 5,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(true);
    expect(infos.some((l) => l.includes("hibernating after"))).toBe(true);
    expect(infos.some((l) => l.includes("friction:"))).toBe(false);
  });

  it("omits the friction line at hibernation when Chain.friction is undeclared", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    await writeMinimalChain(fx.configDir); // no friction declared
    const frictionDir = join(fx.repo, ".flume", "friction");
    await mkdir(frictionDir, { recursive: true });
    await writeFile(join(frictionDir, "a.md"), "note\n");

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      if (calls >= 2) baton.sleep("plan");
      return Promise.resolve({ exitCode: 0 });
    };

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      maxTicks: 5,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(true);
    expect(infos.some((l) => l.includes("hibernating after"))).toBe(true);
    expect(infos.some((l) => l.includes("friction:"))).toBe(false);
  });

  it("logs the friction count line at the --max-reached stop when declared and non-empty", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan"); // never sleeps → never hibernates
    await writeMinimalChain(fx.configDir, JSON.stringify("friction"));
    const frictionDir = join(fx.repo, ".flume", "friction");
    await mkdir(frictionDir, { recursive: true });
    await writeFile(join(frictionDir, "a.md"), "note\n");

    const runTick = (): Promise<{ exitCode: number | null }> =>
      Promise.resolve({ exitCode: 0 });

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      maxTicks: 2,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(false);
    expect(infos.some((l) => l.includes("reached --max 2"))).toBe(true);
    expect(
      infos.some((l) => l.includes("friction: 1 note(s) await routing")),
    ).toBe(true);
  });

  it("omits the friction line at the --max-reached stop when the declared dir is empty", async () => {
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("plan");
    await writeMinimalChain(fx.configDir, JSON.stringify("friction"));
    await mkdir(join(fx.repo, ".flume", "friction"), { recursive: true });

    const runTick = (): Promise<{ exitCode: number | null }> =>
      Promise.resolve({ exitCode: 0 });

    const infos: string[] = [];
    const res = await superviseLoop({
      repoRoot: fx.repo,
      configDir: fx.configDir,
      maxTicks: 2,
      runTick,
      log: { info: (l) => infos.push(l), warn: () => {}, error: () => {} },
    });

    expect(res.hibernated).toBe(false);
    expect(infos.some((l) => l.includes("reached --max 2"))).toBe(true);
    expect(infos.some((l) => l.includes("friction:"))).toBe(false);
  });
});

describe("Dispatcher — flumeDir exposed to gates & promptArgs (§16)", () => {
  it("threads the resolved flumeDir into GateContext and TickContext (default location)", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let gateFlumeDir: string | undefined;
    let ctxFlumeDir: string | undefined;

    const capturingGate: Gate = {
      name: "capture-flumedir",
      when: "afterCommit",
      run(ctx) {
        gateFlumeDir = ctx.flumeDir;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [capturingGate],
      promptArgs: (ctx) => {
        ctxFlumeDir = ctx.flumeDir;
        return {};
      },
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    // Default flumeDir is <repoRoot>/.flume, and the same resolved value reaches
    // both the prompt-arg builder (pre-agent) and the gate (post-commit).
    expect(ctxFlumeDir).toBe(join(fx.repo, ".flume"));
    expect(gateFlumeDir).toBe(join(fx.repo, ".flume"));
  });

  it("honors a relocated flumeDir option in GateContext", async () => {
    const dock = join(fx.repo, "dock-state");
    new Baton(dock).wake("plan");

    let gateFlumeDir: string | undefined;
    const capturingGate: Gate = {
      name: "capture-flumedir",
      when: "afterCommit",
      run(ctx) {
        gateFlumeDir = ctx.flumeDir;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [capturingGate],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      flumeDir: dock,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    expect(gateFlumeDir).toBe(dock);
  });
});

describe("Dispatcher — GateContext.repoRoot (RELEASE-v0.7 §6)", () => {
  it("singleton tick: gate's repoRoot equals the primary checkout (same as cwd)", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let gateRepoRoot: string | undefined;
    let gateCwd: string | undefined;
    const capturingGate: Gate = {
      name: "capture-reporoot",
      when: "afterCommit",
      run(ctx) {
        gateRepoRoot = ctx.repoRoot;
        gateCwd = ctx.cwd;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [capturingGate],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    expect(gateRepoRoot).toBe(fx.repo);
    expect(gateRepoRoot).toBe(gateCwd);
  });

  it("fanout tick: afterCommit gate's repoRoot is the worktree root; afterMerge gate's repoRoot is the trunk", async () => {
    await writePending(fx.repo, [makeEntry("RR-FANOUT", ["src/rr.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    let commitRepoRoot: string | undefined;
    let commitCwd: string | undefined;
    const captureCommit: Gate = {
      name: "capture-commit-reporoot",
      when: "afterCommit",
      run(ctx) {
        commitRepoRoot = ctx.repoRoot;
        commitCwd = ctx.cwd;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    let mergeRepoRoot: string | undefined;
    let mergeCwd: string | undefined;
    const captureMerge: Gate = {
      name: "capture-merge-reporoot",
      when: "afterMerge",
      run(ctx) {
        mergeRepoRoot = ctx.repoRoot;
        mergeCwd = ctx.cwd;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [captureCommit, captureMerge],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "rr-fanout": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/rr.ts",
          "ok\n",
          "build(RR-FANOUT): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["RR-FANOUT"]);

    // afterCommit runs on the worktree branch, before cherry-pick: its
    // repoRoot is that worktree's root, not the trunk repo.
    expect(commitRepoRoot).toBeDefined();
    expect(commitRepoRoot).toBe(commitCwd);
    expect(commitRepoRoot).not.toBe(fx.repo);
    expect(commitRepoRoot).toContain("rr-fanout");

    // afterMerge runs on the trunk after the cherry-pick lands.
    expect(mergeRepoRoot).toBe(fx.repo);
    expect(mergeRepoRoot).toBe(mergeCwd);
  }, 20_000);
});

describe("Dispatcher — GateContext.touchedPaths (GATECONTEXT-TOUCHED-PATHS-DEDUP)", () => {
  it("singleton tick: every afterCommit gate receives the identical touchedPaths array for the commit", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan");

    let firstTouched: string[] | undefined;
    let secondTouched: string[] | undefined;
    const gateA: Gate = {
      name: "capture-touched-a",
      when: "afterCommit",
      run(ctx) {
        firstTouched = ctx.touchedPaths;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };
    const gateB: Gate = {
      name: "capture-touched-b",
      when: "afterCommit",
      run(ctx) {
        secondTouched = ctx.touchedPaths;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
      gates: [gateA, gateB],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/out.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    await dispatcher.tick();

    expect(firstTouched).toEqual(["src/out.ts"]);
    // Same array instance reaches both gates — computed once before the
    // loop, not re-derived (shelled out to git) per gate.
    expect(secondTouched).toBe(firstTouched);
  });

  it("fanout tick: afterCommit and afterMerge gates both see the commit's touched paths, each loop's own shared computation", async () => {
    await writePending(fx.repo, [makeEntry("TP-FANOUT", ["src/tp.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    let commitTouched: string[] | undefined;
    const captureCommit: Gate = {
      name: "capture-commit-touched",
      when: "afterCommit",
      run(ctx) {
        commitTouched = ctx.touchedPaths;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    let mergeTouched: string[] | undefined;
    const captureMerge: Gate = {
      name: "capture-merge-touched",
      when: "afterMerge",
      run(ctx) {
        mergeTouched = ctx.touchedPaths;
        return Promise.resolve({ ok: true, message: "captured" });
      },
    };

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [captureCommit, captureMerge],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "tp-fanout": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/tp.ts",
          "ok\n",
          "build(TP-FANOUT): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["TP-FANOUT"]);
    expect(commitTouched).toEqual(["src/tp.ts"]);
    expect(mergeTouched).toEqual(["src/tp.ts"]);
  }, 20_000);
});

describe("Dispatcher — Chain.friction load-time validation (§2)", () => {
  it("rejects an absolute-path friction declaration with a usage-shaped error", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-friction-abs-"));
    try {
      const abs = resolve(tmpdir(), "flume-friction-abs-target");
      await writeMinimalChain(cfg, JSON.stringify(abs));

      await expect(loadChainModule(join(cfg, "chain.ts"))).rejects.toThrow(
        /friction .* as an absolute path/,
      );
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  // RELEASE-v0.11 §6 — the chain is a plugin, not a consumer.
  //
  // The assertion is **identity** (`toBe`), and that is the whole point: a
  // chain that resolved its own second copy of the engine would hand back
  // objects structurally identical to these, so a deep-equal check would
  // pass under exactly the condition this section exists to prevent. Only
  // reference equality distinguishes "the engine handed me its gate" from
  // "I resolved a gate that looks like it".
  it("hands the chain factory the identity-same engine objects the dispatcher holds (§6)", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-api-identity-"));
    try {
      await mkdir(cfg, { recursive: true });
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      // The factory stashes what it was handed on the returned chain, so the
      // test can compare against the engine's own exports.
      await writeFile(
        join(cfg, "chain.ts"),
        `export default (api) => ({ chain: { phases: [{ name: "build", ` +
          `description: "", promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [api.tscGate], handoff: () => [] }], ` +
          `humanOnly: [] } });\n`,
        "utf8",
      );

      const mod = await loadChainModule(join(cfg, "chain.ts"));

      const gate = mod.chain.phases[0]!.gates[0];
      expect(gate).toBeDefined();
      expect(gate).toBe(realTscGate);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  // RELEASE-v0.11 §6 — the error classes a chain branches on with
  // `instanceof` must ride the api parameter too, or a chain catching one
  // has no way to identify it without a value import of its own. The
  // factory stashes each into the phase's gates[] (a real ChainModule
  // field that survives `loadChainModule`'s return, unlike an ad hoc key)
  // so the test can compare against the engine's own exports by reference.
  it("hands the chain factory the identity-same error classes the engine throws (§6)", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-api-errors-"));
    try {
      await mkdir(cfg, { recursive: true });
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      await writeFile(
        join(cfg, "chain.ts"),
        `export default (api) => ({ chain: { phases: [{ name: "build", ` +
          `description: "", promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [api.CjsContextLoadError, ` +
          `api.PendingParseFailure, api.InlineExecRenderError, ` +
          `api.TipClaimHeldError], handoff: () => [] }], humanOnly: [] } });\n`,
        "utf8",
      );

      const mod = await loadChainModule(join(cfg, "chain.ts"));

      const gates = mod.chain.phases[0]!.gates;
      expect(gates[0]).toBe(CjsContextLoadError);
      expect(gates[1]).toBe(realPendingParseFailure);
      expect(gates[2]).toBe(realInlineExecRenderError);
      expect(gates[3]).toBe(git.TipClaimHeldError);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  // RELEASE-v0.11 §6 — every engine value a chain composes with rides the
  // api param; `readTickVerdicts` is the one §6 doesn't name explicitly but
  // the same rule covers (FLUMEAPI-READTICKVERDICTS-MISSING).
  it("hands the chain factory the identity-same readTickVerdicts the engine exports (§6)", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-api-readtickverdicts-"));
    try {
      await mkdir(cfg, { recursive: true });
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      await writeFile(
        join(cfg, "chain.ts"),
        `export default (api) => ({ chain: { phases: [{ name: "build", ` +
          `description: "", promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [api.readTickVerdicts], ` +
          `handoff: () => [] }], humanOnly: [] } });\n`,
        "utf8",
      );

      const mod = await loadChainModule(join(cfg, "chain.ts"));

      const gates = mod.chain.phases[0]!.gates;
      expect(gates[0]).toBe(readTickVerdicts);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("refuses a default export that is not a function, naming the migration (§6)", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-nonfactory-"));
    try {
      await mkdir(cfg, { recursive: true });
      await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
      // The pre-0.11 shape: a Chain object rather than a factory.
      await writeFile(
        join(cfg, "chain.ts"),
        `export default { phases: [{ name: "build", description: "", ` +
          `promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
          `humanOnly: [] };\n`,
        "utf8",
      );

      await expect(loadChainModule(join(cfg, "chain.ts"))).rejects.toThrow(
        /must default-export a chain factory/,
      );
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("rejects a friction declaration that resolves outside the state root", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-friction-escape-"));
    try {
      await writeMinimalChain(cfg, JSON.stringify("../escaped-friction"));

      await expect(loadChainModule(join(cfg, "chain.ts"))).rejects.toThrow(
        /friction .* resolves outside the state root/,
      );
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("accepts a valid state-root-relative friction declaration", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-friction-valid-"));
    try {
      await writeMinimalChain(cfg, JSON.stringify("friction"));

      const mod = await loadChainModule(join(cfg, "chain.ts"));

      expect(mod.chain.friction).toBe("friction");
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("treats an undeclared friction field as a strict no-op — chain loads unaffected", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-friction-undeclared-"));
    try {
      await writeMinimalChain(cfg);

      const mod = await loadChainModule(join(cfg, "chain.ts"));

      expect(mod.chain.friction).toBeUndefined();
      expect(mod.chain.phases).toHaveLength(1);
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });
});

/**
 * v0.7 §5 — a CJS-context host (package.json lacking `"type": "module"`)
 * must refuse chain load with a usage-shaped `CjsContextLoadError`, not
 * relay tsx's raw loader stack. Two empirical signatures (build's own
 * `isCjsContextLoadFailure`, `Dispatcher.ts`): tsx 4.21's CJS-fallback parse
 * failure ("Cannot use import statement outside a module") — real, this
 * installed tsx (4.21.0) reproduces it directly — and tsx 4.23's
 * `ERR_MODULE_NOT_FOUND` against a path carrying its percent-encoded
 * `?namespace=` query, which this installed tsx never emits on its own and
 * so is exercised via the `tsx/esm/api` partial mock declared at the top of
 * this file. A third case proves the detector isn't trigger-happy: a
 * genuinely missing dependency (plain `ERR_MODULE_NOT_FOUND`, no namespace
 * artifact) must surface unshadowed.
 */
describe("Dispatcher — CJS-context host chain-load refusal (v0.7 §5)", () => {
  async function writeCfg(cfg: string, chainSrc: string): Promise<void> {
    await writeFile(join(cfg, "chain.ts"), chainSrc, "utf8");
  }

  it("tsx 4.21 signature — a CJS-context package.json plus a real import statement throws CjsContextLoadError naming the fix", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-cjs-import-"));
    try {
      // Explicit "commonjs" (not merely absent "type") is what actually
      // routes tsx into its CJS-fallback parse path — verified by hand
      // against this installed tsx before locking the test.
      await writeFile(
        join(cfg, "package.json"),
        JSON.stringify({ name: "cjs-host", type: "commonjs" }),
        "utf8",
      );
      await writeCfg(
        cfg,
        `import { join as pathJoin } from "node:path";\nexport default { pathJoin };\n`,
      );

      await expect(loadChainModule(join(cfg, "chain.ts"))).rejects.toMatchObject({
        name: "CjsContextLoadError",
        message: expect.stringContaining('"type": "module"'),
      });
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("tsx 4.23 signature — ERR_MODULE_NOT_FOUND with a percent-encoded ?namespace= query throws CjsContextLoadError naming the fix", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-cjs-namespace-"));
    try {
      await writeCfg(cfg, `export default {};\n`);
      const namespaceErr = Object.assign(
        new Error(
          `Cannot find module '${join(cfg, "chain.ts")}%3Fnamespace%3D1234567890' ` +
            `imported from somewhere`,
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
      vi.mocked(tsImport).mockRejectedValueOnce(namespaceErr);

      await expect(loadChainModule(join(cfg, "chain.ts"))).rejects.toMatchObject({
        name: "CjsContextLoadError",
        message: expect.stringContaining('"type": "module"'),
      });
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("a genuinely missing dependency (plain ERR_MODULE_NOT_FOUND, no namespace-query artifact) passes through unchanged", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-cjs-genuine-"));
    try {
      await writeCfg(
        cfg,
        `import { missing } from "./does-not-exist.js";\nexport default { missing };\n`,
      );

      let caught: unknown;
      try {
        await loadChainModule(join(cfg, "chain.ts"));
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(CjsContextLoadError);
      expect((caught as NodeJS.ErrnoException).code).toBe("ERR_MODULE_NOT_FOUND");
      expect((caught as Error).message).toContain("does-not-exist");
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });
});

/**
 * v0.6.2 §4 — teardown harvest. Only the engine is present when a fanout
 * worktree dies, so wave-end teardown must move a worktree-local friction
 * note into the primary friction dir, tag-prefixed, before the worktree is
 * removed. Content-opaque: files only, no read of contents.
 */
describe("Dispatcher fanout — teardown friction harvest (§4)", () => {
  it("moves worktree-local friction files into the primary dir, tag-prefixed, before worktree removal", async () => {
    await writePending(fx.repo, [makeEntry("FRICTION-A", ["src/friction-a.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };

    const agent = fanoutAgent({
      "friction-a": async (cwd) => {
        await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
        await writeFile(
          join(cwd, ".flume", "friction", "note.md"),
          "the loop wants owner input\n",
        );
        await writeAndCommit(
          cwd,
          "src/friction-a.ts",
          "ok\n",
          "build(FRICTION-A): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual(["FRICTION-A"]);

    const frictionDir = join(fx.repo, ".flume", "friction");
    const files = await readdir(frictionDir);
    expect(files.length).toBe(1);
    // Tag-prefixed, timestamp-stamped, source-filename-suffixed — the stamp
    // is what makes a same-named retry land beside this file instead of
    // overwriting it.
    expect(files[0]).toMatch(/^FRICTION-A--\d{4}-\d{2}-\d{2}T.*--note\.md$/);
    expect(await readFile(join(frictionDir, files[0]!), "utf8")).toBe(
      "the loop wants owner input\n",
    );

    // Harvested out before removal — the worktree itself is fully gone.
    expect(
      existsSync(join(fx.repo, ".flume", "worktrees", "friction-a")),
    ).toBe(false);
  }, 20_000);

  it("a per-file harvest failure logs and continues rather than aborting the wave", async () => {
    await writePending(fx.repo, [makeEntry("FRICTION-B", ["src/friction-b.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };

    const primaryFrictionDir = join(fx.repo, ".flume", "friction");
    // The destination filename is now stamped (this entry) with the tick's
    // clock, so a frozen clock is what makes the exact destination
    // predictable enough to pre-seed a collision at it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const destName = "FRICTION-B--2024-01-01T00-00-00-000Z--note.md";
    // Pre-seed a directory at the exact destination the harvest would
    // rename into — rename(file, existing-dir) fails deterministically,
    // standing in for the locked-file / unreadable-dir class §4 calls out.
    await mkdir(join(primaryFrictionDir, destName), {
      recursive: true,
    });

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const agent = fanoutAgent({
      "friction-b": async (cwd) => {
        await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
        await writeFile(join(cwd, ".flume", "friction", "note.md"), "blocked\n");
        await writeAndCommit(
          cwd,
          "src/friction-b.ts",
          "ok\n",
          "build(FRICTION-B): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    let outcome: Awaited<ReturnType<typeof dispatcher.tick>>;
    try {
      outcome = await dispatcher.tick();
    } finally {
      vi.useRealTimers();
    }

    // The wave still ships despite the harvest failure.
    expect(outcome.result?.shippedTags).toEqual(["FRICTION-B"]);
    expect(warnings.some((w) => w.includes("note.md"))).toBe(true);
    // The pre-seeded destination is untouched — the failed move left it as-is.
    expect(
      existsSync(join(primaryFrictionDir, destName)),
    ).toBe(true);
  }, 20_000);

  it("an unreadable friction dir is logged, not silently swallowed", async () => {
    await writePending(fx.repo, [makeEntry("FRICTION-C", ["src/friction-c.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const agent = fanoutAgent({
      "friction-c": async (cwd) => {
        // Stand in for an unreadable dir (permissions, mid-write race,
        // etc.): a plain *file* at the mirror path means `readdir` on it
        // rejects with ENOTDIR rather than the absent-dir ENOENT §4 treats
        // as a silent no-op.
        await mkdir(join(cwd, ".flume"), { recursive: true });
        await writeFile(join(cwd, ".flume", "friction"), "not a directory\n");
        await writeAndCommit(
          cwd,
          "src/friction-c.ts",
          "ok\n",
          "build(FRICTION-C): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    const outcome = await dispatcher.tick();

    // The wave still ships — harvest failure must not abort it.
    expect(outcome.result?.shippedTags).toEqual(["FRICTION-C"]);
    expect(
      warnings.some((w) => w.includes("friction harvest") && w.includes("could not read")),
    ).toBe(true);
    // Nothing landed in the primary dir — there was nothing readable to move.
    expect(existsSync(join(fx.repo, ".flume", "friction"))).toBe(false);
  }, 20_000);

  it("an undeclared chain.friction is a no-op — no primary friction dir is created", async () => {
    await writePending(fx.repo, [makeEntry("FRICTION-D", ["src/friction-d.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    // No `friction` field on the chain — §4's harvest is entirely off.
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "friction-d": async (cwd) => {
        // Even if a worktree happens to hold a dir at the conventional
        // path, an undeclared channel must not be harvested.
        await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
        await writeFile(join(cwd, ".flume", "friction", "note.md"), "orphan\n");
        await writeAndCommit(
          cwd,
          "src/friction-d.ts",
          "ok\n",
          "build(FRICTION-D): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual(["FRICTION-D"]);
    expect(existsSync(join(fx.repo, ".flume", "friction"))).toBe(false);
  }, 20_000);

  it("a relocated state root has no worktree-local mirror to harvest from — no-op", async () => {
    const dock = await mkdtemp(join(tmpdir(), "flume-dock-friction-"));
    try {
      const pendingPath = join(dock, "plan", "pending.json");
      await mkdir(dirname(pendingPath), { recursive: true });
      await writeFile(
        pendingPath,
        JSON.stringify(
          [makeEntry("FRICTION-E", ["src/friction-e.ts"])],
          null,
          2,
        ) + "\n",
        "utf8",
      );
      new Baton(dock).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };

      const agent = fanoutAgent({
        "friction-e": async (cwd) => {
          // A worktree still has *a* `.flume/friction` under its own
          // repo-relative path, but the state root itself resolves outside
          // the repo tree — there is no mirror at the relocated dock path
          // for the harvest to read.
          await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
          await writeFile(
            join(cwd, ".flume", "friction", "note.md"),
            "unreachable\n",
          );
          await writeAndCommit(
            cwd,
            "src/friction-e.ts",
            "ok\n",
            "build(FRICTION-E): ship",
          );
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        flumeDir: dock,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();

      expect(outcome.result?.shippedTags).toEqual(["FRICTION-E"]);
      expect(existsSync(join(dock, "friction"))).toBe(false);
      expect(existsSync(join(fx.repo, ".flume"))).toBe(false);
    } finally {
      await rm(dock, { recursive: true, force: true });
    }
  }, 20_000);

  it("two harvests for the same tag with the same agent-chosen source filename land as two distinct files, neither overwriting the other", async () => {
    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [], friction: "friction" };
    const frictionDir = join(fx.repo, ".flume", "friction");

    // Two separate waves for the same tag (a re-derived retry, or simply the
    // tag recurring), each writing a friction note under the identical
    // agent-chosen filename `note.md`. Frozen at two distinct instants so
    // the resulting stamps are deterministic and provably different — the
    // collision this entry closes is exactly two such notes landing on the
    // same destination.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
      await writePending(fx.repo, [
        makeEntry("FRICTION-RETRY", ["src/friction-retry.ts"]),
      ]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const agentFirst = fanoutAgent({
        "friction-retry": async (cwd) => {
          await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
          await writeFile(
            join(cwd, ".flume", "friction", "note.md"),
            "first attempt's note\n",
          );
          await writeAndCommit(
            cwd,
            "src/friction-retry.ts",
            "one\n",
            "build(FRICTION-RETRY): first attempt",
          );
        },
      });

      const dispatcherFirst = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent: agentFirst,
        log: silent,
      });
      const outcomeFirst = await dispatcherFirst.tick();
      expect(outcomeFirst.result?.shippedTags).toEqual(["FRICTION-RETRY"]);

      vi.setSystemTime(new Date("2024-01-02T00:00:00.000Z"));
      // Land as a plan tick would — committed, not left dirty, so wave 2's
      // rewrite (which reverts pending.json back to `[]`, byte-identical to
      // wave 1's ship commit) has a real diff against HEAD to commit.
      await writePending(fx.repo, [
        makeEntry("FRICTION-RETRY", ["src/friction-retry-2.ts"]),
      ]);
      await exec("git", ["add", "--", ".flume/plan/pending.json"], {
        cwd: fx.repo,
      });
      await exec("git", ["commit", "-q", "-m", "plan: re-derive FRICTION-RETRY"], {
        cwd: fx.repo,
      });
      new Baton(join(fx.repo, ".flume")).wake("build");

      const agentSecond = fanoutAgent({
        "friction-retry": async (cwd) => {
          await mkdir(join(cwd, ".flume", "friction"), { recursive: true });
          await writeFile(
            join(cwd, ".flume", "friction", "note.md"),
            "second attempt's note\n",
          );
          await writeAndCommit(
            cwd,
            "src/friction-retry-2.ts",
            "two\n",
            "build(FRICTION-RETRY): second attempt",
          );
        },
      });

      const dispatcherSecond = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent: agentSecond,
        log: silent,
      });
      const outcomeSecond = await dispatcherSecond.tick();
      expect(outcomeSecond.result?.shippedTags).toEqual(["FRICTION-RETRY"]);
    } finally {
      vi.useRealTimers();
    }

    const files = (await readdir(frictionDir)).sort();
    expect(files.length).toBe(2);
    for (const f of files) {
      expect(f).toMatch(/^FRICTION-RETRY--\d{4}-\d{2}-\d{2}T.*--note\.md$/);
    }
    // Distinct destinations — neither harvest overwrote the other.
    expect(files[0]).not.toBe(files[1]);

    const contents = await Promise.all(
      files.map((f) => readFile(join(frictionDir, f), "utf8")),
    );
    expect(contents).toContain("first attempt's note\n");
    expect(contents).toContain("second attempt's note\n");
  }, 20_000);
});

/**
 * v0.6.2 §5 — revert note. Only the engine is present when an afterCommit
 * gate discards a fanout entry's commit, so it must write the operator's
 * copy of the verdict — the gate's own name/message/details plus the
 * reverted commit's subject+body — to the primary friction dir before
 * `dropLastCommit` erases the evidence. Undeclared `chain.friction` keeps
 * §5 off per §2; a note-write failure must never block the revert itself.
 */
describe("Dispatcher fanout — revert note to the friction channel (§5)", () => {
  it("an afterCommit gate revert with Chain.friction declared writes a dated note carrying the gate's verdict and the reverted commit's subject+body", async () => {
    await writePending(fx.repo, [makeEntry("REVERT-NOTE-A", ["src/rna.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const failing: Gate = {
      name: "boom-gate",
      when: "afterCommit",
      async run() {
        return {
          ok: false,
          message: "boom said no",
          details: "boom-details-123",
        };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failing],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      friction: "friction",
    };

    const agent = fanoutAgent({
      "revert-note-a": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/rna.ts",
          "ok\n",
          "build(REVERT-NOTE-A): ship\n\nThis is the body of the commit.",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    // Whole-commit revert: nothing shipped, the entry stays pending.
    expect(outcome.result?.shippedTags).toEqual([]);
    expect((await readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "REVERT-NOTE-A",
    ]);

    const frictionDir = join(fx.repo, ".flume", "friction");
    const files = await readdir(frictionDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T.*--REVERT-NOTE-A--reverted\.md$/,
    );

    const note = await readFile(join(frictionDir, files[0]!), "utf8");
    expect(note).toContain("boom-gate");
    expect(note).toContain("boom said no");
    expect(note).toContain("boom-details-123");
    expect(note).toContain("build(REVERT-NOTE-A): ship");
    expect(note).toContain("This is the body of the commit.");
  }, 20_000);

  it("a write-gate revert (entry-scope stray path) carries the offending path list in the note's details, per §5", async () => {
    await writePending(fx.repo, [makeEntry("REVERT-NOTE-B", ["src/rnb.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
      scopeWritesToEntry: true,
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      friction: "friction",
    };

    const agent = fanoutAgent({
      "revert-note-b": async (cwd) => {
        // A stray sibling inside the phase's writablePaths but outside the
        // entry's declared files — the built-in writable-paths gate reverts
        // this, and §5 calls out the write-gate's offending path list.
        await writeFile(join(cwd, "src", "rnb.ts"), "ok\n");
        await writeFile(join(cwd, "src", "stray.ts"), "stray\n");
        await exec("git", ["add", "."], { cwd });
        await exec(
          "git",
          ["commit", "-q", "-m", "build(REVERT-NOTE-B): overreach"],
          { cwd },
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual([]);

    const frictionDir = join(fx.repo, ".flume", "friction");
    const files = await readdir(frictionDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/--REVERT-NOTE-B--reverted\.md$/);

    const note = await readFile(join(frictionDir, files[0]!), "utf8");
    expect(note).toContain("writable-paths");
    expect(note).toContain(
      "src/stray.ts (inside phase writablePaths but outside",
    );
    expect(note).not.toContain("- src/rnb.ts");
    expect(note).toContain("build(REVERT-NOTE-B): overreach");
  }, 20_000);

  it("an undeclared Chain.friction is a no-op — no note is written on revert", async () => {
    await writePending(fx.repo, [makeEntry("REVERT-NOTE-C", ["src/rnc.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const failing: Gate = {
      name: "boom-gate",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "boom said no", details: "d" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failing],
    });
    // No `friction` field on the chain — §5 is entirely off, per §2.
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({
      "revert-note-c": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/rnc.ts",
          "ok\n",
          "build(REVERT-NOTE-C): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();

    expect(outcome.result?.shippedTags).toEqual([]);
    expect(existsSync(join(fx.repo, ".flume", "friction"))).toBe(false);
  }, 20_000);

  it("a note-write failure (unwritable friction dir) logs and does not block the revert", async () => {
    await writePending(fx.repo, [makeEntry("REVERT-NOTE-D", ["src/rnd.ts"])]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    // Pre-seed a plain file at the exact primary friction dir path so the
    // note write's `mkdir(primaryDir, { recursive: true })` fails —
    // standing in for the locked-dir/permission class §5 calls out.
    await mkdir(join(fx.repo, ".flume"), { recursive: true });
    await writeFile(join(fx.repo, ".flume", "friction"), "not a directory\n");

    const failing: Gate = {
      name: "boom-gate",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "boom said no", details: "d" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failing],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      friction: "friction",
    };

    const warnings: string[] = [];
    const log: Logger = {
      info: () => {},
      warn: (l) => warnings.push(l),
      error: () => {},
    };

    const agent = fanoutAgent({
      "revert-note-d": async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/rnd.ts",
          "ok\n",
          "build(REVERT-NOTE-D): ship",
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log,
    });

    const outcome = await dispatcher.tick();

    // The revert still proceeds despite the note-write failure.
    expect(outcome.result?.shippedTags).toEqual([]);
    expect((await readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      "REVERT-NOTE-D",
    ]);
    expect(
      warnings.some(
        (w) =>
          w.includes("REVERT-NOTE-D") &&
          w.includes("revert note write failed"),
      ),
    ).toBe(true);
  }, 20_000);

  // Runs on every platform (§9, v0.11): createWorktree derives the fanout
  // worktree directory from a length-bounded name, not the raw tag slug, so
  // a TAG_MAX_LENGTH tag no longer hits git's own ~200-char win32 worktree-
  // path refusal ("fatal: '$GIT_DIR' too big"). The fanoutAgent key below
  // is `worktreeDirName(tag)` — the bounded directory name — not the raw
  // slug the tag would otherwise produce.
  it(
    "a gate-revert on the longest tag parsePending accepts writes a revert-note filename within NAME_MAX — the schema's ceiling driven through the real writer (TAG-LENGTH-BOUND-AGREEMENT-PIN)",
    async () => {
    const tag = "A".repeat(TAG_MAX_LENGTH);
    await writePending(fx.repo, [makeEntry(tag, ["src/tag-len.ts"])]);
    // The real reader accepts the boundary tag — a value one over would
    // fail TAG_PATTERN and never reach the writer this test pins.
    expect((await readPendingFromDisk(fx.repo)).map((e) => e.tag)).toEqual([
      tag,
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const failing: Gate = {
      name: "boom-gate",
      when: "afterCommit",
      async run() {
        return { ok: false, message: "boom said no", details: "d" };
      },
    };
    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [failing],
    });
    const chain: Chain = {
      phases: [phase],
      humanOnly: [],
      friction: "friction",
    };

    const dirName = worktreeDirName(tag);
    const agent = fanoutAgent({
      [dirName]: async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/tag-len.ts",
          "ok\n",
          `build(${tag}): ship`,
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.result?.shippedTags).toEqual([]);

    // The real writer, driven by the real schema's own accepted maximum: if
    // either side's arithmetic moves without the other, writeRevertNote's
    // filename exceeds NAME_MAX, the write throws, and no note lands.
    const frictionDir = join(fx.repo, ".flume", "friction");
    const files = await readdir(frictionDir);
    expect(files.length).toBe(1);
    expect(files[0]!.length).toBeLessThanOrEqual(255);
    expect(files[0]).toContain(tag);
    },
    20_000,
  );

  it("two tags sharing a long common prefix provision distinct worktree directories (WORKTREE-DIRNAME-LENGTH-BOUND)", async () => {
    const prefix = "SHARED-PREFIX-".repeat(10);
    const tagA = `${prefix}A`;
    const tagB = `${prefix}B`;
    await writePending(fx.repo, [
      makeEntry(tagA, ["src/dirname-a.ts"]),
      makeEntry(tagB, ["src/dirname-b.ts"]),
    ]);
    new Baton(join(fx.repo, ".flume")).wake("build");

    const phase = makePhase({ name: "build", concurrency: "fanout" });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const dirA = worktreeDirName(tagA);
    const dirB = worktreeDirName(tagB);
    expect(dirA).not.toBe(dirB);

    const agent = fanoutAgent({
      [dirA]: async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/dirname-a.ts",
          "ok\n",
          `build(${tagA}): ship`,
        );
      },
      [dirB]: async (cwd) => {
        await writeAndCommit(
          cwd,
          "src/dirname-b.ts",
          "ok\n",
          `build(${tagB}): ship`,
        );
      },
    });

    const dispatcher = new Dispatcher({
      chainLoader: staticLoader(chain),
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent,
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(new Set(outcome.result?.shippedTags)).toEqual(
      new Set([tagA, tagB]),
    );
  }, 20_000);
});

// win32 lane (v0.4 §6): fanout worktree paths nest as deep as job dirs and
// hit the identical MAX_PATH gap job.ts's own baseline pin exists to spare
// (mirrored coverage in tests/git.test.ts for the shared helper itself).
// TAG-LENGTH-BOUND-AGREEMENT-PIN above now runs on win32 too (§9, v0.11):
// createWorktree's fanout worktree directory is length-bounded, so a
// long-tag fanout path stays clear of the ~200-char wall `git worktree add`
// itself refuses at — below MAX_PATH and unaffected by core.longpaths. The
// createWorktree/prior-attempt cases below stay deep only via
// chain.friction/namespace nesting that fs operations (not `git worktree
// add` itself) walk, which core.longpaths does cover.
describe.runIf(process.platform === "win32")(
  "Dispatcher fanout — createWorktree pins core.longpaths (v0.4 §6)",
  () => {
    it("pins core.longpaths on repoRoot before git worktree add", async () => {
      const entries = [makeEntry("W32-WT", ["src/w32.ts"])];
      await writePending(fx.repo, entries);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      const chain: Chain = { phases: [phase], humanOnly: [] };
      const agent = fanoutAgent({
        "w32-wt": (cwd) =>
          writeAndCommit(cwd, "src/w32.ts", "ok\n", "build(W32-WT): ship"),
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();
      expect(outcome.result?.shippedTags).toEqual(["W32-WT"]);

      const { stdout } = await exec(
        "git",
        ["config", "--local", "--get", "core.longpaths"],
        { cwd: fx.repo },
      );
      expect(stdout.trim()).toBe("true");
    }, 30_000);

    it("writeRevertNote lands the note when the friction dir's own total path exceeds win32's ~260-char limit (WRITEREVERTNOTE-WIN32-PATH-TOTAL-LIMIT)", async () => {
      const tag = "LONGFRICTION-A";
      await writePending(fx.repo, [
        makeEntry(tag, ["src/longfriction-a.ts"]),
      ]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const failing: Gate = {
        name: "boom-gate",
        when: "afterCommit",
        async run() {
          return { ok: false, message: "boom said no" };
        },
      };
      const phase = makePhase({
        name: "build",
        concurrency: "fanout",
        gates: [failing],
      });
      // A friction channel nested deep enough that <flumeDir>/<friction>
      // alone clears win32's ~260-char total-path limit, independent of
      // the host tmpdir's own depth — TAG_MAX_LENGTH bounds only the
      // note's filename component (TAG-LENGTH-BOUND-AGREEMENT-PIN above),
      // never the friction dir's own depth.
      const deepFriction = join(
        "friction",
        ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
      );
      const chain: Chain = {
        phases: [phase],
        humanOnly: [],
        friction: deepFriction,
      };

      const slug = tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      const agent = fanoutAgent({
        [slug]: async (cwd) => {
          await writeAndCommit(
            cwd,
            "src/longfriction-a.ts",
            "ok\n",
            `build(${tag}): ship`,
          );
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();
      expect(outcome.result?.shippedTags).toEqual([]);

      const frictionDir = join(fx.repo, ".flume", deepFriction);
      expect(frictionDir.length).toBeGreaterThan(260);
      const files = await readdir(frictionDir);
      expect(files.length).toBe(1);
      expect(files[0]).toContain(tag);
    }, 20_000);

    it("harvestFriction moves the worktree-local file into the primary dir when the friction channel nests past win32's ~260-char limit (HARVESTFRICTION-WIN32-PATH-TOTAL-LIMIT)", async () => {
      const tag = "LONGFRICTION-B";
      await writePending(fx.repo, [
        makeEntry(tag, ["src/longfriction-b.ts"]),
      ]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      const phase = makePhase({ name: "build", concurrency: "fanout" });
      // Same deep-friction shape as WRITEREVERTNOTE-WIN32-PATH-TOTAL-LIMIT
      // above: <flumeDir>/<friction> alone clears win32's ~260-char total-
      // path limit, and harvestFriction's mirrorDir nests the (already deep,
      // per createWorktree's own MAX_PATH comment) worktree path under the
      // same friction value, so it clears the limit by an even wider margin.
      const deepFriction = join(
        "friction",
        ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
      );
      const chain: Chain = {
        phases: [phase],
        humanOnly: [],
        friction: deepFriction,
      };

      const slug = tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      const agent = fanoutAgent({
        [slug]: async (cwd) => {
          const mirrorDir = join(cwd, ".flume", deepFriction);
          await mkdir(mirrorDir, { recursive: true });
          await writeFile(
            join(mirrorDir, "note.md"),
            "the loop wants owner input\n",
          );
          await writeAndCommit(
            cwd,
            "src/longfriction-b.ts",
            "ok\n",
            `build(${tag}): ship`,
          );
        },
      });

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const outcome = await dispatcher.tick();
      expect(outcome.result?.shippedTags).toEqual([tag]);

      const primaryFrictionDir = join(fx.repo, ".flume", deepFriction);
      expect(primaryFrictionDir.length).toBeGreaterThan(260);
      const files = await readdir(primaryFrictionDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(new RegExp(`^${tag}--\\d{4}-\\d{2}-\\d{2}T.*--note\\.md$`));
      expect(await readFile(join(primaryFrictionDir, files[0]!), "utf8")).toBe(
        "the loop wants owner input\n",
      );
    }, 20_000);

    it("frictionCountLine resolves a real count when chain.friction nests past win32's ~260-char limit (FRICTIONCOUNT-WIN32-PATH-TOTAL-LIMIT)", async () => {
      const stateRoot = await mkdtemp(join(tmpdir(), "flume-fcl-w32-"));
      try {
        // Same deep-friction shape as WRITEREVERTNOTE-WIN32-PATH-TOTAL-LIMIT
        // / HARVESTFRICTION-WIN32-PATH-TOTAL-LIMIT above: join(stateRoot,
        // chain.friction) alone clears win32's ~260-char total-path limit.
        const deepFriction = join(
          "friction",
          ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        );
        const frictionDir = join(stateRoot, deepFriction);
        await mkdir(frictionDir, { recursive: true });
        await writeFile(join(frictionDir, "a.md"), "x\n");
        await writeFile(join(frictionDir, "b.md"), "y\n");

        expect(frictionDir.length).toBeGreaterThan(260);
        const chain: Chain = { phases: [], humanOnly: [], friction: deepFriction };
        expect(await frictionCountLine(stateRoot, chain)).toBe(
          "friction: 2 note(s) await routing",
        );
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    }, 20_000);

    it("snapshotRevertedFiles lands the snapshot when the reverted commit's own diff path pushes prior-attempts/<key>.reverted/<rel> past win32's ~260-char limit (SNAPSHOTREVERTEDFILES-WIN32-PATH-TOTAL-LIMIT)", async () => {
      // snapshotRevertedFiles runs on the singleton afterCommit-revert path
      // (§8, e.g. a plan tick's schema-invalid pending.json) — unlike
      // WRITEREVERTNOTE-A/HARVESTFRICTION-B above (fanout, depth from
      // chain.friction), the depth driver here is the reverted commit's own
      // diff path: snapshotRevertedFiles joins prior-attempts/<key>.reverted
      // with whatever `git show --name-only` reports, unwrapped.
      const baton = new Baton(join(fx.repo, ".flume"));
      baton.wake("plan");

      const failing: Gate = {
        name: "boom-gate",
        when: "afterCommit",
        async run() {
          return { ok: false, message: "boom said no" };
        },
      };
      const phase = makePhase({
        name: "plan",
        concurrency: "singleton",
        gates: [failing],
      });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const deepRel = join(
        "src",
        ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        "deep.ts",
      );
      const agent: Agent = {
        name: "deep-diff-singleton",
        async invoke(inv) {
          await writeAndCommit(
            inv.cwd,
            deepRel,
            "ok\n",
            "plan: touch a deeply-nested path",
          );
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const preHead = await head(fx.repo);
      const outcome = await dispatcher.tick();
      expect(outcome.result?.committed).toBe(false);
      expect(outcome.noCommit).toBe("gate-revert");
      expect(await head(fx.repo)).toBe(preHead);

      const snapshotPath = join(
        fx.repo,
        ".flume",
        "prior-attempts",
        "plan.reverted",
        deepRel,
      );
      expect(snapshotPath.length).toBeGreaterThan(260);
      expect(existsSync(snapshotPath)).toBe(true);
      expect(await readFile(snapshotPath, "utf8")).toBe("ok\n");
    }, 20_000);

    it("snapshotRevertedFiles clears a deep-path stale snapshot before rewriting on a repeat revert under the same key (SNAPSHOTREVERTEDFILES-RM-WIN32-PATH-TOTAL-LIMIT: repeat revert)", async () => {
      // Same singleton/afterCommit-revert shape as SNAPSHOTREVERTEDFILES-
      // WIN32-PATH-TOTAL-LIMIT above, but ticked twice under the same
      // priorAttemptKey ("plan"): snapshotRevertedFiles' own stale-snapshot
      // `rm(dir, ...)` runs before it rewrites, unwrapped — on a real win32
      // host that rm throws ENAMETOOLONG walking attempt 0's deep tree,
      // silently swallowed by the best-effort catch, so attempt 1 never
      // updates the snapshot at all: attempt 0's stale file survives and
      // attempt 1's is never written.
      const baton = new Baton(join(fx.repo, ".flume"));
      baton.wake("plan");

      const failing: Gate = {
        name: "boom-gate",
        when: "afterCommit",
        async run() {
          return { ok: false, message: "boom said no" };
        },
      };
      const phase = makePhase({
        name: "plan",
        concurrency: "singleton",
        gates: [failing],
      });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const deepRelA = join(
        "src",
        ...Array.from({ length: 6 }, (_, i) => `sega-${i}-`.padEnd(50, "x")),
        "deep.ts",
      );
      const deepRelB = join(
        "src",
        ...Array.from({ length: 6 }, (_, i) => `segb-${i}-`.padEnd(50, "x")),
        "deep.ts",
      );

      let attempt = 0;
      const agent: Agent = {
        name: "deep-diff-repeat-revert",
        async invoke(inv) {
          const n = attempt++;
          const rel = n === 0 ? deepRelA : deepRelB;
          const content = n === 0 ? "first\n" : "second\n";
          await writeAndCommit(inv.cwd, rel, content, `plan: attempt ${n}`);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const first = await dispatcher.tick();
      expect(first.result?.committed).toBe(false);
      expect(first.noCommit).toBe("gate-revert");

      const snapDir = join(fx.repo, ".flume", "prior-attempts", "plan.reverted");
      const pathA = join(snapDir, deepRelA);
      expect(pathA.length).toBeGreaterThan(260);
      expect(existsSync(pathA)).toBe(true);
      expect(await readFile(pathA, "utf8")).toBe("first\n");

      baton.wake("plan");
      const second = await dispatcher.tick();
      expect(second.result?.committed).toBe(false);
      expect(second.noCommit).toBe("gate-revert");

      const pathB = join(snapDir, deepRelB);
      expect(pathB.length).toBeGreaterThan(260);
      expect(existsSync(pathB)).toBe(true);
      expect(await readFile(pathB, "utf8")).toBe("second\n");
      // Attempt 0's stale tree is gone, not merged alongside attempt 1's.
      expect(existsSync(pathA)).toBe(false);
    }, 20_000);

    it("clearPriorAttempt clears a deep-path stale snapshot on a clean ship without the tick throwing (SNAPSHOTREVERTEDFILES-RM-WIN32-PATH-TOTAL-LIMIT: clean ship)", async () => {
      // clearPriorAttempt's own `rm(revertedSnapshotDir(key), ...)` is
      // unwrapped and runs with no surrounding try/catch on its caller path
      // (runSingleton's clean-ship branch) — on a real win32 host, clearing
      // a deep snapshot left by a prior deep-path revert throws ENAMETOOLONG
      // out of the tick instead of just leaving the recovery artifact stale.
      const baton = new Baton(join(fx.repo, ".flume"));
      baton.wake("plan");

      let calls = 0;
      const failing: Gate = {
        name: "boom-gate",
        when: "afterCommit",
        async run() {
          calls++;
          return calls === 1
            ? { ok: false, message: "boom said no" }
            : { ok: true, message: "pending.json parsed (0 entries)" };
        },
      };
      const phase = makePhase({
        name: "plan",
        concurrency: "singleton",
        gates: [failing],
      });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const deepRel = join(
        "src",
        ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        "deep.ts",
      );

      let attempt = 0;
      const agent: Agent = {
        name: "deep-diff-clean-ship",
        async invoke(inv) {
          const n = attempt++;
          if (n === 0) {
            await writeAndCommit(
              inv.cwd,
              deepRel,
              "ok\n",
              "plan: touch a deeply-nested path",
            );
          } else {
            await writeAndCommit(
              inv.cwd,
              "src/shallow.ts",
              "ok\n",
              "plan: clean ship",
            );
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const first = await dispatcher.tick();
      expect(first.result?.committed).toBe(false);
      expect(first.noCommit).toBe("gate-revert");

      const snapDir = join(fx.repo, ".flume", "prior-attempts", "plan.reverted");
      const snapPath = join(snapDir, deepRel);
      expect(snapPath.length).toBeGreaterThan(260);
      expect(existsSync(snapPath)).toBe(true);

      baton.wake("plan");
      const second = await dispatcher.tick();
      expect(second.result?.committed).toBe(true);
      expect(existsSync(snapDir)).toBe(false);
    }, 20_000);

    // createWorktree's fanout worktree path is now bounded by
    // worktreeDirName (§9, v0.11), so a TAG_MAX_LENGTH tag no longer hits
    // git's own ~200-char win32 worktree-path refusal — this test reaches
    // the §5 round-trip it exists to pin instead of failing on git's
    // refusal first.
    it("readPriorAttempt/writePriorAttempt/clearPriorAttempt round-trip a §5 record when priorAttemptPath itself nests past win32's ~260-char limit (PRIORATTEMPT-WIN32-PATH-TOTAL-LIMIT)", async () => {
      // Unlike SNAPSHOTREVERTEDFILES-WIN32-PATH-TOTAL-LIMIT above (depth
      // from the reverted commit's own diff path), the depth driver here is
      // the §5 record's own flat filename: priorAttemptPath is
      // `<flumeDir>/prior-attempts/<key>.json` with no further nesting, so
      // only the fanout key (slugify(entry.tag), bounded by the real
      // TAG_PATTERN/TAG_MAX_LENGTH schema gate) can push it past 260 — the
      // longest tag the schema accepts, driven through the real writer.
      // priorAttemptKey keeps the untruncated slug (§9) even though
      // createWorktree's own directory name is now bounded, so this path is
      // still as deep as before.
      const tag = "A".repeat(TAG_MAX_LENGTH);
      await writePending(fx.repo, [
        makeEntry(tag, ["src/priorattempt-w32.ts"]),
      ]);
      new Baton(join(fx.repo, ".flume")).wake("build");

      let calls = 0;
      const gate: Gate = {
        name: "boom-gate",
        when: "afterCommit",
        async run() {
          calls++;
          return calls === 1
            ? { ok: false, message: "boom said no" }
            : { ok: true, message: "second attempt passes" };
        },
      };
      const phase = makePhase({
        name: "build",
        concurrency: "fanout",
        gates: [gate],
      });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const slug = tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      let attempt = 0;
      const prompts: string[] = [];
      const agent: Agent = {
        name: "priorattempt-w32-agent",
        async invoke(inv) {
          prompts.push(inv.prompt);
          const n = attempt++;
          await writeAndCommit(
            inv.cwd,
            "src/priorattempt-w32.ts",
            n === 0 ? "first\n" : "second\n",
            `build(${tag}): attempt ${n}`,
          );
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };

      const dispatcher = new Dispatcher({
        chainLoader: staticLoader(chain),
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
      });

      const first = await dispatcher.tick();
      expect(first.result?.shippedTags).toEqual([]);

      const priorAttemptPath = join(
        fx.repo,
        ".flume",
        "prior-attempts",
        `${slug}.json`,
      );
      expect(priorAttemptPath.length).toBeGreaterThan(260);
      // writePriorAttempt's mkdir/writeFile landed the record instead of
      // throwing ENAMETOOLONG.
      expect(existsSync(priorAttemptPath)).toBe(true);

      new Baton(join(fx.repo, ".flume")).wake("build");
      const second = await dispatcher.tick();
      expect(second.result?.shippedTags).toEqual([tag]);

      // readPriorAttempt actually decoded the deep-path record rather than
      // existsSync silently reporting "no prior attempt": the gate-revert
      // block, carrying the first gate's own failure message, lands in the
      // second attempt's rendered prompt.
      expect(prompts[1]).toContain("<prior-attempt>");
      expect(prompts[1]).toContain("boom said no");

      // clearPriorAttempt removed the deep-path record after the clean
      // ship-and-merge.
      expect(existsSync(priorAttemptPath)).toBe(false);
    }, 20_000);

    // WORKTREE-WIN32-PATH-TOTAL-LIMIT (fresh create + stale cleanup)
    // retired: operator ruling on a real win32 host found `git worktree
    // add` itself refusing a namespace/slug path around ~200 chars
    // ("fatal: '$GIT_DIR' too big"), below win32's ~260-char total-path
    // limit and unaffected by core.longpaths — the exact depth these two
    // cases drove the namespace to in order to exercise createWorktree's
    // deep-path handling. The claim they pinned (createWorktree succeeds
    // past 260 chars) is untestable through real fanout on win32; kept in
    // the suite the two cases would run zero-width on any other platform
    // (this describe block is win32-only), which is the vacuity the
    // "green verdict is non-vacuous" standard rules out rather than files.
  },
);

describe("src/index.ts — ProvisionFailure/TerminalMisconfiguration barrel export (DISPATCHER-PROVISIONFAILURE-TERMINALMISCONFIG-UNEXPORTED)", () => {
  it("re-exports ProvisionFailure and TerminalMisconfiguration as named types a chain author can consume", () => {
    // The imported types (line 58, from src/index.ts rather than
    // src/Dispatcher.ts) are what a chain author would actually reach for to
    // type their own handling of TickVerdict.provisionFailures / TickOutcome
    // .terminal — if either drops from the barrel this fails tsc, not just
    // an LSP references check.
    const provisionFailure: ProvisionFailure = {
      tag: "SOME-ENTRY",
      signature: "worktree-create-failed",
      message: "git worktree add failed: ...",
    };
    const terminalMisconfiguration: TerminalMisconfiguration = {
      kind: "orphaned-awake",
      phases: ["build"],
    };

    expect(provisionFailure.tag).toBe("SOME-ENTRY");
    expect(terminalMisconfiguration.kind).toBe("orphaned-awake");
  });
});

describe("src/index.ts — NoCommitMode barrel export (PROMPT-NOCOMMITMODE-UNEXPORTED)", () => {
  it("re-exports NoCommitMode as a named type a chain author can consume", () => {
    // The imported type (line 65, from src/index.ts rather than
    // src/Prompt.ts) is what a chain author would actually reach for to
    // type their own handling of TickVerdict.noCommit / TickOutcome.noCommit
    // / TickResult.noCommit — if it drops from the barrel this fails tsc,
    // not just an LSP references check.
    const noCommit: NoCommitMode = "gate-revert";

    expect(noCommit).toBe("gate-revert");
  });
});
