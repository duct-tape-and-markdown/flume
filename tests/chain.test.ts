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
 * `plan.shouldRun` lists `<flumeDir>/inbox/` and `<flumeDir>/plan/notes/`
 * and `plan.handoff` reads `<flumeDir>/plan/state.md`, taking the root from
 * what the engine hands them (`TickContext.flumeDir`, `TickResult.flumeDir`)
 * — never from env. Every test below passes a fresh scratch directory as
 * that root so the real `.flume/` records and state are never read or
 * written.
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

/** One record, one file (`.flume/PROTOCOL.md`, *Records: one file each*). */
const RECORD = "# test finding (human)\n\nbody\n";

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
    tags: mergeOutcomes.flatMap((o) => (o.tag ? [o.tag] : [])),
    committed: true,
    gateResults: [],
    shippedTags: mergeOutcomes.flatMap((o) =>
      o.tag && o.outcome === "merged" ? [o.tag] : [],
    ),
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
 * Plan is three slices whose liveness the chain computes from disk
 * (`.flume/PROTOCOL.md`, *Plan slices*). Every case here drives the real
 * factory against a temp repo whose cursors, queue, inbox, and git history
 * the test controls, so each predicate is judged on the facts it reads.
 */
describe("plan slices via the real .flume/chain.ts", () => {
  const INBOX = "plan-inbox";
  const DERIVE = "plan-derive";
  const SWEEP = "plan-sweep";
  const LADDER = [INBOX, DERIVE, SWEEP];

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
  const writeState = async (over: Partial<Record<"derive" | "sweep", string | null>> = {}, extra = "") => {
    const line = (label: string, key: "derive" | "sweep") =>
      over[key] === null ? "" : `${label} \`${over[key] ?? seed}\`\n\n`;
    await writeFile(
      join(flumeDir, "plan", "state.md"),
      `# State\n\n${line("Spec derived through:", "derive")}${line("Posture swept through:", "sweep")}${extra}`,
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
    await mkdir(join(flumeDir, "inbox"), { recursive: true });
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

    it("inbox: live iff a record file sits under inbox/ or plan/notes/; a missing directory is drained; an unreadable one runs the slice", async () => {
      await writeFile(join(flumeDir, "inbox", "2026-08-03-finding.md"), RECORD);
      expect(phases[INBOX]!.shouldRun!(ctx([open("OPEN-1")]))).toBe(true);
      await rm(join(flumeDir, "inbox"), { recursive: true });
      expect(phases[INBOX]!.shouldRun!(ctx())).toBe(false);
      await mkdir(join(flumeDir, "plan", "notes"), { recursive: true });
      await writeFile(join(flumeDir, "plan", "notes", "OPEN-1.md"), RECORD);
      expect(phases[INBOX]!.shouldRun!(ctx())).toBe(true);
      await rm(join(flumeDir, "plan", "notes"), { recursive: true });
      await writeFile(join(flumeDir, "inbox"), "not a directory");
      expect(phases[INBOX]!.shouldRun!(ctx())).toBe(true);
    });

    it("inbox: a standing voluntary-bail record or a park in the last build verdict is build's note to plan and wakes it, even over pickable work", async () => {
      const pickable = ctx([open("OPEN-1")]);
      expect(phases[INBOX]!.shouldRun!(pickable)).toBe(false);

      await writeTickVerdict(flumeDir, buildVerdict("build", [{ tag: "OPEN-1", outcome: "not-shipped" }]));
      expect(readLatestVerdictsSync(flumeDir)["build"]?.mergeOutcomes).toHaveLength(1);
      expect(phases[INBOX]!.shouldRun!(pickable)).toBe(true);

      await writeTickVerdict(flumeDir, buildVerdict("build", [{ tag: "OPEN-1", outcome: "merged" }]));
      expect(phases[INBOX]!.shouldRun!(pickable)).toBe(false);

      await mkdir(join(flumeDir, "prior-attempts"), { recursive: true });
      await writeFile(priorAttemptPath(flumeDir, "OPEN-1"), JSON.stringify({ mode: "voluntary-bail", constraint: "already shipped" }));
      expect(phases[INBOX]!.shouldRun!(pickable)).toBe(true);
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
      await writeState({ derive: null, sweep: null });
      for (const name of [DERIVE, SWEEP]) expect(phases[name]!.shouldRun!(ctx()), name).toBe(true);
    });
  });

  describe("handoff — the ladder, then build, then hibernate", () => {
    it("a slice that committed and is still live re-wakes itself; one that did not commit hands on", async () => {
      await writeFile(join(flumeDir, "inbox", "2026-08-03-finding.md"), RECORD);
      expect(phases[INBOX]!.handoff(result({ committed: true }))).toEqual([INBOX]);
      expect(phases[INBOX]!.handoff(result({ committed: false }))).toEqual([]);
      await commit("spec/x.md", "# X\n\n## A\n\nnew body\n", "spec: widen A");
      expect(phases[INBOX]!.handoff(result({ committed: false }))).toEqual([DERIVE]);
    });

    it("a build refusal never re-wakes the inbox slice by itself: it is a reason to be woken, cleared only by a build wave", async () => {
      await writeTickVerdict(flumeDir, buildVerdict("build", [{ tag: "OPEN-1", outcome: "not-shipped" }]));
      expect(phases[INBOX]!.shouldRun!(ctx())).toBe(true);
      expect(phases[INBOX]!.handoff(result({ committed: true }))).toEqual([]);
    });

    it("hands to build while anything is pickable and nothing earlier is live; hibernates when nothing is", async () => {
      const entry = open("OPEN-1");
      expect(phases[DERIVE]!.handoff(result({ phaseName: DERIVE, committed: true, pendingAfter: [entry], pickableAfter: [entry] }))).toEqual(["build"]);
      expect(phases[DERIVE]!.handoff(result({ phaseName: DERIVE, committed: true }))).toEqual([]);
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

    it("a refusal in the build wave wakes the inbox slice ahead of a still-pickable queue; a clean wave follows the ladder", async () => {
      const build = phases["build"]!;
      const entry = open("OPEN-1");
      const pickable = { pendingAfter: [entry], pickableAfter: [entry] };
      expect(build.handoff(result({ phaseName: "build", shippedTags: ["DONE"], ...pickable }))).toEqual(["build"]);
      expect(build.handoff(result({ phaseName: "build", noCommit: "voluntary-bail", ...pickable }))).toEqual([INBOX]);
      expect(
        build.handoff(
          result({
            phaseName: "build",
            committed: true,
            entries: [{ tag: "OPEN-1", committed: true, shipped: false, reverted: false }],
            ...pickable,
          }),
        ),
      ).toEqual([INBOX]);
      // Nothing pickable: a shipped wave has no reviewer to wake — the gates
      // were its review — so the ladder falls through to the sweep, whose
      // domain the shipped code touched …
      await commit("src/a.ts", "export const a = 2;\n", "build: change a");
      expect(build.handoff(result({ phaseName: "build", committed: true, shippedTags: ["DONE"] }))).toEqual([SWEEP]);
      // … and to derive ahead of it when intent moved.
      await commit("spec/x.md", "# X\n\n## A\n\nnew body\n", "spec: widen A");
      expect(build.handoff(result({ phaseName: "build", committed: true, shippedTags: ["DONE"] }))).toEqual([DERIVE]);
      // A docs-only wave with nothing else live hibernates outright.
      await writeState({ sweep: git(repo, ["rev-parse", "HEAD"]), derive: git(repo, ["rev-parse", "HEAD"]) });
      expect(build.handoff(result({ phaseName: "build", committed: true, shippedTags: ["DONE"] }))).toEqual([]);
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

/**
 * Records are one file each and short (`.flume/PROTOCOL.md`, *Records: one
 * file each*). The `records` gate rides every phase's afterCommit list and
 * reads the commit through the engine's at-sha reader; `build.shipped` reads
 * the entry's own note as the park signal. Refusal cases are hand-authored
 * commits — a real writer cannot produce the malformed record a refusal is
 * tested on (`engineering.md`, *A seam gate reads what the real writer wrote*).
 */
describe("records gate and the park predicate — one file each", () => {
  let build: Phase;
  let plan: Phase;
  let repo: string;
  const NOTE = ".flume/plan/notes/OPEN-1.md";
  const gateOf = (p: Phase) => p.gates.find((g) => g.name === "records")!;

  async function commitFiles(files: Record<string, string | null>, msg: string): Promise<string> {
    for (const [rel, content] of Object.entries(files)) {
      if (content === null) {
        await rm(join(repo, rel));
      } else {
        await mkdir(join(repo, rel, ".."), { recursive: true });
        await writeFile(join(repo, rel), content);
      }
    }
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", msg]);
    return git(repo, ["rev-parse", "HEAD"]);
  }

  function gateCtx(sha: string, phaseName: string, entry?: PendingEntry) {
    return {
      cwd: repo,
      repoRoot: repo,
      flumeDir: join(repo, ".flume"),
      stateRootRel: ".flume",
      configDir: join(repo, ".flume"),
      pendingPath: join(repo, ".flume", "plan", "pending.json"),
      phaseName,
      commitSha: sha,
      log: () => {},
      ...(entry ? { entry } : {}),
    };
  }

  beforeAll(async () => {
    const { chain } = await loadChainModule(REPO_PATHS);
    build = chain.phases.find((p) => p.name === "build")!;
    plan = chain.phases.find((p) => p.name === "plan-inbox")!;
    for (const p of chain.phases) {
      const g = p.gates.find((g) => g.name === "records");
      expect(g, p.name).toBeDefined();
      expect(g!.when).toBe("afterCommit");
    }
  });

  beforeEach(async () => {
    repo = await initRepo("flume-records-");
    await mkdir(join(repo, ".flume", "plan"), { recursive: true });
    await writeFile(join(repo, ".flume", "plan", "pending.json"), "[]\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "seed"]);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("build: its own note, titled and within the cap, passes; over the cap or untitled is refused, naming the bytes", async () => {
    const entry = makeEntry("OPEN-1", { kind: "open" });
    const ok = await commitFiles({ [NOTE]: "# parked\n\nsrc/x.ts is outside the fence\n" }, "build: park");
    const passed = await gateOf(build).run(gateCtx(ok, "build", entry));
    expect(passed.ok).toBe(true);
    expect(passed.message).toBe("1 record(s) touched, 1 written within 1200 bytes");

    const big = await commitFiles({ [NOTE]: `# long\n\n${"x".repeat(1300)}\n` }, "build: long");
    const refused = await gateOf(build).run(gateCtx(big, "build", entry));
    expect(refused.ok).toBe(false);
    expect(refused.details).toContain(`${NOTE}: 1309 bytes, cap 1200`);

    const untitled = await commitFiles({ [NOTE]: "no title\n" }, "build: untitled");
    const refusedAgain = await gateOf(build).run(gateCtx(untitled, "build", entry));
    expect(refusedAgain.ok).toBe(false);
    expect(refusedAgain.details).toContain(`${NOTE}: first line is not a "# title"`);
  });

  it("build: a sibling's note — written or deleted — is refused by name", async () => {
    const entry = makeEntry("OPEN-1", { kind: "open" });
    const other = await commitFiles({ ".flume/plan/notes/OTHER.md": "# theirs\n" }, "build: sibling");
    const refused = await gateOf(build).run(gateCtx(other, "build", entry));
    expect(refused.ok).toBe(false);
    expect(refused.details).toContain(`.flume/plan/notes/OTHER.md: a build tick touches only ${NOTE}`);

    const gone = await commitFiles({ ".flume/plan/notes/OTHER.md": null }, "build: delete sibling");
    expect((await gateOf(build).run(gateCtx(gone, "build", entry))).ok).toBe(false);
  });

  it("plan: deleting records is the drain and passes; creating one is refused", async () => {
    const added = await commitFiles({ ".flume/inbox/2026-08-03-finding.md": RECORD }, "plan: oops");
    const refused = await gateOf(plan).run(gateCtx(added, "plan-inbox"));
    expect(refused.ok).toBe(false);
    expect(refused.details).toContain("a plan slice drains records, never writes one");

    const drained = await commitFiles({ ".flume/inbox/2026-08-03-finding.md": null }, "plan: drain");
    const passed = await gateOf(plan).run(gateCtx(drained, "plan-inbox"));
    expect(passed.ok).toBe(true);
    expect(passed.message).toBe("1 record(s) touched, 0 written within 1200 bytes");
  });

  it("a commit touching no record passes vacuously, and says so", async () => {
    const sha = await commitFiles({ "src/a.ts": "export const a = 1;\n" }, "build: code");
    const r = await gateOf(build).run(gateCtx(sha, "build", makeEntry("OPEN-1", { kind: "open" })));
    expect(r.ok).toBe(true);
    expect(r.message).toBe("no records touched");
  });

  it("build.shipped: a commit whose only path is the entry's own note is a park; the note beside code, or any other sole file, is a ship", () => {
    const entry = makeEntry("OPEN-1", { kind: "open" });
    const ship = (touchedPaths: string[]) =>
      build.shipped!({ entry, touchedPaths, mergedSha: "m", baseSha: "b", gateResults: [], worktreePath: repo, repoRoot: repo });
    expect(ship([NOTE])).toBe(false);
    expect(ship([NOTE, "src/a.ts"])).toBe(true);
    expect(ship([".flume/plan/notes/OTHER.md"])).toBe(true);
    expect(ship([".flume/plan/open-questions.md"])).toBe(true);
  });
});
