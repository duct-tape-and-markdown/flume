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
import { existsSync } from "node:fs";
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
import { judgeVitestReport, parseVitestReport } from "../.flume/vitestJudge.ts";

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

/**
 * Plan is four slices whose liveness the chain computes from disk
 * (`.flume/PROTOCOL.md`, *Plan slices*). Every case here drives the real
 * factory against a temp repo whose cursors, queue, inbox, and git history
 * the test controls, so each predicate is judged on the facts it reads.
 */
describe("plan slices via the real .flume/chain.ts", () => {
  const INBOX = "plan-inbox";
  const AUDIT = "plan-audit";
  const DERIVE = "plan-derive";
  const SWEEP = "plan-sweep";
  const LADDER = [INBOX, AUDIT, DERIVE, SWEEP];

  let repo: string;
  let flumeDir: string;
  let phases: Record<string, Phase>;
  let seed: string;

  const commit = async (rel: string, content: string, msg: string): Promise<string> => {
    await mkdir(join(repo, rel, ".."), { recursive: true });
    await writeFile(join(repo, rel), content);
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", msg]);
    return git(repo, ["rev-parse", "HEAD"]);
  };
  const writeState = async (over: Partial<Record<"audit" | "derive" | "sweep", string | null>> = {}, extra = "") => {
    const line = (label: string, key: "audit" | "derive" | "sweep") =>
      over[key] === null ? "" : `${label} \`${over[key] ?? seed}\`\n\n`;
    await writeFile(
      join(flumeDir, "plan", "state.md"),
      `# State\n\n${line("Spec derived through:", "derive")}${line("Audited through:", "audit")}${line("Posture swept through:", "sweep")}${extra}`,
    );
  };
  const ctx = (pending: PendingEntry[] = []): TickContext => ({ cwd: repo, flumeDir, pending });
  const open = (tag: string) => makeEntry(tag, { kind: "open" });
  const result = (over: Partial<TickResult> = {}): TickResult =>
    tickResult({ phaseName: INBOX, flumeDir, pendingAfter: [], pickableAfter: [], ...over });

  beforeEach(async () => {
    repo = await initRepo("flume-slices-");
    flumeDir = join(repo, ".flume");
    await mkdir(join(flumeDir, "plan"), { recursive: true });
    await writeFile(join(flumeDir, "plan", "pending.json"), "[]\n");
    await writeFile(join(flumeDir, "inbox.md"), EMPTY_INBOX);
    await mkdir(join(repo, "spec"), { recursive: true });
    await writeFile(join(repo, "spec", "x.md"), "# X\n\n## A\n\nbody\n");
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "seed"]);
    seed = git(repo, ["rev-parse", "HEAD"]);
    await writeState();
    const { chain } = chainFactory(buildFlumeApi({ repoRoot: repo, configDir: flumeDir, flumeDir }));
    phases = Object.fromEntries(chain.phases.map((p) => [p.name, p]));
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("declares the ladder in priority order ahead of build, each slice with its own prompt file in this repo", async () => {
    const { chain } = await loadChainModule(REPO_PATHS);
    expect(chain.phases.map((p) => p.name)).toEqual([...LADDER, "build"]);
    for (const name of LADDER) {
      const slice = chain.phases.find((p) => p.name === name)!;
      expect(slice.concurrency).toBe("singleton");
      expect(slice.shouldRun).toBeDefined();
      expect(existsSync(join(REPO_PATHS.configDir, slice.promptPath))).toBe(true);
    }
  });

  describe("liveness (shouldRun)", () => {
    it("every slice declines on a quiet tree: cursors at HEAD, empty inbox, empty queue", () => {
      for (const name of LADDER) expect(phases[name]!.shouldRun!(ctx()), name).toBe(false);
    });

    it("inbox: live iff an entry sits below the marker; an unreadable inbox runs the slice", async () => {
      await writeFile(join(flumeDir, "inbox.md"), NONEMPTY_INBOX);
      expect(phases[INBOX]!.shouldRun!(ctx([open("OPEN-1")]))).toBe(true);
      await rm(join(flumeDir, "inbox.md"));
      expect(phases[INBOX]!.shouldRun!(ctx())).toBe(true);
    });

    it("audit: live on a code commit past the cursor, not on a plan-artifact-only commit, and ahead of pickable work", async () => {
      await commit(".flume/plan/pending.json", "[]\n", "plan: rewrite");
      expect(phases[AUDIT]!.shouldRun!(ctx())).toBe(false);
      await commit("src/a.ts", "export const a = 2;\n", "build: change a");
      expect(phases[AUDIT]!.shouldRun!(ctx())).toBe(true);
      expect(phases[AUDIT]!.shouldRun!(ctx([open("OPEN-1")]))).toBe(true);
    });

    it("audit: a standing voluntary-bail record or a park in the last build verdict wakes it even over pickable work", async () => {
      const pickable = ctx([open("OPEN-1")]);
      expect(phases[AUDIT]!.shouldRun!(pickable)).toBe(false);

      await writeTickVerdict(flumeDir, buildVerdict("build", [{ tag: "OPEN-1", outcome: "not-shipped" }]));
      expect(readLatestVerdictsSync(flumeDir)["build"]?.mergeOutcomes).toHaveLength(1);
      expect(phases[AUDIT]!.shouldRun!(pickable)).toBe(true);

      await writeTickVerdict(flumeDir, buildVerdict("build", [{ tag: "OPEN-1", outcome: "merged" }]));
      expect(phases[AUDIT]!.shouldRun!(pickable)).toBe(false);

      await mkdir(join(flumeDir, "prior-attempts"), { recursive: true });
      await writeFile(priorAttemptPath(flumeDir, "OPEN-1"), JSON.stringify({ mode: "voluntary-bail", constraint: "already shipped" }));
      expect(phases[AUDIT]!.shouldRun!(pickable)).toBe(true);
    });

    it("derive: live on a spec commit past the cursor, not on a code commit, and ahead of pickable work — a queued entry citing a rewritten section is stale input", async () => {
      await commit("src/a.ts", "export const a = 2;\n", "build: change a");
      expect(phases[DERIVE]!.shouldRun!(ctx())).toBe(false);
      await commit("spec/x.md", "# X\n\n## A\n\nnew body\n", "spec: widen A");
      expect(phases[DERIVE]!.shouldRun!(ctx())).toBe(true);
      expect(phases[DERIVE]!.shouldRun!(ctx([open("OPEN-1")]))).toBe(true);
    });

    it("sweep: live on a domain commit, a spec deletion, or an open rotation; not on a docs-only commit; yields to pickable work", async () => {
      await commit("docs/note.md", "note\n", "build: docs");
      expect(phases[SWEEP]!.shouldRun!(ctx())).toBe(false);
      await writeState({}, "Rotation open (phrase delta). Covered: `src/a.ts`.\n");
      expect(phases[SWEEP]!.shouldRun!(ctx())).toBe(true);
      await writeState();
      await commit("spec/x.md", "# X\n", "spec: retire A");
      expect(phases[SWEEP]!.shouldRun!(ctx())).toBe(true);
      expect(phases[SWEEP]!.shouldRun!(ctx([open("OPEN-1")]))).toBe(false);
    });

    it("a slice with no cursor line is live (bootstrap)", async () => {
      await writeState({ audit: null, derive: null, sweep: null });
      for (const name of [AUDIT, DERIVE, SWEEP]) expect(phases[name]!.shouldRun!(ctx()), name).toBe(true);
    });
  });

  describe("handoff — the ladder, then build, then hibernate", () => {
    it("a slice that committed and is still live re-wakes itself; one that did not commit hands on", async () => {
      await writeFile(join(flumeDir, "inbox.md"), NONEMPTY_INBOX);
      expect(phases[INBOX]!.handoff(result({ committed: true }))).toEqual([INBOX]);
      expect(phases[INBOX]!.handoff(result({ committed: false }))).toEqual([]);
      await commit("src/a.ts", "export const a = 2;\n", "build: change a");
      expect(phases[INBOX]!.handoff(result({ committed: false }))).toEqual([AUDIT]);
    });

    it("hands to build while anything is pickable and nothing earlier is live; hibernates when nothing is", async () => {
      const entry = open("OPEN-1");
      expect(phases[AUDIT]!.handoff(result({ phaseName: AUDIT, committed: true, pendingAfter: [entry], pickableAfter: [entry] }))).toEqual(["build"]);
      expect(phases[AUDIT]!.handoff(result({ phaseName: AUDIT, committed: true }))).toEqual([]);
    });

    it("the continuation marker is retired: 'Plan continues: yes' in state.md wakes nothing", async () => {
      await writeState({}, "Plan continues: yes — more to do\n");
      expect(phases[SWEEP]!.handoff(result({ phaseName: SWEEP, committed: true }))).toEqual([]);
    });

    it("the sweep alone yields to pickable work", async () => {
      await writeState({}, "Rotation open (phrase delta). Covered: `src/a.ts`.\n");
      expect(phases[SWEEP]!.shouldRun!(ctx())).toBe(true);
      expect(phases[SWEEP]!.shouldRun!(ctx([open("OPEN-1")]))).toBe(false);
    });

    it("a refusal in the build wave wakes audit ahead of a still-pickable queue; a clean wave follows the ladder", async () => {
      const build = phases["build"]!;
      const entry = open("OPEN-1");
      const pickable = { pendingAfter: [entry], pickableAfter: [entry] };
      expect(build.handoff(result({ phaseName: "build", shippedTags: ["DONE"], ...pickable }))).toEqual(["build"]);
      expect(build.handoff(result({ phaseName: "build", noCommit: "voluntary-bail", ...pickable }))).toEqual([AUDIT]);
      expect(
        build.handoff(
          result({
            phaseName: "build",
            committed: true,
            entries: [{ tag: "OPEN-1", committed: true, shipped: false, reverted: false }],
            ...pickable,
          }),
        ),
      ).toEqual([AUDIT]);
      // Nothing pickable, nothing live: a true no-op wave hibernates …
      expect(build.handoff(result({ phaseName: "build" }))).toEqual([]);
      // … and a shipped wave with code past the audit cursor goes to audit.
      await commit("src/a.ts", "export const a = 2;\n", "build: change a");
      expect(build.handoff(result({ phaseName: "build", committed: true, shippedTags: ["DONE"] }))).toEqual([AUDIT]);
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
    // Every slice writes the queue and carries the gate; the inbox slice stands in for all four.
    const plan = chain.phases.find((p) => p.name === "plan-inbox")!;
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

/**
 * Acceptance-driven backpressure (`.flume/vitestJudge.ts`): the real
 * reporter's JSON, produced by running vitest itself, through the real judge
 * — never a hand-authored report.
 */
describe("judgeVitestReport — the vitest gate's two claims over the real reporter's output", () => {
  let details: string;
  let title: string;

  beforeAll(() => {
    const repoRoot = REPO_PATHS.repoRoot;
    details = execFileSync(
      process.execPath,
      [join(repoRoot, "node_modules", "vitest", "vitest.mjs"), "run", "tests/paths.test.ts", "--reporter=json"],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 << 20 },
    );
    title = parseVitestReport(details)!.testResults[0]!.assertionResults[0]!.fullName;
    expect(title.length).toBeGreaterThan(0);
  }, 60_000);

  it("green suite, every named behavior has a passing test → ok, and says how many", () => {
    const r = judgeVitestReport(details, true, [title, title.slice(0, 20)], REPO_PATHS.repoRoot);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("2 named behavior(s)");
  });

  it("green suite, a named behavior no test is titled with → refused, naming the line", () => {
    const r = judgeVitestReport(details, true, [title, "a behavior nobody pinned"], REPO_PATHS.repoRoot);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("1 of 2 named behavior(s)");
    expect(r.details).toContain("- a behavior nobody pinned");
    expect(r.details).not.toContain(`- ${title}`);
  });

  it("nothing named → ok and says so (vacuous by design, spelled)", () => {
    const r = judgeVitestReport(details, true, [], REPO_PATHS.repoRoot);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("no behavior named");
  });

  it("no report in the output → refused either way, never green over nothing", () => {
    expect(judgeVitestReport("not json", true, [], REPO_PATHS.repoRoot).ok).toBe(false);
    expect(judgeVitestReport(undefined, false, [], REPO_PATHS.repoRoot).ok).toBe(false);
  });

  it("a failing report → refused with the failing files attributed", () => {
    const report = parseVitestReport(details)!;
    const file = report.testResults[0]!;
    const broken = {
      ...report,
      success: false,
      numFailedTests: 1,
      testResults: [{ ...file, status: "failed", assertionResults: [{ ...file.assertionResults[0]!, status: "failed", failureMessages: ["boom\nstack"] }] }],
    };
    const r = judgeVitestReport(JSON.stringify(broken), false, [title], REPO_PATHS.repoRoot);
    expect(r.ok).toBe(false);
    expect(r.failingFiles).toEqual(["tests/paths.test.ts"]);
    expect(r.details).toContain("boom");
    expect(r.details).not.toContain("stack");
  });
});
