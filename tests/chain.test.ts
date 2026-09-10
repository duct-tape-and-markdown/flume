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
 * `plan.shouldRun` reads `<flumeDir>/inbox.md` and `plan.handoff` reads
 * `<flumeDir>/plan/state.md`, taking the root from what the engine hands them
 * (`TickContext.flumeDir`, `TickResult.flumeDir`) — never from env. Every test
 * below passes a fresh scratch directory as that root so the real
 * `.flume/inbox.md` / `.flume/plan/state.md` are never read or written.
 */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Phase, TickContext, TickResult, WorktreeSetupContext } from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { TickVerdict, TickVerdictMergeOutcome } from "../src/Dispatcher.ts";
import {
  loadChainModule,
  readLatestVerdictsSync,
  slugify,
  priorAttemptPath,
  writeTickVerdict,
} from "../src/Dispatcher.ts";
import { buildFlumeApi, type FlumePaths } from "../src/flumeApi.ts";
import { readFileAtRef } from "../src/git.ts";
import { matchesAny } from "../src/paths.ts";
import chainFactory from "../.flume/chain.ts";

/**
 * The roots a real tick resolves for this repo's own chain: `.flume` is both
 * the config dir and the default state root, the repo above it is repoRoot.
 * `loadChainModule` derives `<configDir>/chain.ts` from these, so there is no
 * separate chain path to keep in step.
 */
const REPO_PATHS: FlumePaths = {
  repoRoot: fileURLToPath(new URL("..", import.meta.url)),
  configDir: fileURLToPath(new URL("../.flume", import.meta.url)),
  flumeDir: fileURLToPath(new URL("../.flume", import.meta.url)),
};

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
    pickableAfter: [],
    flumeDir: "/tmp/flume-test-flumeDir",
    configDir: "/tmp/flume-test-configDir",
    shippedTags: [],
    revertedTags: [],
    ...overrides,
  };
}

/**
 * A {@link TickVerdict} for `phaseName` whose only load-bearing content is
 * `mergeOutcomes` — the fact `plan.shouldRun`'s park leg reads. Every other
 * field carries the minimum a verdict record needs to survive the log's own
 * structural check; the tests below write these through the engine's real
 * `writeTickVerdict`, never a hand-rolled log line.
 */
function buildVerdict(
  phaseName: string,
  mergeOutcomes: TickVerdictMergeOutcome[],
): TickVerdict {
  return {
    phaseName,
    tags: mergeOutcomes.map((o) => o.tag),
    committed: true,
    gateResults: [],
    shippedTags: mergeOutcomes.filter((o) => o.outcome === "merged").map((o) => o.tag),
    mergeOutcomes,
    invocations: [],
    summary: mergeOutcomes.map((o) => `${o.tag}=${o.outcome}`).join(", "),
    headSha: "0".repeat(40),
    at: new Date().toISOString(),
  };
}

/** Run git in `repo`; trimmed stdout. */
function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

/** A fresh temp repo with commit identity pinned, for the gate fixtures below. */
async function initRepo(prefix: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
}

