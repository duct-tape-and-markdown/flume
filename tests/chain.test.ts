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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Phase, TickContext, TickResult, WorktreeSetupContext } from "../src/Phase.ts";
import type { Gate } from "../src/Gate.ts";
import type { PkgManagerGate } from "../src/builtinGates.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { PriorAttempt } from "../src/Prompt.ts";
import { Baton } from "../src/Baton.ts";
import { Dispatcher, loadChainModule, type TickOutcome } from "../src/Dispatcher.ts";
import { slugify } from "../src/paths.ts";
import { priorAttemptPath } from "../src/priorAttempts.ts";
import { buildFlumeApi, type FlumePaths } from "../src/flumeApi.ts";
import { readFileAtRef } from "../src/git.ts";
import { matchesAny } from "../src/paths.ts";
import { makeFixture, silent } from "./helpers/dispatcherFixture.ts";
import chainFactory from "../.flume/chain.ts";
import { filesPinning, judgeRedOnBase, judgeVitestReport, materializeBase, parseVitestReport, removeWorktree } from "../.flume/vitestJudge.ts";

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

/** Run git in `repo`; trimmed stdout. */
function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

/** A fresh temp repo with commit identity pinned, for the gate fixtures below. */
/** Git's empty-tree object — the base of a span that starts from nothing. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

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

    it("inbox: a refusal record — a clean exit or a park — under a key still in the queue wakes it even over pickable work; a record whose key left the queue, or a phase's own record, does not", () => {
      const withRecords = (records: Record<string, string>): TickContext => ({
        ...ctx([open("OPEN-1")]),
        priorAttempts: new Map(Object.entries(records).map(([key, mode]) => [key, { mode } as unknown as PriorAttempt])),
      });
      expect(phases[INBOX]!.shouldRun!(ctx([open("OPEN-1")]))).toBe(false);
      for (const mode of ["not-shipped", "clean-exit"]) {
        expect(phases[INBOX]!.shouldRun!(withRecords({ [slugify("OPEN-1")]: mode })), mode).toBe(true);
      }
      expect(phases[INBOX]!.shouldRun!(withRecords({ [slugify("OPEN-1")]: "gate-revert" }))).toBe(false);
      // The record outlived its entry: stale, ignored.
      expect(phases[INBOX]!.shouldRun!(withRecords({ [slugify("GONE")]: "not-shipped" }))).toBe(false);
      // A singleton slice's own record is keyed by phase name, which no tag slugifies to.
      expect(phases[INBOX]!.shouldRun!(withRecords({ "plan-inbox": "clean-exit" }))).toBe(false);
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

  /**
   * What is left here is what a real tick cannot produce on demand: a
   * marker that must be ignored, a prior attempt's refusal record. Every
   * rung a real tick *can* reach — the transitions between plan slices, and
   * the build wave's own merge outcomes — is driven through
   * `Dispatcher.tick()` at the bottom of this file instead, because a
   * `TickResult` this file folds by hand cannot prove the engine and the
   * chain agree on it (`engineering.md`, *A seam gate reads what the real
   * writer wrote*).
   */
  describe("handoff — the legs a hand-built TickResult still owns", () => {
    it("a build refusal never re-wakes the inbox slice by itself: it is a reason to be woken, cleared only by a build wave", () => {
      const woken: TickContext = {
        ...ctx([open("OPEN-1")]),
        priorAttempts: new Map([[slugify("OPEN-1"), { mode: "not-shipped" } as unknown as PriorAttempt]]),
      };
      expect(phases[INBOX]!.shouldRun!(woken)).toBe(true);
      expect(phases[INBOX]!.handoff(result({ committed: true }))).toEqual([]);
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
      worktreeKey: "TEST",
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
      worktreeKey: "TEST",
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
      // Each queue commit here is the repo's root commit and the `per` gate
      // reads the queue at the tip, never the span — so the span that
      // produced it genuinely starts from the empty tree.
      baseSha: EMPTY_TREE,
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

  // Agreement pin (engineering.md, *A seam gate reads what the real writer
  // wrote*): the shipped template is read off disk and both phases' real
  // promptArgs run, so a hand-written second copy of the tests[]/pins[]
  // contract in either surface fails here rather than drifting quietly.
  it("build's prompt states the tests[] and pins[] contracts from the entry extension's own hints, and restates neither by hand", async () => {
    const sha = await commitQueue([entry("GOOD", "The section cited")]);
    expect((await gate.run(gateCtx(sha))).ok).toBe(true);
    const args = build.promptArgs!({
      cwd: repo,
      flumeDir: join(repo, ".flume"),
      assignedEntry: entry("GOOD", "The section cited") as unknown as PendingEntry,
    });
    const template = readFileSync(join(REPO_PATHS.configDir, build.promptPath), "utf8");
    const placeholders = [...template.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)].map((m) => m[1]!);
    expect(placeholders).toContain("TESTS_HINT");
    expect(placeholders).toContain("PINS_HINT");
    expect(placeholders.filter((k) => k !== "FLUME_DIR" && !(k in args))).toEqual([]);

    const { chain } = await loadChainModule(REPO_PATHS);
    const schemaBlock = chain.phases.find((p) => p.name === "plan-inbox")!.promptArgs!({ cwd: repo, flumeDir: join(repo, ".flume") }).PENDING_SCHEMA!;
    for (const key of ["TESTS_HINT", "PINS_HINT"] as const) {
      const hint = args[key]!;
      expect(hint.length).toBeGreaterThan(0);
      expect(schemaBlock).toContain(hint);
    }
    // The prose that used to carry the contract is gone; only the framing stays.
    expect(template).not.toMatch(/judged green only|already passes there/);
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

  function gateCtx(
    sha: string,
    phaseName: string,
    entry?: PendingEntry,
    // The dispatcher always states the span's base; a fixture judging one
    // commit states that commit's own parent rather than leaving the field
    // off. Multi-commit spans pass the real base.
    baseSha = `${sha}^`,
  ) {
    return {
      cwd: repo,
      repoRoot: repo,
      flumeDir: join(repo, ".flume"),
      stateRootRel: ".flume",
      configDir: join(repo, ".flume"),
      pendingPath: join(repo, ".flume", "plan", "pending.json"),
      phaseName,
      commitSha: sha,
      baseSha,
      // The dispatcher always states the span's diff; a fixture that has no
      // particular list states the empty one rather than leaving the field
      // off. Cases that turn on the list override it.
      touchedPaths: [],
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

  it("build: the records gate judges the whole span, so a sibling note committed before the code is still refused", async () => {
    const entry = makeEntry("OPEN-1", { kind: "open" });
    const base = git(repo, ["rev-parse", "HEAD"]);
    await commitFiles({ ".flume/plan/notes/OTHER.md": "# theirs\n" }, "build: sibling first");
    const tip = await commitFiles({ "src/a.ts": "export const a = 1;\n" }, "build: then code");
    const refused = await gateOf(build).run(gateCtx(tip, "build", entry, base));
    expect(refused.ok).toBe(false);
    expect(refused.details).toContain(`.flume/plan/notes/OTHER.md: a build tick touches only ${NOTE}`);
  });

  it("clean-tree: a tracked edit or a writable untracked file left uncommitted after the commit is refused by path", async () => {
    const gate = (p: Phase) => p.gates.find((g) => g.name === "clean-tree")!;
    for (const p of [build, plan]) expect(gate(p)?.when, p.name).toBe("afterCommit");
    const entry = makeEntry("OPEN-1", { kind: "open" });
    const sha = await commitFiles({ "src/a.ts": "export const a = 1;\n" }, "build: code");
    expect((await gate(build).run(gateCtx(sha, "build", entry))).ok).toBe(true);
    // The observed shape: a tracked file appended after the commit and never staged.
    await writeFile(join(repo, ".flume", "plan", "pending.json"), "[]\n\n");
    // A forgotten new file inside the fence is the tick's; a scratch file outside it is not.
    await mkdir(join(repo, "tests"), { recursive: true });
    await writeFile(join(repo, "tests", "new.test.ts"), "// forgotten\n");
    await writeFile(join(repo, "scratch.txt"), "not judged\n");
    const refused = await gate(build).run(gateCtx(sha, "build", entry));
    expect(refused.ok).toBe(false);
    expect(refused.details).toContain(".flume/plan/pending.json");
    expect(refused.details).toContain("tests/new.test.ts");
    expect(refused.details).not.toContain("scratch.txt");
  });

  it("a commit touching no record passes vacuously, and says so", async () => {
    const sha = await commitFiles({ "src/a.ts": "export const a = 1;\n" }, "build: code");
    const r = await gateOf(build).run(gateCtx(sha, "build", makeEntry("OPEN-1", { kind: "open" })));
    expect(r.ok).toBe(true);
    expect(r.message).toBe("no records touched");
  });

  it("build type-checks the merged tree with the same command it type-checks the commit", () => {
    const byWhen = (when: string) => build.gates.filter((g) => g.when === when && /tsc/.test(g.name));
    const [before] = byWhen("afterCommit");
    const [after] = byWhen("afterMerge");
    expect(before?.command, "an afterCommit tsc gate with a command").toBeTruthy();
    expect(after?.command, "an afterMerge tsc gate with a command").toBeTruthy();
    expect(after!.command).toBe(before!.command);
  });

  it("vitest: a park commit is not judged against the entry's named tests", async () => {
    const gate = build.gates.find((g) => g.name === "vitest")!;
    const entry: PendingEntry = { ...makeEntry("OPEN-1", { kind: "open" }), tests: ["a behavior the park never attempted"] } as PendingEntry;
    const r = await gate.run({ ...gateCtx("HEAD", "build", entry), touchedPaths: [NOTE] });
    expect(r.ok).toBe(true);
    expect(r.message).toBe("park: the note alone, not judged");
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

/**
 * The gate's third claim: a named behavior's test is red on the pre-fix
 * tree (`engineering.md`, *A fix ships the test that would have caught it*).
 * The judge runs over the real reporter's output; the base is materialized
 * with real git and the engine's own at-ref reader.
 */
describe("red on the base — the fix's tests against the pre-fix tree", () => {
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

  it("a named behavior that already passes at the base is refused by name; one with no passing test there is red; no report is refused", () => {
    const refused = judgeRedOnBase(details, [title, "nobody pins this"]);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("1 of 2 named behavior(s) already pass on the base");
    expect(refused.details).toContain(`- ${title}`);
    expect(refused.details).not.toContain("- nobody pins this");
    const red = judgeRedOnBase(details, ["nobody pins this"]);
    expect(red.ok).toBe(true);
    expect(red.message).toBe("1 named behavior(s) red on the base");
    expect(judgeRedOnBase("no report here", [title]).ok).toBe(false);
  });

  it("filesPinning names the repo-relative file holding each named line's passing test, and nothing for a line nobody pinned", () => {
    expect(filesPinning(details, [title], REPO_PATHS.repoRoot)).toEqual(["tests/paths.test.ts"]);
    expect(filesPinning(details, ["nobody pins this"], REPO_PATHS.repoRoot)).toEqual([]);
  });

  it("materializeBase checks the base out detached and lays the merged commit's named files over it, leaving every other file at the base; a named file absent from the commit throws", async () => {
    const repo = await initRepo("flume-red-base-");
    const put = async (rel: string, content: string) => {
      await mkdir(join(repo, rel, ".."), { recursive: true });
      await writeFile(join(repo, rel), content);
    };
    await put("src/a.ts", "base\n");
    await put("tests/a.test.ts", "old test\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "base"]);
    const base = git(repo, ["rev-parse", "HEAD"]);
    await put("src/a.ts", "fixed\n");
    await put("tests/a.test.ts", "new test\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "fix"]);
    const merged = git(repo, ["rev-parse", "HEAD"]);
    const wt = join(repo, ".flume", "worktrees", "red-on-base-x");

    await materializeBase(repo, base, merged, ["tests/a.test.ts"], wt, readFileAtRef);
    expect(readFileSync(join(wt, "src", "a.ts"), "utf8")).toBe("base\n");
    expect(readFileSync(join(wt, "tests", "a.test.ts"), "utf8")).toBe("new test\n");

    await expect(materializeBase(repo, base, merged, ["tests/missing.test.ts"], wt, readFileAtRef)).rejects.toThrow(
      "tests/missing.test.ts is not in",
    );
    removeWorktree(repo, wt);
    expect(existsSync(wt)).toBe(false);
    removeWorktree(repo, wt); // absent is fine
    await rm(repo, { recursive: true, force: true });
  });
});

describe("pins[] — a property that already holds, judged green only", () => {
  it("the entry extension declares pins[] beside tests[], both defaulting to empty", async () => {
    const { chain } = await loadChainModule(REPO_PATHS);
    const ext = chain.entryExtension!;
    // The declared schema is a zod schema behind the Standard Schema face.
    const parse = (field: string, v: unknown) => (ext[field]!.schema as unknown as { parse(v: unknown): unknown }).parse(v);
    expect(parse("pins", undefined)).toEqual([]);
    expect(parse("tests", undefined)).toEqual([]);
    expect(parse("pins", ["a pinned property"])).toEqual(["a pinned property"]);
    expect(ext["pins"]!.hint).toContain("never red on the base");
  });

  it("a vitest gate-revert record saying a named behavior already passes on the base wakes the inbox slice; any other gate-revert does not", async () => {
    const repo = await initRepo("flume-pins-");
    const flumeDir = join(repo, ".flume");
    await mkdir(join(flumeDir, "plan"), { recursive: true });
    await writeFile(join(flumeDir, "plan", "pending.json"), "[]\n");
    await writeFile(join(flumeDir, "plan", "state.md"), "# State\n");
    const { chain } = chainFactory(buildFlumeApi({ repoRoot: repo, configDir: flumeDir, flumeDir }));
    const inbox = chain.phases.find((p) => p.name === "plan-inbox")!;
    const pending = [makeEntry("OPEN-1", { kind: "open" })];
    const withRecord = (rec: object): TickContext => ({
      cwd: repo,
      flumeDir,
      pending,
      priorAttempts: new Map([[slugify("OPEN-1"), rec as unknown as PriorAttempt]]),
    });
    expect(
      inbox.shouldRun!(withRecord({ mode: "gate-revert", gate: "vitest", message: "2 of 2 named behavior(s) already pass on the base — the test pins nothing this entry changed" })),
    ).toBe(true);
    expect(inbox.shouldRun!(withRecord({ mode: "gate-revert", gate: "vitest", message: "3 test(s) failed — wave reverted" }))).toBe(false);
    expect(inbox.shouldRun!(withRecord({ mode: "gate-revert", gate: "tsc", message: "already pass on the base" }))).toBe(false);
    await rm(repo, { recursive: true, force: true });
  });
});

/**
 * `.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote* — the ladder's claim is that this chain's `handoff` and the engine's
 * `TickResult` agree, and the fixture above (`tickResult()`) folds the
 * engine's half of that vocabulary by the tester's hand. A field renamed,
 * dropped, or filled differently in `src/Dispatcher.ts` ships green over a
 * suite that keeps handing `handoff` the old shape.
 *
 * So the rungs below are walked by `Dispatcher.tick()` itself: the real
 * dispatcher checks the slice's `shouldRun`, renders its prompt, invokes the
 * agent, carries the commit back to the trunk through this chain's own three
 * plan gates, re-reads the queue, hands the `TickResult` it built to the
 * slice's `handoff`, and writes the answer to the baton — `awakeAfter` is
 * that baton, so nothing between the two sides is this test's.
 *
 * What stays the test's is the disk the ladder reads (a finding under
 * `<flumeDir>/inbox/`, the cursors in state.md, the queue, the spec commit
 * that arms derive) and the agent, which stands in for the model with a `git
 * commit`. The agent is swapped at `api.claudeCode` — the one override, the
 * same boundary `setupBuildWorktree`'s suite above overrides `setupWorktree`
 * at — because each slice declares `agent: planAgent`, so a
 * `DispatcherOptions.agent` never reaches it. Everything the factory
 * composes on top (the capture and renderer decorators, the gate list, the
 * prompt args) is the composition a real tick runs.
 *
 * Fast lane: no Node startup, no agent process, and the plan slices gate on
 * records/pending/per alone — no gate here shells a package manager. Raw git
 * plumbing on a temp fixture is not a lane trigger (spec/worktrees.md, *The
 * default test lane must stay fast*).
 */
describe("the plan ladder over a real tick", () => {
  const INBOX = "plan-inbox";
  const DERIVE = "plan-derive";
  const SWEEP = "plan-sweep";
  const BUILD = "build";

  /** What the re-derive leg files: pickable, inside build's fence, cite resolvable. */
  const filedEntry = {
    tag: "LADDER-PICKABLE",
    gate: { kind: "open" },
    dependsOnForks: [],
    files: {
      new: [],
      edit: [{ path: "src/seed.ts", description: "the work this entry ships" }],
      retire: [],
    },
    summary: "one entry for the rung below the ladder",
    per: { path: "spec/loop.md", section: "The baton" },
    tests: [],
    pins: [],
    acceptance: "the ladder hands the baton to build",
  };

  it("this chain's plan ladder routes the baton from a TickResult the dispatcher produced", async () => {
    const fx = await makeFixture();
    try {
      const repo = fx.repo;
      const flumeDir = join(repo, ".flume");
      const report = join(flumeDir, "inbox", "2026-09-11-report.md");
      const statePath = (root: string) => join(root, ".flume", "plan", "state.md");
      const stateMd = (derive: string, sweep: string, extra = "") =>
        `# State\n\nSpec derived through: \`${derive}\`\n\nPosture swept through: \`${sweep}\`\n\n${extra}`;

      // The disk the ladder reads, committed: a slice runs against tracked
      // content, so an uncommitted finding is simply absent where the agent
      // runs. `sessions/` is this chain's own artifact dir, gitignored the
      // way an adopting repo's .gitignore carries it.
      await writeFile(join(repo, ".gitignore"), ".flume/sessions/\n", { flag: "a" });
      await mkdir(join(flumeDir, "inbox"), { recursive: true });
      await mkdir(join(flumeDir, "plan"), { recursive: true });
      await writeFile(report, "# a report from the field\n");
      await writeFile(join(flumeDir, "plan", "pending.json"), "[]\n");
      await mkdir(join(repo, "spec"), { recursive: true });
      await writeFile(join(repo, "spec", "loop.md"), "# Loop\n\n## The baton\n\nbody\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "seed the plan artifacts"]);
      // Both cursors at the tip: a quiet tree, so every slice's liveness
      // below is the one this test arms and not a bootstrap default.
      const seeded = git(repo, ["rev-parse", "HEAD"]);
      await writeFile(statePath(repo), stateMd(seeded, seeded));
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "plan: stamp the cursors"]);

      // The real `Phase.promptPath` (`prompts/<slice>.md`), resolved against
      // a config dir this test owns. The shipped prompt's body is not this
      // seam — it is the agent's input, and the agent here is a stub — while
      // its inline-exec spans would put `pnpm tsc` on the fast lane once per
      // tick below.
      await mkdir(join(fx.configDir, "prompts"), { recursive: true });
      for (const slice of [INBOX, DERIVE, SWEEP]) {
        await writeFile(join(fx.configDir, "prompts", `${slice}.md`), "{{PENDING_SCHEMA}}\n");
      }

      /** The agent's whole contribution: a commit the engine has to classify. */
      let act: (cwd: string) => Promise<void> = async () => {};
      const { chain } = chainFactory({
        ...buildFlumeApi({ repoRoot: repo, configDir: fx.configDir, flumeDir }),
        claudeCode: () => ({
          name: "ladder-stub",
          invoke: async ({ cwd }) => {
            await act(cwd);
            return { exitCode: 0, stdout: "", stderr: "" };
          },
        }),
      });

      // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
      // a chain that lost a slice would satisfy the routing below over a
      // ladder with nothing to order.
      expect(chain.phases.map((p) => p.name)).toEqual([INBOX, DERIVE, SWEEP, BUILD]);

      const commits =
        (message: string, edit: (cwd: string) => void) =>
        async (cwd: string): Promise<void> => {
          edit(cwd);
          git(cwd, ["add", "-A"]);
          git(cwd, ["commit", "-q", "-m", message]);
        };
      /** An agent that exits clean having produced nothing. */
      const commitsNothing = async (): Promise<void> => {};

      /**
       * One real tick of `name`, with exactly that phase awake so the
       * returned `awakeAfter` is this tick's handoff and no leftover flag.
       * `DispatcherOptions.agent` throws: every slice declares its own, so
       * reaching the default would mean the phase's agent was dropped.
       */
      const tick = async (
        name: string,
        action: (cwd: string) => Promise<void>,
      ): Promise<TickOutcome> => {
        act = action;
        const baton = new Baton(flumeDir);
        for (const p of chain.phases) baton.sleep(p.name);
        baton.wake(name);
        const outcome = await new Dispatcher({
          repoRoot: repo,
          configDir: fx.configDir,
          flumeDir,
          agent: {
            name: "never-resolved",
            invoke: async () => {
              throw new Error("a plan slice declares its own agent");
            },
          },
          chainLoader: async () => ({ chain }),
          log: silent,
        }).tick();
        // Vacuity pin: a declined, hibernated or failed tick answers with a
        // baton the chain's `handoff` never saw, and every leg below would
        // be asserting over the flags this test set itself.
        expect(outcome.hibernated, outcome.summary).toBe(false);
        expect(outcome.failed, outcome.summary).toBeUndefined();
        expect(outcome.declined, outcome.summary).toBeUndefined();
        expect(outcome.result?.phaseName, outcome.summary).toBe(name);
        expect(outcome.result?.flumeDir).toBe(flumeDir);
        return outcome;
      };

      /**
       * Every gate a plan slice runs under reported, and none refused: the
       * three this chain declares plus the engine's own phase fence.
       */
      const gatesGreen = (outcome: TickOutcome): void => {
        expect(outcome.result?.gateResults.map((g) => g.gate).sort()).toEqual([
          "clean-tree",
          "pending-gate",
          "per cites resolve",
          "records",
          "writable-paths",
        ]);
        expect(
          outcome.result?.gateResults.every((g) => g.ok),
          JSON.stringify(outcome.result?.gateResults),
        ).toBe(true);
      };

      // The finding is still on disk after the slice committed: a window
      // wider than one tick's budget re-wakes its own slice.
      const held = await tick(
        INBOX,
        commits("plan: record what the report says", (cwd) => {
          writeFileSync(statePath(cwd), stateMd(seeded, seeded, "Read the report; routing next tick.\n"));
        }),
      );
      expect(held.result?.committed).toBe(true);
      gatesGreen(held);
      expect(held.awakeAfter).toEqual([INBOX]);

      // Same window, and this time the slice closed nothing. It does not
      // re-wake itself, nothing below it is live, and the queue the engine
      // re-read after the tick is empty: hibernation.
      const quiet = await tick(INBOX, commitsNothing);
      expect(quiet.result?.committed).toBe(false);
      expect(quiet.noCommit).toBe("clean-exit");
      expect(quiet.result?.pickableAfter).toEqual([]);
      expect(quiet.awakeAfter).toEqual([]);

      // Intent moves: a spec commit past the derive cursor arms the rung
      // below the inbox (and the sweep, whose domain carries spec/ too).
      await writeFile(join(repo, "spec", "loop.md"), "# Loop\n\n## The baton\n\nwider body\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "spec: widen The baton"]);

      // Still nothing routed, but now the exclusion has somewhere to fall:
      // the slice hands on rather than looping on its own unroutable note.
      const handOn = await tick(INBOX, commitsNothing);
      expect(handOn.result?.committed).toBe(false);
      expect(handOn.awakeAfter).toEqual([DERIVE]);

      // The exclusion is the slice's own: its sibling still answers with the
      // rung above, whose window is open.
      const sibling = await tick(DERIVE, commitsNothing);
      expect(sibling.result?.committed).toBe(false);
      expect(sibling.awakeAfter).toEqual([INBOX]);

      // Drained — through a commit the engine carried back to the trunk the
      // ladder's predicate reads — and the baton falls to the next rung.
      const drained = await tick(
        INBOX,
        commits("plan: drain the inbox", (cwd) => {
          rmSync(join(cwd, ".flume", "inbox", "2026-09-11-report.md"));
        }),
      );
      expect(drained.result?.committed).toBe(true);
      gatesGreen(drained);
      // git removes the directory with its last tracked file, so the drained
      // state the predicate answers on is the ENOENT leg of its own read.
      expect(existsSync(report)).toBe(false);
      expect(existsSync(join(flumeDir, "inbox"))).toBe(false);
      expect(drained.awakeAfter).toEqual([DERIVE]);

      // The re-derive files one entry and advances its own cursor — leaving
      // the sweep's behind, so the last rung is the sweep yielding to
      // pickable work rather than an empty frontier. `pickableAfter` is the
      // dispatcher's own verdict over the queue this commit wrote.
      const refilled = await tick(
        DERIVE,
        commits("plan: file one entry", (cwd) => {
          writeFileSync(
            join(cwd, ".flume", "plan", "pending.json"),
            `${JSON.stringify([filedEntry], null, 2)}\n`,
          );
          writeFileSync(statePath(cwd), stateMd(git(cwd, ["rev-parse", "HEAD"]), seeded));
        }),
      );
      expect(refilled.result?.committed).toBe(true);
      gatesGreen(refilled);
      expect(
        refilled.result?.gateResults.find((g) => g.gate === "per cites resolve")?.message,
      ).toBe("1 per cite(s) resolve");
      expect(refilled.result?.pickableAfter.map((e) => e.tag)).toEqual([filedEntry.tag]);
      // The sweep is live on the same spec commit its cursor never caught up
      // to, and still yields: the queue is the product, the sweep insurance.
      expect(chain.phases.find((p) => p.name === SWEEP)!.shouldRun!({ cwd: repo, flumeDir, pending: [] })).toBe(true);
      expect(refilled.awakeAfter).toEqual([BUILD]);
    } finally {
      await fx.cleanup();
    }
  }, 60_000);
});

/**
 * `.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote* — the build half of the same claim the plan ladder above makes.
 * `build.handoff` reads `TickResult.entries[].mergeOutcome`, `noCommit`, and
 * `pickableAfter`; a suite that hands it those fields by the tester's hand
 * pins nothing about the dispatcher that fills them, so a wave's merge
 * vocabulary is produced here by `Dispatcher.tick()` itself — real
 * worktrees, a real cherry-pick, this chain's own `shipped` predicate — and
 * `awakeAfter` is the baton the engine wrote from the answer.
 *
 * What stays the test's is the agent and two costs a fast lane cannot pay:
 * `api.setupWorktree` (the install, already the override seam
 * `setupBuildWorktree`'s suite above uses) and `api.tscGate` (the
 * package-manager typecheck, which needs that install). Neither is this
 * seam. The `vitest` gate is not overridden — it is the real one, taking
 * its own declared skip, because every entry here names no behavior and
 * ships outside the code paths it keys on.
 */
describe("the build wave over a real tick", () => {
  const INBOX = "plan-inbox";
  const DERIVE = "plan-derive";
  const SWEEP = "plan-sweep";
  const BUILD = "build";

  /** A gate that reports green without spawning anything, in the shape `FlumeApi.tscGate` declares. */
  function stubbedGreen(name: string): PkgManagerGate {
    const gate: Gate = {
      name,
      when: "afterCommit",
      run: async () => ({ ok: true, message: `${name} stubbed green` }),
    };
    const fn = (() => gate) as unknown as PkgManagerGate;
    Object.defineProperty(fn, "name", { value: name, configurable: true });
    fn.when = gate.when;
    fn.run = gate.run;
    return fn;
  }

  interface WaveEntry {
    tag: string;
    /** The one file the entry declares — what the dispatcher partitions the wave on. */
    declares: string;
    /** What the agent does in this entry's worktree. A no-op is a clean exit. */
    act: (cwd: string) => void;
  }

  /** An agent that writes one file and commits it. */
  const writes =
    (rel: string, content: string) =>
    (cwd: string): void => {
      mkdirSync(join(cwd, dirname(rel)), { recursive: true });
      writeFileSync(join(cwd, rel), content);
      git(cwd, ["add", "-A"]);
      git(cwd, ["commit", "-q", "-m", `build: write ${rel}`]);
    };
  /** The park shape this chain's `shipped` reads: the entry's own note, alone. */
  const parks = (tag: string) =>
    writes(`.flume/plan/notes/${tag}.md`, `# ${tag} parked\n\nthe premise does not hold on this tree.\n`);
  /** An agent that exits clean having produced nothing. */
  const commitsNothing = (): void => {};

  /** Pickable, inside build's fence, `per` resolvable from the worktree's own tree. */
  const queueEntry = (e: WaveEntry) => ({
    tag: e.tag,
    gate: { kind: "open" },
    dependsOnForks: [],
    files: { new: [], edit: [{ path: e.declares, description: "the file this entry declares" }], retire: [] },
    summary: `${e.tag} ships one file`,
    per: { path: "docs/rationale.md", section: "The reason" },
    tests: [],
    pins: [],
    acceptance: "the wave hands the baton on",
  });

  interface Harness {
    repo: string;
    flumeDir: string;
    /** The real `build` phase off the real factory — the consumer under test. */
    build: Phase;
    /** Queue `entries` on the trunk, wake build, run one real wave. */
    wave: (entries: WaveEntry[]) => Promise<TickOutcome>;
    /** A commit on the trunk that no wave made — what arms a plan slice. */
    commitOnTrunk: (rel: string, content: string, msg: string) => void;
    cleanup: () => Promise<void>;
  }

  async function harness(): Promise<Harness> {
    const fx = await makeFixture();
    const repo = fx.repo;
    const flumeDir = join(repo, ".flume");
    const acts = new Map<string, (cwd: string) => void>();

    // `sessions/` is this chain's own artifact dir, gitignored the way an
    // adopting repo's .gitignore carries it.
    await writeFile(join(repo, ".gitignore"), ".flume/sessions/\n", { flag: "a" });
    await mkdir(join(flumeDir, "plan"), { recursive: true });
    await writeFile(join(flumeDir, "plan", "pending.json"), "[]\n");
    // `setupBuildWorktree` derives its sentinel from the worktree's own
    // manifest; with no dependencies declared there is nothing to assert.
    await writeFile(
      join(repo, "package.json"),
      `${JSON.stringify({ name: "wave-fixture", version: "0.0.0" }, null, 2)}\n`,
    );
    await mkdir(join(repo, "docs"), { recursive: true });
    await writeFile(join(repo, "docs", "rationale.md"), "# Rationale\n\n## The reason\n\nbody\n");
    await mkdir(join(fx.configDir, "prompts"), { recursive: true });
    await writeFile(join(fx.configDir, "prompts", "build.md"), "Ship {{TAG}}.\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "seed the build fixture"]);
    // Both cursors at the tip: every slice below is live for the reason
    // this test arms and not a bootstrap default. The stamping commit
    // touches only state.md, which is in neither slice's window.
    const seeded = git(repo, ["rev-parse", "HEAD"]);
    await writeFile(
      join(flumeDir, "plan", "state.md"),
      `# State\n\nSpec derived through: \`${seeded}\`\n\nPosture swept through: \`${seeded}\`\n`,
    );
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "plan: stamp the cursors"]);

    const { chain } = chainFactory({
      ...buildFlumeApi({ repoRoot: repo, configDir: fx.configDir, flumeDir }),
      setupWorktree: async () => {},
      tscGate: stubbedGreen("tsc"),
      claudeCode: () => ({
        name: "wave-stub",
        invoke: async ({ cwd }) => {
          const act = acts.get(basename(cwd));
          if (!act) throw new Error(`wave-stub: no action for worktree '${basename(cwd)}'`);
          act(cwd);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    });
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // a chain that lost a plan slice would satisfy the ladder legs below
    // over a rung list with nothing to order.
    expect(chain.phases.map((p) => p.name)).toEqual([INBOX, DERIVE, SWEEP, BUILD]);

    const wave = async (entries: WaveEntry[]): Promise<TickOutcome> => {
      acts.clear();
      for (const e of entries) acts.set(slugify(e.tag), e.act);
      await writeFile(
        join(flumeDir, "plan", "pending.json"),
        `${JSON.stringify(entries.map(queueEntry), null, 2)}\n`,
      );
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "plan: queue the wave"]);
      const baton = new Baton(flumeDir);
      for (const p of chain.phases) baton.sleep(p.name);
      baton.wake(BUILD);
      const outcome = await new Dispatcher({
        repoRoot: repo,
        configDir: fx.configDir,
        flumeDir,
        agent: {
          name: "never-resolved",
          invoke: async () => {
            throw new Error("the build phase declares its own agent");
          },
        },
        chainLoader: async () => ({ chain }),
        log: silent,
        maxParallel: 4,
      }).tick();
      // Vacuity pin: a declined, hibernated or failed tick answers with a
      // baton this chain's `handoff` never saw, and every leg below would
      // be asserting over the flags this test set itself. The entry records
      // are the handoff's own input — an entry dropped in provisioning
      // reports nowhere on them.
      expect(outcome.hibernated, outcome.summary).toBe(false);
      expect(outcome.failed, outcome.summary).toBeUndefined();
      expect(outcome.declined, outcome.summary).toBeUndefined();
      expect(outcome.result?.phaseName, outcome.summary).toBe(BUILD);
      expect(outcome.result?.provisionFailures, outcome.summary).toBeUndefined();
      expect([...(outcome.result?.entries ?? [])].map((e) => e.tag).sort(), outcome.summary).toEqual(
        entries.map((e) => e.tag).sort(),
      );
      return outcome;
    };

    return {
      repo,
      flumeDir,
      build: chain.phases.find((p) => p.name === BUILD)!,
      wave,
      commitOnTrunk: (rel, content, msg) => {
        mkdirSync(join(repo, dirname(rel)), { recursive: true });
        writeFileSync(join(repo, rel), content);
        git(repo, ["add", "-A"]);
        git(repo, ["commit", "-q", "-m", msg]);
      },
      cleanup: fx.cleanup,
    };
  }

  /** The merge outcome the engine recorded for `tag` on this wave. */
  const outcomeOf = (tick: TickOutcome, tag: string): string | undefined =>
    tick.result?.entries?.find((e) => e.tag === tag)?.mergeOutcome;

  it("a build wave the engine marked cherry-pick-conflict re-wakes build and one it marked not-shipped wakes the inbox slice, off a TickResult the dispatcher produced", async () => {
    const h = await harness();
    try {
      // Two entries the queue declares as disjoint, whose agents both create
      // the same undeclared file: the first cherry-picks clean, the second
      // is an add/add conflict on the trunk the first just moved.
      const conflicted = await h.wave([
        { tag: "COLLIDE-A", declares: "docs/a.md", act: writes("docs/collide.md", "from A\n") },
        { tag: "COLLIDE-B", declares: "docs/b.md", act: writes("docs/collide.md", "from B\n") },
      ]);
      expect(outcomeOf(conflicted, "COLLIDE-A")).toBe("merged");
      expect(outcomeOf(conflicted, "COLLIDE-B")).toBe("cherry-pick-conflict");
      // The conflicted entry is still queued and still pickable, and a
      // conflict is nobody's to reconcile but the next wave's — so the
      // ladder answers with build, not the inbox.
      expect(conflicted.result?.pickableAfter.map((e) => e.tag)).toEqual(["COLLIDE-B"]);
      expect(conflicted.awakeAfter).toEqual([BUILD]);

      // An agent that committed nothing: the wave shipped nothing usable,
      // and the entry stays pickable. Nothing is on disk for the inbox
      // slice to be live on, so this answer is the refusal leg's alone.
      const refused = await h.wave([
        { tag: "GIVES-UP", declares: "docs/c.md", act: commitsNothing },
        { tag: "SHIPS-ANYWAY", declares: "docs/d.md", act: writes("docs/d.md", "shipped\n") },
      ]);
      expect(refused.result?.entries?.find((e) => e.tag === "GIVES-UP")?.noCommit).toBe("clean-exit");
      expect(refused.result?.shippedTags).toEqual(["SHIPS-ANYWAY"]);
      expect(refused.result?.pickableAfter.map((e) => e.tag)).toEqual(["GIVES-UP"]);
      expect(refused.awakeAfter).toEqual([INBOX]);

      // A park: the commit landed, and this chain's own `shipped` read its
      // sole path as the entry's note and declined. The engine reports that
      // as `not-shipped` — indistinguishable from a conflict in
      // committed/shipped/reverted, which is the whole reason handoff reads
      // the merge outcome.
      const parked = await h.wave([
        { tag: "PARK-ME", declares: "docs/e.md", act: parks("PARK-ME") },
        { tag: "SHIPS-BESIDE", declares: "docs/f.md", act: writes("docs/f.md", "shipped\n") },
      ]);
      expect(outcomeOf(parked, "PARK-ME")).toBe("not-shipped");
      expect(outcomeOf(parked, "SHIPS-BESIDE")).toBe("merged");
      expect(parked.result?.committed).toBe(true);
      expect(parked.result?.noCommit).toBeUndefined();
      expect(parked.result?.pickableAfter.map((e) => e.tag)).toEqual(["PARK-ME"]);
      expect(parked.awakeAfter).toEqual([INBOX]);

      // The park's note rode the cherry-pick onto the trunk, so the inbox
      // slice is now live on its own account too. Drain it and ask the same
      // real `TickResult` again: the answer is still the inbox, which only
      // `mergeOutcome: "not-shipped"` can be giving.
      rmSync(join(h.flumeDir, "plan", "notes", "PARK-ME.md"));
      expect(h.build.handoff(parked.result!)).toEqual([INBOX]);
    } finally {
      await h.cleanup();
    }
  }, 60_000);

  it("a clean build wave with nothing pickable falls through this chain's ladder to the sweep, off a TickResult the dispatcher produced", async () => {
    const h = await harness();
    try {
      // Nothing refused, nothing left pickable, and no slice's window is
      // open: the wave hibernates the loop outright.
      const quiet = await h.wave([
        { tag: "SHIP-ONE", declares: "docs/one.md", act: writes("docs/one.md", "one\n") },
      ]);
      expect(quiet.result?.shippedTags).toEqual(["SHIP-ONE"]);
      expect(quiet.result?.pickableAfter).toEqual([]);
      expect(quiet.awakeAfter).toEqual([]);

      // A commit in the sweep's domain the sweep cursor never caught up to.
      // It is the test's, not the wave's: a build commit that armed the
      // sweep would be a code path, and the real `vitest` gate this suite
      // keeps would then run the whole suite inside the fixture.
      h.commitOnTrunk("src/seed.ts", "// swept\n", "build: an earlier wave's code");
      const swept = await h.wave([
        { tag: "SHIP-TWO", declares: "docs/two.md", act: writes("docs/two.md", "two\n") },
      ]);
      expect(swept.result?.shippedTags).toEqual(["SHIP-TWO"]);
      expect(swept.result?.pickableAfter).toEqual([]);
      expect(swept.awakeAfter).toEqual([SWEEP]);

      // Intent moved: derive sits above the sweep on the ladder, so a spec
      // commit past its cursor takes the baton first.
      h.commitOnTrunk("spec/loop.md", "# Loop\n\n## The baton\n\nbody\n", "spec: widen The baton");
      const derived = await h.wave([
        { tag: "SHIP-THREE", declares: "docs/three.md", act: writes("docs/three.md", "three\n") },
      ]);
      expect(derived.result?.shippedTags).toEqual(["SHIP-THREE"]);
      expect(derived.result?.pickableAfter).toEqual([]);
      expect(derived.awakeAfter).toEqual([DERIVE]);
    } finally {
      await h.cleanup();
    }
  }, 60_000);
});
