import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  Dispatcher,
  loadChainModule,
  superviseLoop,
  EX_TERMINAL_MISCONFIG,
  type ChainModule,
  type DispatcherOptions,
  type Logger,
} from "../src/Dispatcher.ts";
import type { Agent } from "../src/Agent.ts";
import { Baton } from "../src/Baton.ts";
import { chainLoadGate } from "../src/builtinGates.ts";
import type { Gate } from "../src/Gate.ts";
import type { Chain, Phase } from "../src/Phase.ts";
import { parsePending, type PendingEntry } from "../src/PendingSchema.ts";

const exec = promisify(execFile);

const silent: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Inject a fixed chain as the per-tick resolver — the `chainLoader` test
 * seam (DispatcherOptions no longer takes a prebuilt `Chain`). Returns the
 * same chain every tick unless the test mutates a closed-over reference.
 */
function staticLoader(chain: Chain): () => Promise<ChainModule> {
  return () => Promise.resolve({ default: chain });
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
    summary: `${tag} entry`,
    per: { path: "spec/RELEASE-v0.1.md", section: "5. Tests" },
    gate: { kind: "open" },
    dependsOnForks: [],
    files: {
      new: [],
      edit: editPaths.map((p) => ({ path: p, description: "edit" })),
      retire: [],
    },
    schemaDelta: "none",
    tests: [],
    acceptance: "green",
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
 * (which equals the dispatcher's slug: tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-")).
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
      expect(aOutcome.result?.shippedTags).toEqual(["DUP-TAG"]);
      // Both entries landed on trunk; neither wave lost its commit.
      expect(await readFile(join(fx.repo, "src/dup-a.ts"), "utf8")).toBe("A\n");
      expect(await readFile(join(fx.repo, "src/dup-b.ts"), "utf8")).toBe("B\n");
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
    // Both fake agents write to the same baseline file with different
    // content. Declared paths are disjoint so partition packs them together;
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
      "conflict-a": (cwd) =>
        writeAndCommit(cwd, "src/shared.ts", "from-A\n", "build: A"),
      "conflict-b": (cwd) =>
        writeAndCommit(cwd, "src/shared.ts", "from-B\n", "build: B"),
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

  it("reverts a path outside entry scope but inside phase globs; the retry prompt names it", async () => {
    await writePending(fx.repo, [makeEntry("SCOPE-STRAY", ["src/a.ts"])]);
    const baton = new Baton(join(fx.repo, ".flume"));
    baton.wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      writablePaths: ["src/**"],
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
    expect(prompts[1]).not.toContain("- src/a.ts");

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
      Promise.resolve({ default: chain, forkResolver: () => () => false });

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
        `export default { phases: [{ name: "build", description: "", ` +
          `promptPath: "prompt.md", concurrency: "fanout", ` +
          `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
          `humanOnly: [] };\n` +
          // Nothing resolved — the only entry rests on an open fork.
          `export const forkResolver = () => () => false;\n`,
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
      Promise.resolve({ default: chain, agent: chainAgent });

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
        `export default { phases: [{ name: "ondisk", description: "", ` +
          `promptPath: "prompt.md", concurrency: "singleton", ` +
          `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
          `humanOnly: [] };\n`,
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
      `export default { phases: [{ name: "build", description: "", ` +
      `promptPath: "prompt.md", concurrency: "singleton", ` +
      `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
      `humanOnly: [] };\n`;
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
      `export default { phases: [{ name: "build", description: "", ` +
      `promptPath: "prompt.md", concurrency: "singleton", ` +
      `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
      `humanOnly: [] };\n`;
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

  it("ungated resolution failure: child exits non-zero → supervisor logs and proceeds, never crashes (§3)", async () => {
    new Baton(join(fx.repo, ".flume")).wake("plan"); // a failed tick does no baton work

    const warns: string[] = [];
    const rec: Logger = {
      info: () => {},
      warn: (l) => warns.push(l),
      error: () => {},
    };

    let calls = 0;
    const runTick = (): Promise<{ exitCode: number | null }> => {
      calls++;
      return Promise.resolve({ exitCode: 1 });
    };

    const res = await superviseLoop({
      repoRoot: fx.repo,
      maxTicks: 3,
      runTick,
      log: rec,
    });

    // Never throws; proceeds every iteration; bounded only by --max.
    expect(calls).toBe(3);
    expect(res.ticks).toBe(3);
    expect(res.hibernated).toBe(false);
    expect(warns.filter((w) => /exited with code 1/.test(w)).length).toBe(3);
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

describe("Dispatcher — Chain.friction load-time validation (§2)", () => {
  // A minimal, otherwise-valid chain.ts; only the `friction` field varies
  // per test. `frictionSource` is a raw TS expression (or "" to omit the
  // field entirely) spliced into the default export's object literal.
  async function writeChainWithFriction(
    cfg: string,
    frictionSource: string,
  ): Promise<void> {
    await writeFile(join(cfg, "prompt.md"), "dummy\n", "utf8");
    await writeFile(
      join(cfg, "chain.ts"),
      `export default { phases: [{ name: "build", description: "", ` +
        `promptPath: "prompt.md", concurrency: "singleton", ` +
        `writablePaths: ["**"], gates: [], handoff: () => [] }], ` +
        `humanOnly: []${frictionSource ? `, friction: ${frictionSource}` : ""} };\n`,
      "utf8",
    );
  }

  it("rejects an absolute-path friction declaration with a usage-shaped error", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-friction-abs-"));
    try {
      const abs = resolve(tmpdir(), "flume-friction-abs-target");
      await writeChainWithFriction(cfg, JSON.stringify(abs));

      await expect(loadChainModule(join(cfg, "chain.ts"))).rejects.toThrow(
        /friction .* as an absolute path/,
      );
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("rejects a friction declaration that resolves outside the state root", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-friction-escape-"));
    try {
      await writeChainWithFriction(cfg, JSON.stringify("../escaped-friction"));

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
      await writeChainWithFriction(cfg, JSON.stringify("friction"));

      const mod = await loadChainModule(join(cfg, "chain.ts"));

      expect(mod.default.friction).toBe("friction");
    } finally {
      await rm(cfg, { recursive: true, force: true });
    }
  });

  it("treats an undeclared friction field as a strict no-op — chain loads unaffected", async () => {
    const cfg = await mkdtemp(join(tmpdir(), "flume-cfg-friction-undeclared-"));
    try {
      await writeChainWithFriction(cfg, "");

      const mod = await loadChainModule(join(cfg, "chain.ts"));

      expect(mod.default.friction).toBeUndefined();
      expect(mod.default.phases).toHaveLength(1);
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

    const harvested = join(fx.repo, ".flume", "friction", "FRICTION-A--note.md");
    expect(existsSync(harvested)).toBe(true);
    expect(await readFile(harvested, "utf8")).toBe(
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
    // Pre-seed a directory at the exact destination the harvest would
    // rename into — rename(file, existing-dir) fails deterministically,
    // standing in for the locked-file / unreadable-dir class §4 calls out.
    await mkdir(join(primaryFrictionDir, "FRICTION-B--note.md"), {
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

    const outcome = await dispatcher.tick();

    // The wave still ships despite the harvest failure.
    expect(outcome.result?.shippedTags).toEqual(["FRICTION-B"]);
    expect(warnings.some((w) => w.includes("note.md"))).toBe(true);
    // The pre-seeded destination is untouched — the failed move left it as-is.
    expect(
      existsSync(join(primaryFrictionDir, "FRICTION-B--note.md")),
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
});