describe("plan/build predicates via the real .flume/chain.ts (loadChainModule)", () => {
  let plan: Phase;
  let build: Phase;
  let flumeDir: string;

  beforeAll(async () => {
    const { chain } = await loadChainModule(REPO_PATHS);
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
  });

  afterEach(async () => {
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
        pending: [makeEntry("BLOCKED-1", { kind: "blockedBy", tags: ["STILL-PENDING-UPSTREAM"] })],
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
        pending: [makeEntry("PROMOTABLE-1", { kind: "blockedBy", tags: ["ALREADY-SHIPPED-TAG"] })],
      };
      expect(plan.shouldRun!(ctx)).toBe(true);
    });

    it("runs when ctx.pending is undefined", async () => {
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      const ctx: TickContext = { cwd: flumeDir, flumeDir };
      expect(plan.shouldRun!(ctx)).toBe(true);
    });

    it("runs on a pickable-only queue when prior-attempts/ holds a voluntary-bail record (5e50102)", async () => {
      // A standing voluntary-bail record is plan's to reconcile — shouldRun
      // must not defer to build a second time on the same refusal
      // (anyVoluntaryBailRecord's doc, chain.ts).
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      await mkdir(join(flumeDir, "prior-attempts"), { recursive: true });
      await writeFile(
        join(flumeDir, "prior-attempts", "build-OPEN-1.json"),
        JSON.stringify({ mode: "voluntary-bail", constraint: "off-writablePaths edit" }),
      );
      const ctx: TickContext = {
        cwd: flumeDir,
        flumeDir,
        pending: [makeEntry("OPEN-1", { kind: "open" })],
      };
      expect(plan.shouldRun!(ctx)).toBe(true);
    });

    it("declines on a pickable-only queue with an empty prior-attempts dir and empty inbox (baseline unchanged)", async () => {
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      await mkdir(join(flumeDir, "prior-attempts"), { recursive: true });
      const ctx: TickContext = {
        cwd: flumeDir,
        flumeDir,
        pending: [makeEntry("OPEN-1", { kind: "open" })],
      };
      expect(plan.shouldRun!(ctx)).toBe(false);
    });

    it("declines on a pickable-only queue with an absent prior-attempts dir and empty inbox (baseline unchanged)", async () => {
      // No prior-attempts/ directory written at all — anyVoluntaryBailRecord's
      // readdirSync throw is caught and treated as "no records".
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      const ctx: TickContext = {
        cwd: flumeDir,
        flumeDir,
        pending: [makeEntry("OPEN-1", { kind: "open" })],
      };
      expect(plan.shouldRun!(ctx)).toBe(false);
    });

    it("runs on a pickable-only queue when the last build verdict carries a not-shipped merge outcome (4ee48ee)", async () => {
      // A park is a *committed* not-shipped outcome, so it writes no
      // prior-attempt record and the voluntary-bail check above can never
      // see it. Without this leg the parked entry stays pickable, plan
      // declines, and build re-parks against the same fence forever.
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      await writeTickVerdict(
        flumeDir,
        buildVerdict(build.name, [{ tag: "PARKED-BY-BUILD", outcome: "not-shipped" }]),
      );
      // Non-vacuity: the leg reads the build phase's own latest verdict, so
      // prove the writer put outcomes there under that key before judging.
      expect(readLatestVerdictsSync(flumeDir)[build.name]?.mergeOutcomes).toHaveLength(1);
      const ctx: TickContext = {
        cwd: flumeDir,
        flumeDir,
        pending: [makeEntry("PARKED-BY-BUILD", { kind: "open" })],
      };
      expect(plan.shouldRun!(ctx)).toBe(true);
    });

    it("declines on a pickable-only queue when the last build verdict's merge outcomes are all shipped", async () => {
      // The other leg: a verdict is present and readable, but nothing in it
      // is a park — the queue's pickable entry is still build's to take.
      await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
      await writeTickVerdict(
        flumeDir,
        buildVerdict(build.name, [
          { tag: "SHIPPED-1", outcome: "merged" },
          { tag: "SHIPPED-2", outcome: "merged" },
        ]),
      );
      expect(readLatestVerdictsSync(flumeDir)[build.name]?.mergeOutcomes).toHaveLength(2);
      const ctx: TickContext = {
        cwd: flumeDir,
        flumeDir,
        pending: [makeEntry("OPEN-1", { kind: "open" })],
      };
      expect(plan.shouldRun!(ctx)).toBe(false);
    });
  });

  describe("plan.handoff", () => {
    it("re-wakes plan when state.md declares 'Plan continues: yes' and nothing remains pickable", async () => {
      await writeFile(join(flumeDir, "plan", "state.md"), "Plan continues: yes\n");
      const result = tickResult({ flumeDir, phaseName: "plan", pendingAfter: [] });
      expect(plan.handoff(result)).toEqual(["plan"]);
    });

    it("hands off to build when state.md declares 'Plan continues: yes' but a pickable entry remains (posture-sweep.md, 'The sweep yields to pickable work')", async () => {
      await writeFile(join(flumeDir, "plan", "state.md"), "Plan continues: yes\n");
      const result = tickResult({
        flumeDir,
        phaseName: "plan",
        pendingAfter: [makeEntry("OPEN-1", { kind: "open" })],
      });
      expect(plan.handoff(result)).toEqual(["build"]);
    });

    it("hands off to build when state.md says 'no' and a pickable entry remains", async () => {
      await writeFile(join(flumeDir, "plan", "state.md"), "Plan continues: no\n");
      const result = tickResult({
        flumeDir,
        phaseName: "plan",
        pendingAfter: [makeEntry("OPEN-1", { kind: "open" })],
      });
      expect(plan.handoff(result)).toEqual(["build"]);
    });

    it("hibernates when state.md says 'no' and nothing remains pickable", async () => {
      await writeFile(join(flumeDir, "plan", "state.md"), "Plan continues: no\n");
      const result = tickResult({ flumeDir, phaseName: "plan", pendingAfter: [] });
      expect(plan.handoff(result)).toEqual([]);
    });

    it("falls through to the pickability check when state.md carries no 'Plan continues:' line", async () => {
      await writeFile(join(flumeDir, "plan", "state.md"), "# State\n\nno marker here\n");
      const result = tickResult({
        flumeDir,
        phaseName: "plan",
        pendingAfter: [makeEntry("OPEN-1", { kind: "open" })],
      });
      expect(plan.handoff(result)).toEqual(["build"]);
    });

    it("falls through to the pickability check when state.md is missing entirely (an absent line)", () => {
      // No plan/state.md written at all — the readFileSync throw is caught
      // and treated the same as an explicit "no".
      const result = tickResult({
        flumeDir,
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
      ...buildFlumeApi(REPO_PATHS),
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

describe("buildFlumeApi().matchesAny", () => {
  it("is the same matcher src/paths.ts exports, not a second copy", () => {
    expect(buildFlumeApi(REPO_PATHS).matchesAny).toBe(matchesAny);
  });
});

describe("buildFlumeApi().slugify / .priorAttemptPath (spec/loop.md 'Prior-outcome feedback to the retrying tick')", () => {
  it("are the same functions src/Dispatcher.ts exports, not second copies a chain's shouldRun would drift from", () => {
    const api = buildFlumeApi(REPO_PATHS);
    expect(api.slugify).toBe(slugify);
    expect(api.priorAttemptPath).toBe(priorAttemptPath);
  });
});

describe("per cites resolve (plan gate) and build's PER_SECTION_TEXT read one resolver", () => {
  let build: Phase;
  let gate: Phase["gates"][number];
  let repo: string;

  const SPEC = [
    "# Top",
    "",
    "intro",
    "",
    "## The section cited",
    "",
    "body line one",
    "",
    "### A nested heading stays inside",
    "",
    "nested body",
    "",
    "## The next section",
    "",
    "not part of the cite",
    "",
  ].join("\n");

  const entry = (tag: string, section: string) => ({
    tag,
    gate: { kind: "open" },
    files: { new: [], edit: [{ path: "src/x.ts", description: "x" }], retire: [] },
    summary: "s",
    per: { path: "spec/x.md", section },
    tests: [],
    acceptance: "a",
  });

  async function commitQueue(entries: unknown[]): Promise<string> {
    await writeFile(join(repo, ".flume", "plan", "pending.json"), JSON.stringify(entries, null, 2));
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "plan: queue"]);
    return git(repo, ["rev-parse", "HEAD"]);
  }

  function gateCtx(sha: string) {
    return {
      cwd: repo,
      repoRoot: repo,
      flumeDir: join(repo, ".flume"),
      stateRootRel: ".flume",
      configDir: join(repo, ".flume"),
      pendingPath: join(repo, ".flume", "plan", "pending.json"),
      phaseName: "plan",
      commitSha: sha,
      touchedPaths: [],
      log: () => {},
    };
  }

  beforeAll(async () => {
    const { chain } = await loadChainModule(REPO_PATHS);
    const plan = chain.phases.find((p) => p.name === "plan")!;
    build = chain.phases.find((p) => p.name === "build")!;
    gate = plan.gates.find((g) => g.name === "per cites resolve")!;
    expect(gate.when).toBe("afterCommit");
  });

  beforeEach(async () => {
    repo = await initRepo("flume-per-gate-");
    await mkdir(join(repo, "spec"), { recursive: true });
    await mkdir(join(repo, ".flume", "plan"), { recursive: true });
    await writeFile(join(repo, "spec", "x.md"), SPEC);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("refuses a commit whose queue cites a heading the file does not carry, naming the tag; passes once every cite resolves", async () => {
    const bad = await commitQueue([
      entry("GOOD", "The section cited"),
      entry("BAD", "The section cited (or the nearest equivalent)"),
    ]);
    const refused = await gate.run(gateCtx(bad));
    expect(refused.ok).toBe(false);
    expect(refused.details).toContain("BAD:");
    expect(refused.details).not.toContain("GOOD:");

    const good = await commitQueue([entry("GOOD", "The section cited")]);
    const passed = await gate.run(gateCtx(good));
    expect(passed.ok).toBe(true);
    expect(passed.message).toBe("1 per cite(s) resolve");
  });

  it("refuses a cite whose path is not in the commit", async () => {
    const sha = await commitQueue([
      { ...entry("NOPATH", "The section cited"), per: { path: "spec/missing.md", section: "The section cited" } },
    ]);
    const refused = await gate.run(gateCtx(sha));
    expect(refused.ok).toBe(false);
    expect(refused.details).toContain("spec/missing.md is not in the commit");
  });

  it("build renders exactly the section the gate accepted — heading through the last line before the next same-depth heading — and throws on a cite the gate would refuse", async () => {
    const sha = await commitQueue([entry("GOOD", "The section cited")]);
    expect((await gate.run(gateCtx(sha))).ok).toBe(true);

    const args = build.promptArgs!({
      cwd: repo,
      flumeDir: join(repo, ".flume"),
      assignedEntry: entry("GOOD", "The section cited") as unknown as PendingEntry,
    });
    expect(args.PER_SECTION_TEXT).toBe(
      [
        "## The section cited",
        "",
        "body line one",
        "",
        "### A nested heading stays inside",
        "",
        "nested body",
      ].join("\n"),
    );
    expect(args.PER_SECTION_TEXT).not.toContain("not part of the cite");

    expect(() =>
      build.promptArgs!({
        cwd: repo,
        flumeDir: join(repo, ".flume"),
        assignedEntry: entry("BAD", "No such heading") as unknown as PendingEntry,
      }),
    ).toThrow(/BAD cites "No such heading" in spec\/x.md/);
  });
});

/**
 * `.claude/rules/engineering.md`, *A fact the engine holds is reported, never
 * rediscovered* — a chain gate that needs a commit's content reads it through
 * the engine's own reader instead of hand-rolling `git show <sha>:<path>`.
 * The reader's own contract (null for an absent path, a throw for a bad ref)
 * is pinned in tests/git.test.ts; this pins only that the api hands it out,
 * and the `per cites resolve` block above is its real consumer.
 */
describe("buildFlumeApi().git.readFileAtRef", () => {
  it("is the engine's own reader on the api a chain factory receives, reading a tracked path's bytes at a given sha", async () => {
    const api = buildFlumeApi(REPO_PATHS);
    expect(api.git.readFileAtRef).toBe(readFileAtRef);

    const repo = await initRepo("flume-api-readfileatref-");
    try {
      await writeFile(join(repo, "queue.json"), "committed bytes\n");
      git(repo, ["add", "."]);
      git(repo, ["commit", "-q", "-m", "seed"]);
      const sha = git(repo, ["rev-parse", "HEAD"]);
      await writeFile(join(repo, "queue.json"), "dirty working tree\n");
      expect(await api.git.readFileAtRef(repo, sha, "queue.json")).toBe(
        "committed bytes\n",
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
