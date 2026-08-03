/**
 * spec/loop.md, "Declining a tick before the invocation" — coverage for
 * `.flume/chain.ts`'s four load-bearing predicates: `plan.shouldRun`,
 * `plan.handoff`, `build.handoff`, and `setupBuildWorktree` (`build.setupWorktree`).
 *
 * Driven through the real chain factory — `loadChainModule` (the same
 * disk-based loader `flume tick` uses) for the three predicates that need no
 * I/O override, and a direct factory call layered on the real `buildFlumeApi()`
 * for `setupBuildWorktree`, whose one override (`setupWorktree`) stands in for
 * a real `pnpm install` the same way `tests/setupWorktree.test.ts` stands in
 * for the shell command underneath it — never a hand-copied reimplementation
 * of chain.ts's own sentinel-assertion logic (see
 * `tests/examples.integration.test.ts`, which drives `examples/` the same way).
 *
 * `plan.shouldRun` and `plan.handoff` read `<FLUME_DIR>/inbox.md` and
 * `<FLUME_DIR>/plan/state.md`; every test below points `FLUME_DIR` at a fresh
 * scratch directory so the real `.flume/inbox.md` / `.flume/plan/state.md`
 * are never read or written.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Phase, TickContext, TickResult, WorktreeSetupContext } from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import { loadChainModule } from "../src/Dispatcher.ts";
import { buildFlumeApi } from "../src/flumeApi.ts";
import chainFactory from "../.flume/chain.ts";

const CHAIN_PATH = fileURLToPath(new URL("../.flume/chain.ts", import.meta.url));

const EMPTY_INBOX =
  "# Inbox\n\nTransient queue.\n\n---\n\n<!-- entries below this line; newest first -->\n";
const NONEMPTY_INBOX = `${EMPTY_INBOX}\n## 2026-08-03 — test finding (human)\n\nbody\n`;

function makeEntry(
  tag: string,
  gate: PendingEntry["gate"],
  dependsOnForks: string[] = [],
): PendingEntry {
  return {
    tag,
    gate,
    dependsOnForks,
    files: { new: [], edit: [], retire: [] },
  };
}

function tickResult(overrides: Partial<TickResult> = {}): TickResult {
  return {
    phaseName: "build",
    committed: false,
    gateResults: [],
    pendingAfter: [],
    shippedTags: [],
    revertedTags: [],
    ...overrides,
  };
}

describe("plan/build predicates via the real .flume/chain.ts (loadChainModule)", () => {
  let plan: Phase;
  let build: Phase;
  let flumeDir: string;
  let priorFlumeDir: string | undefined;

  beforeAll(async () => {
    const { chain } = await loadChainModule(CHAIN_PATH);
    const planPhase = chain.phases.find((p) => p.name === "plan");
    const buildPhase = chain.phases.find((p) => p.name === "build");
    expect(planPhase?.shouldRun).toBeDefined();
    expect(buildPhase?.handoff).toBeDefined();
    plan = planPhase!;
    build = buildPhase!;
  });

  beforeEach(async () => {
    flumeDir = await mkdtemp(join(tmpdir(), "flume-chain-test-"));
    await mkdir(join(flumeDir, "plan"), { recursive: true });
    priorFlumeDir = process.env.FLUME_DIR;
    process.env.FLUME_DIR = flumeDir;
  });

  afterEach(async () => {
    if (priorFlumeDir === undefined) delete process.env.FLUME_DIR;
    else process.env.FLUME_DIR = priorFlumeDir;
    await rm(flumeDir, { recursive: true, force: true });
  });

  describe("plan.shouldRun", () => {
    it("declines when pending carries a pickable (open) entry and inbox.md is empty", async () => {
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      const ctx: TickContext = {
        cwd: flumeDir,
        flumeDir,
        pending: [makeEntry("OPEN-1", { kind: "open" })],
      };
      expect(plan.shouldRun!(ctx)).toBe(false);
    });

    it("runs on a non-empty inbox, even with a pickable entry queued", async () => {
      await writeFile(join(flumeDir, "inbox.md"), NONEMPTY_INBOX);
      const ctx: TickContext = {
        cwd: flumeDir,
        flumeDir,
        pending: [makeEntry("OPEN-1", { kind: "open" })],
      };
      expect(plan.shouldRun!(ctx)).toBe(true);
    });

    it("runs when inbox.md is missing entirely (fails open on an unreadable inbox)", () => {
      // No inbox.md written — inboxHasEntries()'s catch treats an unreadable
      // inbox as "run", never "decline".
      const ctx: TickContext = {
        cwd: flumeDir,
        flumeDir,
        pending: [makeEntry("OPEN-1", { kind: "open" })],
      };
      expect(plan.shouldRun!(ctx)).toBe(true);
    });

    it("runs on an empty queue", async () => {
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      const ctx: TickContext = { cwd: flumeDir, flumeDir, pending: [] };
      expect(plan.shouldRun!(ctx)).toBe(true);
    });

    it("runs on a parked-only queue", async () => {
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      const ctx: TickContext = {
        cwd: flumeDir,
        flumeDir,
        pending: [makeEntry("PARKED-1", { kind: "parked", reason: "needs a workshop" })],
      };
      expect(plan.shouldRun!(ctx)).toBe(true);
    });

    it("runs on a live-blocked queue (blockedBy an upstream tag that hasn't shipped)", async () => {
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      const ctx: TickContext = {
        cwd: flumeDir,
        flumeDir,
        pending: [makeEntry("BLOCKED-1", { kind: "blockedBy", tag: "STILL-PENDING-UPSTREAM" })],
      };
      expect(plan.shouldRun!(ctx)).toBe(true);
    });

    it("runs on a promotable-only queue (blockedBy a tag no longer in the queue, i.e. already shipped)", async () => {
      // chain.ts's own docstring names this gap: isPickableNow is called with
      // a fresh empty shippedTags Set here, so a blockedBy entry never reads
      // as pickable to this predicate regardless of whether its blocker has
      // actually shipped — the queue "takes the return true and plan runs".
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      const ctx: TickContext = {
        cwd: flumeDir,
        flumeDir,
        pending: [makeEntry("PROMOTABLE-1", { kind: "blockedBy", tag: "ALREADY-SHIPPED-TAG" })],
      };
      expect(plan.shouldRun!(ctx)).toBe(true);
    });

    it("runs when ctx.pending is undefined", async () => {
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      const ctx: TickContext = { cwd: flumeDir, flumeDir };
      expect(plan.shouldRun!(ctx)).toBe(true);
    });
  });

  describe("plan.handoff", () => {
    it("re-wakes plan when state.md declares 'Plan continues: yes', regardless of pendingAfter", async () => {
      await writeFile(join(flumeDir, "plan", "state.md"), "Plan continues: yes\n");
      const result = tickResult({ phaseName: "plan", pendingAfter: [] });
      expect(plan.handoff(result)).toEqual(["plan"]);
    });

    it("hands off to build when state.md says 'no' and a pickable entry remains", async () => {
      await writeFile(join(flumeDir, "plan", "state.md"), "Plan continues: no\n");
      const result = tickResult({
        phaseName: "plan",
        pendingAfter: [makeEntry("OPEN-1", { kind: "open" })],
      });
      expect(plan.handoff(result)).toEqual(["build"]);
    });

    it("hibernates when state.md says 'no' and nothing remains pickable", async () => {
      await writeFile(join(flumeDir, "plan", "state.md"), "Plan continues: no\n");
      const result = tickResult({ phaseName: "plan", pendingAfter: [] });
      expect(plan.handoff(result)).toEqual([]);
    });

    it("falls through to the pickability check when state.md carries no 'Plan continues:' line", async () => {
      await writeFile(join(flumeDir, "plan", "state.md"), "# State\n\nno marker here\n");
      const result = tickResult({
        phaseName: "plan",
        pendingAfter: [makeEntry("OPEN-1", { kind: "open" })],
      });
      expect(plan.handoff(result)).toEqual(["build"]);
    });

    it("falls through to the pickability check when state.md is missing entirely (an absent line)", () => {
      // No plan/state.md written at all — the readFileSync throw is caught
      // and treated the same as an explicit "no".
      const result = tickResult({
        phaseName: "plan",
        pendingAfter: [makeEntry("OPEN-1", { kind: "open" })],
      });
      expect(plan.handoff(result)).toEqual(["build"]);
    });
  });

  describe("build.handoff", () => {
    it("stays quiet on a true no-op wave: nothing shipped, no gates ran, no bail", () => {
      const result = tickResult({ phaseName: "build" });
      expect(build.handoff(result)).toEqual([]);
    });

    it("wakes plan when the wave shipped a tag", () => {
      const result = tickResult({ phaseName: "build", shippedTags: ["SHIPPED-1"] });
      expect(build.handoff(result)).toEqual(["plan"]);
    });

    it("wakes plan when gates ran even without a ship (a gate fire implies a MAINTAIN entry)", () => {
      const result = tickResult({
        phaseName: "build",
        gateResults: [{ gate: "tsc", ok: false, message: "type error" }],
      });
      expect(build.handoff(result)).toEqual(["plan"]);
    });

    it("wakes plan on a voluntary bail even with nothing shipped and no gates run", () => {
      const result = tickResult({ phaseName: "build", noCommit: "voluntary-bail" });
      expect(build.handoff(result)).toEqual(["plan"]);
    });
  });
});

describe("setupBuildWorktree (build.setupWorktree) — the sentinel assertion", () => {
  let worktree: string;

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), "flume-setup-worktree-test-"));
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
  });

  /**
   * `chain.ts`'s `setupBuildWorktree` always awaits the real install hook
   * first. Overriding just `setupWorktree` on the real `buildFlumeApi()` —
   * the same boundary `tests/setupWorktree.test.ts` mocks `execFile` at —
   * stands in for a real `pnpm install` completing without materializing the
   * dependency, so the test drives chain.ts's own sentinel-assertion code
   * rather than reimplementing it.
   */
  function buildChainWithFakeInstall(): Phase {
    const { chain } = chainFactory({
      ...buildFlumeApi(),
      setupWorktree: async () => {},
    });
    const build = chain.phases.find((p) => p.name === "build");
    expect(build?.setupWorktree).toBeDefined();
    return build!;
  }

  it("throws when node_modules/<sentinel>/package.json is missing after install", async () => {
    await writeFile(
      join(worktree, "package.json"),
      JSON.stringify({
        name: "worktree-fixture",
        version: "1.0.0",
        dependencies: { "some-dep": "1.0.0" },
      }),
    );
    const build = buildChainWithFakeInstall();
    const ctx: WorktreeSetupContext = {
      worktreePath: worktree,
      repoRoot: worktree,
      entryTag: "TEST",
    };

    await expect(build.setupWorktree!(ctx)).rejects.toThrow(
      /node_modules\/some-dep missing after install — dependency materialization failed/,
    );
  });

  it("passes when node_modules/<sentinel>/package.json is present", async () => {
    await writeFile(
      join(worktree, "package.json"),
      JSON.stringify({
        name: "worktree-fixture",
        version: "1.0.0",
        dependencies: { "some-dep": "1.0.0" },
      }),
    );
    await mkdir(join(worktree, "node_modules", "some-dep"), { recursive: true });
    await writeFile(
      join(worktree, "node_modules", "some-dep", "package.json"),
      JSON.stringify({ name: "some-dep", version: "1.0.0" }),
    );
    const build = buildChainWithFakeInstall();
    const ctx: WorktreeSetupContext = {
      worktreePath: worktree,
      repoRoot: worktree,
      entryTag: "TEST",
    };

    await expect(build.setupWorktree!(ctx)).resolves.toBeUndefined();
  });
});
