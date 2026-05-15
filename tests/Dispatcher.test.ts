import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Dispatcher, type Logger } from "../src/Dispatcher.ts";
import type { Agent } from "../src/Agent.ts";
import { Baton } from "../src/Baton.ts";
import type { Gate } from "../src/Gate.ts";
import type { Chain, Phase } from "../src/Phase.ts";
import { parsePending, type PendingEntry } from "../src/PendingSchema.ts";

const exec = promisify(execFile);

const silent: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

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
      const slug = inv.cwd.split("/").pop()!;
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
    new Baton(fx.repo).wake("plan");

    const phase = makePhase({
      name: "plan",
      concurrency: "singleton",
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = singleAgent(async (cwd) => {
      await writeAndCommit(cwd, "src/plan-output.ts", "ok\n", "plan: derive");
    });

    const dispatcher = new Dispatcher({
      chain,
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
    new Baton(fx.repo).wake("plan");

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
      chain,
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
    new Baton(fx.repo).wake("plan");

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
      chain,
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
    const baton = new Baton(fx.repo);
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
      chain,
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
    const baton = new Baton(fx.repo);
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
      chain,
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
      chain,
      repoRoot: fx.repo,
      configDir: fx.configDir,
      agent: singleAgent(async () => {}),
      log: silent,
    });

    const outcome = await dispatcher.tick();
    expect(outcome.hibernated).toBe(true);
    expect(outcome.phaseName).toBeUndefined();
    expect(outcome.awakeAfter).toEqual([]);
  });
});

// ---------- fanout ----------

describe("Dispatcher fanout — two disjoint entries both ship", () => {
  it(
    "cherry-picks both worktree commits onto trunk, updates pending.json, sets shippedTags",
    async () => {
      const entries = [
        makeEntry("TEST-A", ["src/a.ts"]),
        makeEntry("TEST-B", ["src/b.ts"]),
      ];
      await writePending(fx.repo, entries);
      new Baton(fx.repo).wake("build");

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
        chain,
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
      expect(existsSync(join(fx.repo, ".flume", "worktrees", "test-a"))).toBe(false);
      expect(existsSync(join(fx.repo, ".flume", "worktrees", "test-b"))).toBe(false);
    },
    20_000,
  );
});

describe("Dispatcher fanout — cherry-pick conflict leaves the conflicting entry in pending", () => {
  it(
    "ships the first entry; second cherry-pick aborts; entry persists in pending",
    async () => {
      // Both fake agents write to the same baseline file with different
      // content. Declared paths are disjoint so partition packs them together.
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
      new Baton(fx.repo).wake("build");

      const phase = makePhase({
        name: "build",
        concurrency: "fanout",
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
        chain,
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
    },
    20_000,
  );
});

describe("Dispatcher fanout — afterMerge gate failure reverts the wave", () => {
  it(
    "hard-resets trunk to preHead, leaves pending untouched, reports empty shippedTags",
    async () => {
      const entries = [
        makeEntry("WAVE-A", ["src/wa.ts"]),
        makeEntry("WAVE-B", ["src/wb.ts"]),
      ];
      await writePending(fx.repo, entries);
      new Baton(fx.repo).wake("build");

      const preHead = await head(fx.repo);

      const failingAfterMerge: Gate = {
        name: "wave-veto",
        when: "afterMerge",
        async run() {
          return { ok: false, message: "wave veto" };
        },
      };

      const phase = makePhase({
        name: "build",
        concurrency: "fanout",
        gates: [failingAfterMerge],
      });
      const chain: Chain = { phases: [phase], humanOnly: [] };

      const agent = fanoutAgent({
        "wave-a": (cwd) =>
          writeAndCommit(cwd, "src/wa.ts", "A\n", "build(WAVE-A)"),
        "wave-b": (cwd) =>
          writeAndCommit(cwd, "src/wb.ts", "B\n", "build(WAVE-B)"),
      });

      const dispatcher = new Dispatcher({
        chain,
        repoRoot: fx.repo,
        configDir: fx.configDir,
        agent,
        log: silent,
        maxParallel: 4,
      });

      const outcome = await dispatcher.tick();

      // Wave reverted: trunk back where it started, nothing shipped.
      expect(await head(fx.repo)).toBe(preHead);
      expect(outcome.result?.committed).toBe(false);
      expect(outcome.result?.shippedTags).toEqual([]);

      // The cherry-pick winners' files don't survive on trunk.
      expect(existsSync(join(fx.repo, "src", "wa.ts"))).toBe(false);
      expect(existsSync(join(fx.repo, "src", "wb.ts"))).toBe(false);

      // pending.json untouched — re-deriving sees both entries.
      const onDisk = await readPendingFromDisk(fx.repo);
      expect(onDisk.map((e) => e.tag)).toEqual(["WAVE-A", "WAVE-B"]);
      expect(outcome.result?.pendingAfter.map((e) => e.tag)).toEqual([
        "WAVE-A",
        "WAVE-B",
      ]);

      // The failing afterMerge gate is recorded in gateResults.
      const gateRecord = outcome.result?.gateResults ?? [];
      expect(
        gateRecord.some((g) => g.gate === "wave-veto" && !g.ok),
      ).toBe(true);
    },
    20_000,
  );
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
    new Baton(fx.repo).wake("build");

    const phase = makePhase({
      name: "build",
      concurrency: "fanout",
      gates: [],
    });
    const chain: Chain = { phases: [phase], humanOnly: [] };

    const agent = fanoutAgent({});

    const dispatcher = new Dispatcher({
      chain,
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
