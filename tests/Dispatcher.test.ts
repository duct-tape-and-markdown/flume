import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  Dispatcher,
  superviseLoop,
  type ChainModule,
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
    expect(outcome.awakeAfter).toEqual([]);
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
    expect(before).toContain(join(".flume", "worktrees", "race-a"));
    expect(before).toContain(join(".flume", "worktrees", "race-b"));

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

describe("Dispatcher fanout — cherry-pick conflict leaves the conflicting entry in pending", () => {
  it("ships the first entry; second cherry-pick aborts; entry persists in pending", async () => {
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
    new Baton(join(fx.repo, ".flume")).wake("build");

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
        const slug = inv.cwd.split("/").pop()!;
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
        const slug = inv.cwd.split("/").pop()!;
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
});
