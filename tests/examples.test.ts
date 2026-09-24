/**
 * Fast-lane shape pins over the shipped example chains. Most of what follows
 * is a pure read of the chain object a factory returns — no fixture repo, no
 * subprocess.
 *
 * The exception is the ladder's agreement drive, which runs
 * `Dispatcher.tick()` over a temp git repo: the claim there is that the
 * engine's `TickResult` and the chain's `handoff` agree, and only the real
 * writer can prove it (`.claude/rules/engineering.md`, *A seam gate reads
 * what the real writer wrote*). It stays in this lane deliberately — raw git
 * plumbing on a fixture is not a lane trigger; Node startup, a real agent and
 * wall-clock assertions are, and it has none (spec/worktrees.md, *The default
 * test lane must stay fast*). The full tick-cycle drives that do spawn stay
 * in `examples.integration.test.ts`.
 *
 * The second exception is the span-rendering block below: every case that
 * puts a shipped template through `renderPrompt` starts one `sh` per
 * inline-exec span, which is the subject of those cases rather than
 * overhead. This file declares `SPAWN_BUDGET_MS` at file scope rather than
 * inheriting the runner's default, and `tests/helpers/spawnBudget.ts` reports
 * the entry so a new case cannot land outside it.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Gate, GateContext } from "../src/Gate.ts";
import type { Chain, Phase, TickContext, TickResult } from "../src/Phase.ts";
import { entryFileName } from "../src/PendingSchema.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { PriorAttempt } from "../src/Prompt.ts";
import { InlineExecRenderError, renderPrompt } from "../src/Prompt.ts";
import { Baton } from "../src/Baton.ts";
import * as builtinGates from "../src/builtinGates.ts";
import { Dispatcher, type TickOutcome } from "../src/Dispatcher.ts";
import { resolvePendingDir } from "../src/paths.ts";
import {
  buildFlumeApi,
  type FlumeApi,
  type FlumePaths,
} from "../src/flumeApi.ts";
import { makeFixture, silent, type Fixture } from "./helpers/dispatcherFixture.ts";
import { bulletOf, restatementsOf, walkOf } from "./helpers/docSections.ts";
import { docWalk, type DocWalkRequest } from "./helpers/docWalk.ts";
import { mkTempDirSync } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, exec } from "./helpers/subprocess.ts";
import backlogGroomerFactory from "../examples/backlog-groomer-chain.ts";
import cascadeFactory, {
  declaredFilesGate,
} from "../examples/cascade-chain.ts";
import minimalFactory from "../examples/minimal-chain.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/**
 * The roots a real tick would resolve for an `examples/`-hosted chain — this
 * checkout's. What is built from it below is read, or driven at a gate over
 * a hand-built `GateContext` — never handed to a `Dispatcher`, so there is
 * no engine-resolved root for these roots to disagree with. A drive that
 * ticks builds its chain from the roots it ticks (`ladderDrive`, below).
 */
const EXAMPLE_PATHS: FlumePaths = {
  repoRoot: fileURLToPath(new URL("..", import.meta.url)),
  configDir: fileURLToPath(new URL("../examples", import.meta.url)),
  flumeDir: fileURLToPath(new URL("../.flume", import.meta.url)),
};

const { chain: cascadeChain } = cascadeFactory(buildFlumeApi(EXAMPLE_PATHS));
const { chain: backlogGroomerChain } = backlogGroomerFactory(
  buildFlumeApi(EXAMPLE_PATHS),
);
const { chain: minimalChain } = minimalFactory(buildFlumeApi(EXAMPLE_PATHS));

/**
 * spec/chain.md, *Gate placement is the chain's decision* — expensive
 * correctness gates at `afterMerge`, cheap structural ones at `afterCommit`.
 * The flagship example is read as doctrine, so its own split is pinned: an
 * all-`afterCommit` gate list there teaches the staleness window that section
 * argues against.
 */
describe("cascade-chain.ts — build gates split by cost", () => {
  it("the cascade example places its vitest gate at afterMerge and its type gate at afterCommit", () => {
    const buildPhase = cascadeChain.phases.find((p) => p.name === "build");
    expect(buildPhase).toBeDefined();
    const gates = buildPhase!.gates;
    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): the lookups below would every() over nothing if the list
    // were empty, and would silently miss a gate if two shared a name.
    const placement = new Map(gates.map((g) => [g.name, g.when]));
    expect(gates.length).toBeGreaterThan(0);
    expect(placement.size).toBe(gates.length);
    expect([...placement.keys()].sort()).toEqual([
      "declared-files",
      "eslint",
      "tsc",
      "vitest",
    ]);

    expect(placement.get("vitest")).toBe("afterMerge");
    expect(placement.get("tsc")).toBe("afterCommit");
    expect(placement.get("eslint")).toBe("afterCommit");
    expect(placement.get("declared-files")).toBe("afterCommit");
  });
});

/**
 * `.claude/rules/engineering.md`, "An export earns its consumer" — a shipped
 * example is public surface, and a phase no consumer runs is residue a chain
 * author reads as the recommended shape. Cascade carried a `spec` phase over
 * a `specs/active` / `specs/_aligned` / `workshop/_archive` partition that no
 * current chain runs; what the flagship teaches is now the plan+build shape
 * flume's own `.flume/chain.ts` dogfoods.
 */
describe("cascade-chain.ts — the shipped phase list", () => {
  it("the cascade example declares plan and build and no spec phase", () => {
    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): an empty phase list would satisfy every absence assertion
    // below.
    // Which phases, not in which order — the order is its own claim, pinned
    // by the case below.
    expect(cascadeChain.phases.length).toBeGreaterThan(0);
    expect(cascadeChain.phases).toHaveLength(3);
    expect(new Set(cascadeChain.phases.map((p) => p.name))).toEqual(
      new Set(["build", "plan-inbox", "plan-derive"]),
    );

    // The retired phase's fence partition goes with it — a `specs/**` or
    // `workshop/**` glob surviving on a sibling phase would keep teaching the
    // corpus layout the cut removed.
    const fence = cascadeChain.phases.flatMap((p) => p.writablePaths);
    expect(fence.length).toBeGreaterThan(0);
    expect(fence.filter((g) => /^(?:specs|workshop)\//.test(g))).toEqual([]);

    // `humanOnly` named the cut phase; nothing else in this chain is
    // human-woken, so the list is empty rather than stale.
    expect(cascadeChain.humanOnly).toEqual([]);
  });

  /**
   * The list is the budget's priority, not the dependency ladder
   * (spec/loop.md, *Which phases run*): the supervisor starts children down
   * it until `supervisorPolicy.maxTicks` are running, and at the engine's
   * default of one that order is the whole schedule. The flagship is copied
   * into chains that declare no ladder of their own, so a plan slice sitting
   * ahead of `build` in the shipped file inverts the loop's economics for
   * every one of them — insurance scheduled ahead of the product.
   */
  it("the cascade example declares build first and its plan slices after it", () => {
    const names = cascadeChain.phases.map((p) => p.name);
    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): a chain of one phase, or one that lost its planners,
    // satisfies a "build is first" claim over nothing.
    expect(names.length).toBeGreaterThan(1);
    expect(names.filter((n) => n.startsWith("plan")).length).toBeGreaterThan(0);

    expect(names[0]).toBe("build");
    expect(names.slice(1).every((n) => n.startsWith("plan"))).toBe(true);
    // The ladder's own order survives behind it: the inbox rung ahead of the
    // re-derive, the order `nextPhase` walks.
    expect(names.slice(1)).toEqual(["plan-inbox", "plan-derive"]);
  });
});

/**
 * The flagship's fence is read as doctrine, so the doctrine it teaches has to
 * survive the state root moving: `FLUME_DIR` relocates it, and
 * a fence spelled `.flume/` would then guard a directory no tick writes — every
 * plan commit reverted for paths outside a glob that matches nothing. Driven
 * through the real factory over the real `buildFlumeApi`, the seam a chain-load
 * actually uses (.claude/rules/engineering.md, *A seam gate reads what the real
 * writer wrote*).
 */
describe("cascade-chain.ts — the plan fence roots at the reported state root", () => {
  /** Every plan slice's fence, for a cascade built from these roots. */
  function planFence(flumeDir: string): string[] {
    const { chain } = cascadeFactory(
      buildFlumeApi({ ...EXAMPLE_PATHS, flumeDir }),
    );
    return chain.phases
      .filter((p) => p.name !== "build")
      .flatMap((p) => p.writablePaths);
  }

  it("the cascade chain's plan fence follows a relocated state root", () => {
    // The default root first: the offset the fence is built from is a real
    // value, not an empty string that would make every claim below vacuous.
    const at = planFence(join(EXAMPLE_PATHS.repoRoot, ".flume"));
    expect(at.length).toBeGreaterThan(0);
    expect(at).toContain(".flume/plan/pending/*.json");
    expect(at).toContain(".flume/inbox/**");

    // The same chain under a state root relocated inside the repo: the whole
    // fence moves with the root, in git's alphabet, with nothing left behind
    // at the literal.
    const moved = planFence(
      join(EXAMPLE_PATHS.repoRoot, "state", "alpha"),
    );
    expect(moved).toEqual(
      at.map((g) => g.replace(/^\.flume\//, "state/alpha/")),
    );
    expect(moved.filter((g) => g.startsWith(".flume/"))).toEqual([]);
    expect(moved).toContain("state/alpha/plan/pending/*.json");
  });

  it("cascade refuses at chain load when its state root resolves outside the repository", () => {
    expect(() =>
      planFence(join(EXAMPLE_PATHS.repoRoot, "..", "flume-state-elsewhere")),
    ).toThrow(/resolves outside the repository/);
  });
});

/**
 * Agreement pin (.claude/rules/engineering.md, "A seam gate reads what the real
 * writer wrote"): `examples/prompts/` ships the prompt files the example chains
 * name, and `Phase.promptPath` is the only thing that names one. A file left
 * behind after its phase is cut is dead weight a reader takes for a live
 * template — the shape no test caught when a cut phase's prompt outlived
 * nothing.
 *
 * One direction only. The reverse — every `promptPath` resolves to a shipped
 * file — is false by design: `minimal-chain.ts` points at `prompts/notes.md`,
 * which its trailing block tells the copying consumer to author.
 */
describe("examples/prompts — every shipped prompt has a phase that names it", () => {
  const chains: Chain[] = [cascadeChain, backlogGroomerChain, minimalChain];

  it("no prompt file under examples/prompts/ is unreferenced by an example phase", () => {
    const shipped = readdirSync(
      fileURLToPath(new URL("../examples/prompts", import.meta.url)),
    )
      .filter((f) => f.endsWith(".md"))
      .sort();
    const declared = new Set(
      chains.flatMap((c) => c.phases.map((p) => p.promptPath)),
    );
    // Vacuity pin: an empty directory listing, or a chain set that declared
    // no prompts, passes the subset check below over nothing.
    expect(shipped.length).toBeGreaterThan(0);
    expect(declared.size).toBeGreaterThan(0);

    expect(
      shipped.filter((name) => !declared.has(`prompts/${name}`)),
    ).toEqual([]);
  });
});

/**
 * `spec/prompt.md`, *The reserved `{{FLUME_DIR}}` prompt arg* — the token
 * exists to close the footgun where a template hardcodes `.flume/` while the
 * dispatcher resolved a relocated root. A shipped example is a template a
 * consumer copies, so a literal there teaches the footgun rather than the
 * affordance, and the plan template's spans carry `|| echo` fallbacks: a
 * miss renders as "(none)" and the tick plans blind instead of refusing
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Agreement gate (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*): the real reader is the engine's `renderPrompt` over the
 * shipped markdown, handed the root the way a dispatcher hands it — reserved,
 * merged past `args`. The seam under test is the template's rooting and quoting
 * against that substitution, so the state root is awkward in a shell: the
 * engine quotes nothing, and an unquoted `{{FLUME_DIR}}` word-splits on a space
 * and loses a backslash before `sh` ever opens the file. The prompts' per-tick
 * arg vocabulary is a separate claim, pinned below against the real
 * `promptArgs`; here those keys are filled from the file's own placeholders.
 */
describe("examples/prompts — the spans read the injected state root", () => {
  const PROMPT_DIR = fileURLToPath(new URL("../examples/prompts", import.meta.url));
  /** The engine's inline-exec grammar and placeholder grammar, as it spells them. */
  const SPAN = /!\s*`([^`]+)`/g;
  const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

  /** Every shipped example prompt, paired with the phase that names it. */
  const shipped = readdirSync(PROMPT_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => ({
      file,
      phase: [cascadeChain, backlogGroomerChain, minimalChain]
        .flatMap((c) => c.phases)
        .find((p) => p.promptPath === `prompts/${file}`),
    }));

  /**
   * Every shipped template's bytes as they ship — one read, from which the span
   * sweep below is derived rather than read a second time
   * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*). What a
   * consumer copies is the whole file, so a pin whose subject is the template
   * rather than its spans reads this.
   */
  const sources = shipped.map(({ file }) => ({
    file,
    text: readFileSync(join(PROMPT_DIR, file), "utf8"),
  }));

  /**
   * Every inline-exec span across the shipped set, paired with the template
   * that carries it — one sweep, read by every absence pin below
   * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*:
   * detection a sibling surface already performs is shared, never re-derived
   * beside it).
   */
  const allSpans = sources.flatMap(({ file, text }) =>
    [...text.matchAll(SPAN)].map((m) => ({
      file,
      cmd: m[1]!,
    })),
  );

  /**
   * The artifacts a template's spans read under the state root. The queue's
   * path is the engine's (`resolvePendingDir`); the rest are this example's
   * own layout, which only its prompt and its fence spell. A sentinel rides
   * each one so a case asserts the bytes *arrived*, not merely that the
   * render did not throw.
   */
  const ARTIFACTS: ReadonlyArray<{
    /** What a span names, relative to the state root — the detector. */
    readonly span: string;
    readonly at: (root: string) => string;
    readonly body: string;
    readonly sentinel: string;
    /**
     * What the span renders when the artifact is legitimately absent — tick
     * one, before anything has written it.
     */
    readonly placeholder: string;
    /**
     * The path the span hands its reader, when that is not `at`: a listing
     * span opens the *directory*, so that is what has to exist and be
     * readable, and a `.md` under it is incidental.
     */
    readonly opensDir?: (root: string) => string;
  }> = [
    {
      // The queue is a directory of one entry per file, so the span opens the
      // directory and the sentinel rides an entry inside it
      // (`spec/pending.md`, *The ledger is a directory — one entry per file*).
      span: "plan/pending",
      at: (root) => join(resolvePendingDir(root), "SENTINEL-TAG.json"),
      opensDir: (root) => resolvePendingDir(root),
      body: '{ "note": "PENDING-SENTINEL" }\n',
      sentinel: "PENDING-SENTINEL",
      placeholder: "(no queue directory yet)",
    },
    {
      span: "plan/state.md",
      at: (root) => join(root, "plan", "state.md"),
      body: "phase: PLAN-STATE-SENTINEL\n",
      sentinel: "PLAN-STATE-SENTINEL",
      placeholder: "(no prior state)",
    },
    {
      span: "plan/open-questions.md",
      at: (root) => join(root, "plan", "open-questions.md"),
      body: "## QUESTIONS-SENTINEL\n",
      sentinel: "QUESTIONS-SENTINEL",
      placeholder: "(none)",
    },
    {
      // The inbox span lists rather than reads, so its sentinel is a filename.
      span: "inbox",
      at: (root) => join(root, "inbox", "INBOX-SENTINEL.md"),
      body: "# a finding\n",
      sentinel: "INBOX-SENTINEL",
      placeholder: "(drained)",
      opensDir: (root) => join(root, "inbox"),
    },
  ];

  /** The path one span opens, and the kind it must find there. */
  function opened(
    artifact: (typeof ARTIFACTS)[number],
    root: string,
  ): { path: string; kind: "file" | "dir" } {
    return artifact.opensDir
      ? { path: artifact.opensDir(root), kind: "dir" }
      : { path: artifact.at(root), kind: "file" };
  }

  /** Every scratch dir a case made, torn down together. */
  const scratch: string[] = [];

  /** The corpus file the plan template's `<spec-corpus>` span indexes. */
  const CORPUS_SENTINEL = "corpus-sentinel.md";

  /**
   * A tick cwd the spans not under test can resolve in: a real repo with a
   * real commit, because `git log` carries no fallback and the render aborts
   * on any non-zero span. `withCorpus` seeds the corpus root the
   * `<spec-corpus>` span now refuses without.
   */
  async function seedTickCwd(prefix: string, withCorpus: boolean): Promise<string> {
    const dir = mkTempDirSync(prefix);
    scratch.push(dir);
    writeFileSync(join(dir, "README.md"), "scratch\n");
    if (withCorpus) {
      mkdirSync(join(dir, "specs"), { recursive: true });
      writeFileSync(join(dir, "specs", CORPUS_SENTINEL), "# a spec\n");
    }
    await exec("git", ["init", "-q", "-b", "main"], { cwd: dir });
    await exec("git", ["add", "-A"], { cwd: dir });
    await exec(
      "git",
      [
        "-c",
        "user.email=scratch@example.test",
        "-c",
        "user.name=scratch",
        "commit",
        "-qm",
        "seed",
      ],
      { cwd: dir },
    );
    return dir;
  }

  /**
   * The cwd a render runs its spans in — rather than this checkout, whose
   * `pnpm tsc` span would typecheck the tree per case.
   */
  let cwd: string;

  beforeAll(async () => {
    cwd = await seedTickCwd("flume-example-prompts-cwd-", true);
  });

  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * One shipped template through the engine's real renderer. `overrides`
   * supplies a per-tick arg a case needs to *mean* something — a `per` path
   * that resolves, or one that does not — rather than the filler below.
   */
  async function render(
    file: string,
    phase: Phase,
    root: string,
    at = cwd,
    overrides: Readonly<Record<string, string>> = {},
  ): Promise<string> {
    const promptFile = join(PROMPT_DIR, file);
    const raw = readFileSync(promptFile, "utf8");
    const args = {
      ...Object.fromEntries(
        [...raw.matchAll(PLACEHOLDER)]
          .map((m) => m[1]!)
          .filter((key) => key !== "FLUME_DIR")
          .map((key) => [key, `<per-tick ${key}>`]),
      ),
      ...overrides,
    };
    return renderPrompt({ phase, promptFile, cwd: at, flumeDir: root, args });
  }

  /** A state root carrying every artifact the templates' spans read. */
  function seedStateRoot(prefix: string): string {
    const root = mkTempDirSync(prefix);
    scratch.push(root);
    for (const artifact of ARTIFACTS) {
      const at = artifact.at(root);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, artifact.body, "utf8");
    }
    return root;
  }

  /** The phase that names a shipped template, as the sweep above found it. */
  function templateNamed(file: string): { file: string; phase: Phase } {
    const found = shipped.find((s) => s.file === file);
    expect(found?.phase, `${file} is named by an example phase`).toBeDefined();
    return { file: found!.file, phase: found!.phase! };
  }

  /** The phase that names `examples/prompts/plan.md`, as the shipped sweep found it. */
  function planTemplate(): { file: string; phase: Phase } {
    return templateNamed("plan.md");
  }

  /**
   * Which shipped templates name each artifact in a span — the detector the
   * coverage pin and the odd-root loop both read, rather than one re-deriving
   * it beside the other (`.claude/rules/engineering.md`, *The fix lands at the
   * mechanism*). The sweep is `allSpans`, so a template that stops carrying
   * spans at all moves this with it.
   */
  function templatesReadingEachArtifact(): ReadonlyMap<string, string[]> {
    return new Map(
      ARTIFACTS.map((a) => [
        a.span,
        [...new Set(allSpans.filter(({ cmd }) => cmd.includes(a.span)).map(({ file }) => file))],
      ]),
    );
  }

  /**
   * The table's own coverage, per artifact rather than in aggregate: an entry
   * whose detector stops naming any span leaves the loop below silently, and
   * a total count cannot tell that from a table that shrank
   * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
   */
  function expectEveryArtifactRead(readers: ReadonlyMap<string, string[]>): void {
    expect(ARTIFACTS.length).toBeGreaterThan(0);
    expect(ARTIFACTS.filter((a) => readers.get(a.span)!.length === 0).map((a) => a.span)).toEqual(
      [],
    );
  }

  it("every artifact in the example prompt odd-root table is read by at least one shipped template", () => {
    expectEveryArtifactRead(templatesReadingEachArtifact());
  });

  async function everyPromptReadsItsArtifactsUnder(root: string): Promise<void> {
    scratch.push(root);
    for (const artifact of ARTIFACTS) {
      const at = artifact.at(root);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, artifact.body, "utf8");
    }

    const readers = templatesReadingEachArtifact();
    expectEveryArtifactRead(readers);

    for (const { file, phase } of shipped) {
      expect(phase, `${file} is named by an example phase`).toBeDefined();
      const reads = ARTIFACTS.filter((a) => readers.get(a.span)!.includes(file));
      if (reads.length === 0) continue;

      const rendered = await render(file, phase!, root);
      for (const artifact of reads) {
        expect({
          file,
          span: artifact.span,
          read: rendered.includes(artifact.sentinel),
        }).toEqual({ file, span: artifact.span, read: true });
      }
    }
  }

  it("every example prompt's spans read their artifacts under a state root path carrying a space", async () => {
    const root = mkTempDirSync("flume example prompts space-");
    expect(root).toContain(" ");

    await everyPromptReadsItsArtifactsUnder(root);
  }, SPAWN_BUDGET_MS);

  it("every example prompt's spans read their artifacts under a state root path carrying a backslash", async () => {
    const base = mkTempDirSync("flume-example-prompts-backslash-");
    scratch.push(base);
    // On win32 the separator *is* the backslash, so every state root there is
    // this case. Elsewhere a backslash is an ordinary filename byte, and the
    // same byte reaches `sh`.
    const root = process.platform === "win32" ? base : join(base, "back\\slash");
    mkdirSync(root, { recursive: true });
    expect(root).toContain("\\");

    await everyPromptReadsItsArtifactsUnder(root);
  }, SPAWN_BUDGET_MS);

  /**
   * The same claim over the whole file, because a template's prose is an
   * instruction too: a span rooted at `{{FLUME_DIR}}` beside an OUTPUT block
   * naming `.flume/plan/...` sends the agent to write outside the fence its
   * slice is judged by the moment the root moves (a relocated state root).
   * A sweep of the spans alone cannot see that half.
   */
  it("no shipped example prompt names a literal .flume/ path outside a span", () => {
    // Non-vacuity: an empty prompt set, or templates read as empty bytes,
    // satisfies the absence over nothing.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter(({ text }) => text.trim() === "")).toEqual([]);

    // Non-vacuity for *outside a span*: strip every span and prose has to
    // remain, or the widened claim is asserted over the same bytes the span
    // sweep already covered.
    const prose = sources.map(({ file, text }) => ({ file, text: text.replace(SPAN, "") }));
    expect(prose.filter(({ text }) => text.trim() === "")).toEqual([]);

    expect(prose.filter(({ text }) => text.includes(".flume/")).map(({ file }) => file)).toEqual(
      [],
    );
    // And the spans, so the whole of what a consumer copies is one sweep.
    expect(sources.filter(({ text }) => text.includes(".flume/")).map(({ file }) => file)).toEqual(
      [],
    );
  });

  /**
   * `.claude/rules/engineering.md`, *An export earns its consumer* — the
   * `specs/active` / `specs/_aligned` partition belonged to the `spec` phase
   * cut in 58092d0. The fence and the phase list lost it there; the plan
   * template did not, and nothing went red: a `find` over a missing directory
   * exits non-zero behind `head`, whose zero the pipeline reports, so both
   * spans rendered empty and the trailing `|| echo` never fired
   * (`spec/prompt.md`, *An unresolved inline-exec span fails the tick*: exit
   * status decides). Residue a reader cannot see is residue a test has to.
   */
  it("no shipped example prompt spans the retired specs/active or specs/_aligned partition", () => {
    // Non-vacuity: a prompt set with no spans at all satisfies the absence.
    expect(allSpans.length).toBeGreaterThan(0);

    expect(
      allSpans.filter((s) => /specs\/(?:active|_aligned)\b/.test(s.cmd)),
    ).toEqual([]);
  });

  /**
   * `.claude/rules/engineering.md`, *Loud or nothing* — the corpus listing is
   * a digest, and `find` over a missing root exits non-zero *behind* `head`,
   * whose zero the pipeline reports (`spec/prompt.md`, *An unresolved
   * inline-exec span fails the tick*: exit status decides). The span rendered
   * empty-but-green, so a copy of this template in a repo with no corpus
   * planned against nothing at all rather than refusing. The guard is
   * `test -d` rather than `set -o pipefail`: the engine spawns `sh`, and dash
   * carries no pipefail.
   *
   * Driven through the real renderer over the shipped markdown
   * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
   * wrote*): the claim is about what `sh` does with the bytes the template
   * ships, which only the real reader can settle. Every sibling span resolves
   * here — the scratch repo has a commit and the state root has its artifacts —
   * so the one failure the error carries is the corpus span itself.
   */
  it("the example plan template's corpus span fails the render when the corpus root is absent", async () => {
    const bare = await seedTickCwd("flume-example-prompts-nocorpus-", false);
    expect(existsSync(join(bare, "specs"))).toBe(false);
    const root = seedStateRoot("flume-example-prompts-nocorpus-root-");
    const { file, phase } = planTemplate();

    const outcome = await render(file, phase, root, bare).then(
      (rendered) => ({ rendered }),
      (error: unknown) => ({ error }),
    );

    expect(outcome, "the render resolved every span with no corpus root").not.toHaveProperty(
      "rendered",
    );
    const error = (outcome as { error: unknown }).error;
    expect(error).toBeInstanceOf(InlineExecRenderError);
    const failures = (error as InlineExecRenderError).failures;
    expect(failures.map((f) => f.cmd)).toEqual([expect.stringContaining("find specs -name")]);
    // Loud, not merely non-zero: the refusal names what was missing.
    expect(failures[0]!.stderr).toContain("spec corpus root");
  }, SPAWN_BUDGET_MS);

  /**
   * `.claude/rules/engineering.md`, *Loud or nothing* — an entry's `per` cite
   * is the build tick's whole subject, and the span read it under `2>/dev/null
   * || echo "(spec not found: ...)"`. A cite that did not resolve therefore
   * reached the agent as a sentence *saying* so, inside a `<spec>` block whose
   * `path=` attribute still claimed the file, and nothing downstream refused:
   * the tick built against prose about the absence. Absence is never legitimate
   * here — the queue's own bar is that an entry carries a cite that resolves —
   * so the span needs no guard at all, only its fallback removed and its stderr
   * left alone, and `cat` refuses on its own.
   *
   * Driven through the real renderer over the shipped markdown
   * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
   * wrote*): the claim is what `sh` does with the bytes the template ships once
   * the renderer has substituted a path into them, which only the real reader
   * and the real substituter can settle together.
   */
  it("the example build template's per span fails the render when the cited spec path is absent", async () => {
    const { file, phase } = templateNamed("build.md");
    // Non-vacuity: a template that stopped spanning its cite at all would
    // satisfy every claim below by rendering nothing.
    expect(
      allSpans.filter((s) => s.file === file && s.cmd.includes("{{PER_PATH}}")),
    ).toHaveLength(1);
    const root = seedStateRoot("flume-example-prompts-percite-root-");
    const missing = join(cwd, "specs", "retired-section.md");
    expect(existsSync(missing)).toBe(false);

    const outcome = await render(file, phase, root, cwd, { PER_PATH: missing }).then(
      (rendered) => ({ rendered }),
      (error: unknown) => ({ error }),
    );

    expect(outcome, "the render resolved every span over an absent per cite").not.toHaveProperty(
      "rendered",
    );
    const error = (outcome as { error: unknown }).error;
    expect(error).toBeInstanceOf(InlineExecRenderError);
    const failures = (error as InlineExecRenderError).failures;
    // The cite span is the one failure: every sibling resolves here.
    expect(failures.map((f) => f.cmd)).toEqual([expect.stringContaining(missing)]);
    // Loud, not merely non-zero: the reader's own complaint survived, which
    // the deleted `2>/dev/null` used to discard.
    expect(failures[0]!.stderr.trim()).not.toBe("");
  }, SPAWN_BUDGET_MS);

  /**
   * `.claude/rules/engineering.md`, *Loud or nothing*, on the four state-root
   * spans. These carry a real fork the corpus span does not: on tick one
   * nothing has written any of them, so absence is the legitimate case and the
   * placeholder is the right answer to it. A trailing `|| echo` answered a
   * *failed read* with that same placeholder — a queue the reader could not
   * open rendered as an empty queue, and plan re-derived against it.
   *
   * The guard splits the fork: `test -e` selects the placeholder for absence
   * and exits zero; everything past it is a real read whose failure reaches
   * the renderer. `-e` rather than `-f`/`-d`, because the wrong *kind* in
   * place is a failed read, not an absence.
   *
   * The unreadable case is the wrong kind in place — a directory where a
   * `cat` span opens a file, a file where the listing span opens a
   * directory. A permission-denied would read the same on posix and be a
   * no-op on win32 (`.claude/rules/platform-facts.md`, *`chmod` denies
   * nothing on win32*), so
   * it is not the case a portable suite can drive.
   */
  it("the example plan template's artifact spans fail the render when an artifact is present but unreadable", async () => {
    const { file, phase } = planTemplate();

    let asserted = 0;
    for (const artifact of ARTIFACTS) {
      const root = seedStateRoot("flume-example-prompts-unreadable-root-");
      const { path, kind } = opened(artifact, root);
      rmSync(path, { recursive: true, force: true });
      if (kind === "file") mkdirSync(path, { recursive: true });
      else writeFileSync(path, "a file where the listing opens a directory\n", "utf8");

      const outcome = await render(file, phase, root).then(
        (rendered) => ({ rendered }),
        (error: unknown) => ({ error }),
      );

      expect(
        outcome,
        `${artifact.span}: the render resolved every span over an unreadable artifact`,
      ).not.toHaveProperty("rendered");
      const error = (outcome as { error: unknown }).error;
      expect(error).toBeInstanceOf(InlineExecRenderError);
      const failures = (error as InlineExecRenderError).failures;
      // This artifact's span is the one failure — its siblings all resolve.
      expect(failures.map((f) => f.cmd)).toEqual([expect.stringContaining(artifact.span)]);
      // Loud: the reader's complaint reached the failure record rather than
      // `/dev/null`.
      expect(failures[0]!.stderr.trim(), `${artifact.span}: the refusal is silent`).not.toBe("");
      asserted++;
    }

    // Non-vacuity (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*): an ARTIFACTS list that lost its entries would pass the
    // loop over nothing.
    expect(asserted).toBe(ARTIFACTS.length);
    expect(asserted).toBeGreaterThan(0);
  }, SPAWN_BUDGET_MS);

  /**
   * The other side of the same fork, and the reason the guard is not a bare
   * refusal: a cold state root is tick one, not a defect. Each span renders
   * its placeholder as the block's whole content — asserted as a line, under
   * the block's open tag, so a placeholder appearing anywhere else in the
   * render cannot stand in for it.
   */
  it("the example plan template's artifact spans render their empty placeholders when the artifacts are absent", async () => {
    const { file, phase } = planTemplate();
    const root = mkTempDirSync("flume-example-prompts-cold-root-");
    scratch.push(root);
    for (const artifact of ARTIFACTS) {
      expect(existsSync(opened(artifact, root).path)).toBe(false);
    }

    const rendered = await render(file, phase, root);
    const lines = rendered.split("\n").map((l) => l.trimEnd());

    let asserted = 0;
    for (const artifact of ARTIFACTS) {
      const at = lines.indexOf(artifact.placeholder);
      expect(at, `${artifact.span}: no line renders ${artifact.placeholder}`).toBeGreaterThan(0);
      expect(lines[at - 1], `${artifact.span}: the placeholder is the block's content`).toMatch(
        /^<[a-z-]+>$/,
      );
      // Nothing was read, so nothing the artifact would have carried leaked.
      expect(rendered).not.toContain(artifact.sentinel);
      asserted++;
    }

    // Non-vacuity: an emptied ARTIFACTS list would pass the loop over nothing.
    expect(asserted).toBe(ARTIFACTS.length);
    expect(asserted).toBeGreaterThan(0);
  }, SPAWN_BUDGET_MS);

  /**
   * The same defect, read off the text so it cannot come back in a span no
   * case renders: a `||` fallback downstream of a pipe is unreachable, because
   * the pipeline reports its *last* stage's status and the last stage is the
   * digester (`head`, `tail`), which succeeds over an empty stream. A fallback
   * that cannot fire reads as a defence and is none — residue against
   * `.claude/rules/engineering.md`, *Loud or nothing*.
   */
  it("no shipped example prompt span carries a || fallback behind a pipe that swallows its status", () => {
    // Non-vacuity: a prompt set with no spans at all satisfies the absence,
    // and so does one where nothing pipes.
    expect(allSpans.length).toBeGreaterThan(0);
    expect(allSpans.filter(({ cmd }) => /\|(?!\|)/.test(cmd)).length).toBeGreaterThan(0);

    // Cut each span at the separators that end a pipeline; a `||` whose own
    // segment already piped is the defect.
    const swallowed = allSpans.filter(({ cmd }) =>
      cmd.split(/[;\n]/).some((segment) => {
        const fallback = segment.indexOf("||");
        return fallback >= 0 && /\|(?!\|)/.test(segment.slice(0, fallback));
      }),
    );

    expect(swallowed).toEqual([]);
  });

  /**
   * Agreement pin (`.claude/rules/engineering.md`, *A seam gate reads what the
   * real writer wrote*): one corpus root, declared twice. The chain spells it
   * to the planning agent through `entryExtension.per`'s hint; the template
   * spells it again in the span that indexes the corpus that agent cites into.
   * Both sides are read from what ships — the hint off the real factory's
   * chain, the span off the real markdown — so a root moved on one side is red
   * rather than a listing the agent quietly plans without.
   */
  it("the plan template's corpus span reads the root the cascade per hint names", () => {
    const hint = cascadeChain.entryExtension?.per?.hint;
    expect(hint, "cascade declares a `per` field carrying a hint").toBeDefined();
    // The hint spells a page under the corpus root, root first, with an
    // ellipsis between them.
    const root = /([A-Za-z0-9_.-]+)\/\.\.\./.exec(hint!)?.[1];
    expect(root, `a corpus root is readable from the per hint: ${hint}`).toBeDefined();

    const planSpans = allSpans
      .filter((s) => s.file === "plan.md")
      .map((s) => s.cmd);
    // Non-vacuity: a template carrying no spans satisfies any claim about one.
    expect(planSpans.length).toBeGreaterThan(0);

    const naming = planSpans.filter((cmd) =>
      new RegExp(`(?:^|[^A-Za-z0-9_./-])${root}(?![A-Za-z0-9_.-])`).test(cmd),
    );
    expect(naming).toHaveLength(1);
  });
});

/**
 * A chain is a plugin loaded into a host, not a library consumer resolving
 * its own copy (`src/flumeApi.ts`): every engine *value* arrives on the
 * factory's `api`, so a chain's only engine import is `import type`, erased
 * at runtime. A value import re-resolves the engine — two physical copies in
 * one process at equal versions, splitting `instanceof` and module state with
 * nothing reporting it — and each shipped chain under `examples/` is a "copy
 * this into your repo" artifact, so one slipping in teaches the shape the
 * contract forbids.
 *
 * Read off the source text, because the defect *is* the import statement:
 * TypeScript erases `import type` and keeps a value import whose bindings
 * went unused, so the loaded module graph cannot tell the two apart.
 */
describe("example chains — the engine arrives on the api, never through a value import", () => {
  /** `"flume"` and every relative spelling of the in-repo public entry. */
  const ENGINE = /^(?:flume|(?:\.\.?\/)+src\/index\.ts)$/;

  /** Every `import <clause> from "<spec>"`, comments stripped first. */
  function importsOf(src: string): Array<{ clause: string; spec: string }> {
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    return [...code.matchAll(/^import\s+([\s\S]*?)\bfrom\s+"([^"]+)";/gm)].map(
      (m) => ({ clause: m[1]!.trim(), spec: m[2]! }),
    );
  }

  it("every example chain imports the engine type-only, with no runtime value import", () => {
    const dir = fileURLToPath(new URL("../examples", import.meta.url));
    const chains = readdirSync(dir)
      .filter((f) => f.endsWith("-chain.ts"))
      .sort();
    // Vacuity pin: an empty directory listing would pass the filter below
    // over nothing.
    expect(chains.length).toBeGreaterThan(0);

    const valueImports: string[] = [];
    for (const name of chains) {
      const engine = importsOf(readFileSync(join(dir, name), "utf8")).filter(
        (i) => ENGINE.test(i.spec),
      );
      // Vacuity pin, per file: a chain the scanner failed to read imports
      // from would contribute no violation however it was written.
      expect(
        engine.length,
        `${name}: the scan found no engine import to classify`,
      ).toBeGreaterThan(0);
      valueImports.push(
        ...engine
          .filter((i) => !i.clause.startsWith("type"))
          .map((i) => `${name}: import ${i.clause} from "${i.spec}"`),
      );
    }

    expect(valueImports).toEqual([]);
  });
});

/**
 * `phases[0]` is a chain's entry point by position (docs/CHAIN-AUTHORING.md,
 * *1. Declaring a Phase*), so a chain whose entry phase is also in its own
 * `humanOnly` list declares a state root that can never cold-start on its
 * own machinery: a human has to wake it on tick one, every time. Every chain
 * under `examples/` is a "read this to learn the shape" artifact, so this
 * pins the entry-phase/humanOnly relationship across all of them, not just
 * cascade.
 */
describe("example chains — entry phase is machine-wakeable", () => {
  const chains: Array<{ name: string; chain: Chain }> = [
    { name: "cascade-chain.ts", chain: cascadeChain },
    { name: "backlog-groomer-chain.ts", chain: backlogGroomerChain },
    { name: "minimal-chain.ts", chain: minimalChain },
  ];

  it.each(chains)(
    "$name: phases[0] is absent from its own humanOnly list",
    ({ chain }) => {
      const entryPhase = chain.phases[0];
      expect(entryPhase).toBeDefined();
      expect(chain.humanOnly).not.toContain(entryPhase!.name);
    },
  );
});

/**
 * .claude/rules/engineering.md "The fix lands at the mechanism" — the flagship
 * example hand-rolled a "does pending.json parse" gate that
 * `docs/CHAIN-AUTHORING.md` itself documents as predating the `pendingGate`
 * builtin. Pins the swap: plan's gate list carries `pendingGate`'s identity
 * (`"pending-gate"`), not the hand-rolled gate's name.
 */
describe("cascade-chain.ts — plan phase gates through the pendingGate builtin", () => {
  it("plan.gates contains a gate named 'pending-gate'", () => {
    const slices = cascadeChain.phases.filter((p) => p.name.startsWith("plan"));
    // Vacuity pin: every slice writes the queue, so the loop below is only
    // worth its green over a populated ladder.
    expect(slices.length).toBeGreaterThan(1);
    for (const slice of slices) {
      expect(slice.gates.map((g) => g.name), slice.name).toContain(
        "pending-gate",
      );
    }
  });
});

/**
 * spec/chain.md, *What a hook receives* — `shouldRun` is one of the chain's
 * four interpretation points, and the section's own worked case is a plan
 * phase deciding "build has a standing bail to reconcile" off
 * `TickContext.priorAttempts` rather than a `readdirSync` of the engine's
 * directory. No shipped example declared the hook at all, so an adopter
 * learning the shape from `examples/` never saw a phase decline a tick.
 *
 * Both verdicts are driven here on the slice that reads them — `plan-derive`,
 * the one woken by a queue with nothing in it and by a record only a
 * re-derive reconciles. The fixture's `cwd`/`flumeDir` point at a directory
 * that does not exist, so a predicate rebuilding either fact from the engine's
 * `prior-attempts/` directory would throw or answer differently and the pin
 * holds the "from `TickContext`" half of the claim too. The sibling slice's
 * own liveness — a listing of this chain's inbox, which no engine field
 * reports — is driven over a real directory in the ladder pin below.
 */
describe("cascade-chain.ts — plan decides from the TickContext", () => {
  const planPhase = cascadeChain.phases.find((p) => p.name === "plan-derive");

  const openEntry = (tag: string): PendingEntry => ({
    tag,
    gate: { kind: "open" },
    dependsOnForks: [],
    priority: 0,
    files: { new: [], edit: [], retire: [] },
  });

  const standingBail: PriorAttempt = {
    mode: "clean-exit",
    finalMessage: "parked: the entry needs a wider fence",
    key: "entry",
    keyedAs: "PARKED-ENTRY",
    headSha: "0".repeat(40),
    at: "2026-09-11T00:00:00.000Z",
  };

  const ctx = (over: Partial<TickContext>): TickContext => ({
    cwd: "/nonexistent/cascade-shouldRun-fixture",
    flumeDir: "/nonexistent/cascade-shouldRun-fixture/.flume",
    ...over,
  });

  it("the cascade example's plan phase declines a tick when nothing on disk gives it work", () => {
    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): an undeclared hook, or an empty `pickable`, would make the
    // decline below assert nothing about a predicate that read the queue.
    expect(planPhase, "cascade declares a plan-derive slice").toBeDefined();
    expect(
      planPhase!.shouldRun,
      "examples/cascade-chain.ts: every plan slice declares `shouldRun` — " +
        "the hook is what this pin exists to drive",
    ).toBeTypeOf("function");

    const pickable = [openEntry("ALREADY-PICKABLE")];
    expect(pickable.length).toBeGreaterThan(0);

    expect(
      planPhase!.shouldRun!(
        ctx({ pending: pickable, pickable, priorAttempts: new Map() }),
      ),
    ).toBe(false);
  });

  it("the cascade example's plan phase runs when the queue is empty or a prior attempt stands", () => {
    expect(planPhase!.shouldRun).toBeTypeOf("function");

    // Nothing build could pick — the queue is plan's to refill.
    expect(
      planPhase!.shouldRun!(
        ctx({ pending: [], pickable: [], priorAttempts: new Map() }),
      ),
    ).toBe(true);

    // Pickable work exists, but a record stands unreconciled: the decline
    // above must not swallow this case.
    const pickable = [openEntry("ALREADY-PICKABLE")];
    const priorAttempts = new Map([["PARKED-ENTRY", standingBail]]);
    expect(priorAttempts.size).toBeGreaterThan(0);
    expect(
      planPhase!.shouldRun!(
        ctx({ pending: pickable, pickable, priorAttempts }),
      ),
    ).toBe(true);
  });
});

/**
 * `.claude/rules/engine-boundary.md`, *Surface, not prescription* — the engine
 * offers `handoff` and reads nothing into it: which phase runs next is the
 * chain's verdict, and a chain whose plan is more than one job has to order
 * those jobs itself. Cascade's plan was one phase, so the flagship never
 * showed slices sharing a dispatcher, and an adopter splitting plan had no
 * worked answer to "who decides what runs next" but a sibling's name
 * hardcoded in every handoff.
 *
 * Driven over the real phases the factory returns, against a scratch state
 * root this test owns: the first slice's window is a listing of
 * `<flumeDir>/inbox/`, a directory no engine field reports, so the facts the
 * ladder walks are put on disk here rather than stubbed behind the predicate
 * that reads them.
 *
 * What the hand-built `TickResult` here stands in for is the **build wave's**
 * own result — a refusal shape, or a wave that shipped. Driving one costs a
 * fanout tick whose afterCommit gates shell `pnpm tsc` and eslint per entry,
 * which is the measured cost the lane boundary excludes (spec/worktrees.md,
 * *The default test lane must stay fast*). The plan slices carry no such
 * gate, so every rung of theirs is driven off a real `Dispatcher.tick()` in
 * the describe below — the agreement claim this seam owes
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
describe("cascade-chain.ts — the plan ladder", () => {
  const planSlices = cascadeChain.phases.filter((p) => p.name !== "build");
  const buildPhase = cascadeChain.phases.find((p) => p.name === "build");

  let flumeDir: string;
  const finding = (): string => join(flumeDir, "inbox", "2026-09-11-report.md");

  beforeEach(() => {
    flumeDir = join(mkTempDirSync("cascade-ladder-"), ".flume");
    mkdirSync(join(flumeDir, "inbox"), { recursive: true });
  });

  afterEach(() => {
    rmSync(flumeDir, { recursive: true, force: true });
  });

  const openEntry: PendingEntry = {
    tag: "PICKABLE",
    gate: { kind: "open" },
    dependsOnForks: [],
    priority: 0,
    files: { new: [], edit: [], retire: [] },
  };

  const after = (over: Partial<TickResult>): TickResult => ({
    phaseName: "build",
    committed: true,
    gateResults: [],
    pendingAfter: [],
    pickableAfter: [],
    priorAttempts: new Map(),
    flumeDir,
    configDir: "/nonexistent/cascade-ladder-fixture",
    shippedTags: [],
    revertedTags: [],
    ...over,
  });

  /** Where `phase` sends the baton after a tick with `over` folded in. */
  const from = (phase: Phase, over: Partial<TickResult> = {}): string[] =>
    phase.handoff(after({ phaseName: phase.name, ...over }));

  it("a shipped build wave hands the baton to the ladder's live rung", () => {
    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): a single-slice plan, or a chain that lost `build`, would
    // satisfy every routing claim below over a ladder with nothing to order.
    expect(
      planSlices.length,
      "cascade's plan is a ladder — one slice orders nothing",
    ).toBeGreaterThan(1);
    expect(buildPhase, "cascade declares a build phase").toBeDefined();
    // The declared list is build-first — the budget's priority — so every
    // routing claim below is the ladder's answer rather than the list read
    // back.
    expect(cascadeChain.phases.map((p) => p.name)).toEqual([
      buildPhase!.name,
      ...planSlices.map((p) => p.name),
    ]);
    const [first, second] = planSlices as [Phase, Phase];
    expect(planSlices.every((p) => p.concurrency === "singleton")).toBe(true);

    // A finding on disk: the slice that owns it is the ladder's first rung,
    // and a shipped wave answers with it rather than with a sibling's name.
    writeFileSync(finding(), "# a report from the field\n");
    expect(from(buildPhase!, { shippedTags: ["SHIPPED"] })).toEqual([
      first.name,
    ]);

    // Drained, and the baton falls through to the next rung down.
    rmSync(finding());
    expect(from(buildPhase!, { shippedTags: ["SHIPPED"] })).toEqual([
      second.name,
    ]);

    // Below the ladder: build while the queue carries work.
    const pickable = { pendingAfter: [openEntry], pickableAfter: [openEntry] };
    expect(from(buildPhase!, { shippedTags: ["SHIPPED"], ...pickable })).toEqual(
      [buildPhase!.name],
    );
  });

  it("a build wave that refused wakes the slice that reconciles it, whatever is pickable", () => {
    const pickable = { pendingAfter: [openEntry], pickableAfter: [openEntry] };
    const derive = planSlices[planSlices.length - 1]!;

    // Vacuity pin: with the queue pickable and nothing live above it, the
    // ladder's own answer is build — so each refusal below is the refusal
    // moving the verdict, not the default.
    expect(from(buildPhase!, { shippedTags: ["SHIPPED"], ...pickable })).toEqual([
      buildPhase!.name,
    ]);

    // The agent exited without committing.
    expect(
      from(buildPhase!, { committed: false, noCommit: "clean-exit", ...pickable }),
    ).toEqual([derive.name]);

    // The commit landed and a `shipped` predicate declined it — a park.
    expect(
      from(buildPhase!, {
        entries: [
          {
            tag: "PICKABLE",
            extension: {},
            committed: true,
            shipped: false,
            reverted: false,
            mergeOutcome: "not-shipped",
          },
        ],
        ...pickable,
      }),
    ).toEqual([derive.name]);

    // A cherry-pick conflict is not a refusal: the next wave retries it from
    // the new base, so the ladder decides as usual.
    expect(
      from(buildPhase!, {
        entries: [
          {
            tag: "PICKABLE",
            extension: {},
            committed: true,
            shipped: false,
            reverted: false,
            mergeOutcome: "cherry-pick-conflict",
          },
        ],
        ...pickable,
      }),
    ).toEqual([buildPhase!.name]);
  });
});

/**
 * `.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote* — the ladder's claim is that the chain's `handoff` and the engine's
 * `TickResult` agree, and a fixture folded by the tester's hand re-authors
 * the engine's half of that vocabulary. A field renamed, dropped, or filled
 * differently in `src/Dispatcher.ts` then ships green over a suite that
 * still hands the old shape to `handoff`.
 *
 * So every rung is walked here by `Dispatcher.tick()` itself: the real
 * dispatcher provisions the slice's worktree, invokes the agent, carries the
 * commit back to trunk through its own gates, re-reads the queue, hands the
 * result it built to cascade's own `handoff`, and writes the answer to the
 * baton — `awakeAfter` is that baton, so nothing between the two sides is
 * this test's. What stays the test's is the disk the ladder reads (a finding
 * under `<flumeDir>/inbox/`, the queue under `<flumeDir>/plan/`) and the
 * agent, which stands in for the model with a `git commit` — the section's
 * subject is the result the engine builds around that commit, not the
 * content the model would have written.
 *
 * Fast lane: no Node startup, no agent process, no gate that shells a
 * package manager — cascade's plan slices gate on `pendingGate` alone. Raw
 * git plumbing on a temp fixture is not a lane trigger (spec/worktrees.md,
 * *The default test lane must stay fast*).
 */
describe("cascade-chain.ts — the plan ladder over a real tick", () => {
  /** What the re-derive leg files: pickable, and inside build's fence. */
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
    acceptance: "the ladder hands the baton to build",
  };

  /** The agent's whole contribution: a commit the engine has to classify. */
  const commits =
    (message: string, edit: (cwd: string) => void) =>
    async (cwd: string): Promise<void> => {
      edit(cwd);
      await exec("git", ["add", "-A"], { cwd });
      await exec("git", ["commit", "-q", "-m", message], { cwd });
    };
  /** An agent that exits clean having produced nothing. */
  const commitsNothing = async (): Promise<void> => {};

  /** One drive: a fixture repo, the chain built from its roots, and a tick over both. */
  interface Ladder {
    fx: Fixture;
    /** Handed to `buildFlumeApi`, and spread into every `Dispatcher` below. */
    paths: FlumePaths;
    api: FlumeApi;
    chain: Chain;
    /** The finding the inbox slice routes, absolute. */
    report: string;
    tick: (
      name: string,
      act: (cwd: string) => Promise<void>,
    ) => Promise<TickOutcome>;
  }

  /**
   * The drive's disk, and cascade built from the roots the drive ticks: one
   * `FlumePaths` object handed to `buildFlumeApi` and spread into every
   * `Dispatcher` here, so the api the chain composed against is the api a
   * tick at that repo resolves.
   *
   * The module-scope `EXAMPLE_PATHS` build is this checkout's roots, which the
   * pure shape reads above may hold because they tick nothing. Handing it to a
   * dispatcher driving a temp fixture puts the two halves of one seam on two
   * different repos (`.claude/rules/engineering.md`, *A seam gate reads what
   * the real writer wrote*): the first chain to resolve state from `api.paths`
   * would reach into the working tree the suite runs from, and every leg below
   * would still be green.
   */
  async function ladderDrive(): Promise<Ladder> {
    const fx = await makeFixture();
    try {
      const paths: FlumePaths = {
        repoRoot: fx.repo,
        configDir: fx.configDir,
        flumeDir: join(fx.repo, ".flume"),
      };
      const api = buildFlumeApi(paths);
      const { chain } = cascadeFactory(api);
      const { repoRoot: repo, configDir, flumeDir } = paths;
      const report = join(flumeDir, "inbox", "2026-09-11-report.md");

      // The disk the ladder reads, committed: a singleton runs in a fresh
      // worktree, which holds tracked content only, so an uncommitted
      // finding is simply absent where the agent runs.
      mkdirSync(join(flumeDir, "inbox"), { recursive: true });
      // The queue directory, present and empty — and a placeholder inside
      // it, because git holds no empty directory and the fence admits only
      // `*.json` (`spec/pending.md`, *The ledger is a directory — one entry
      // per file*).
      mkdirSync(join(flumeDir, "plan", "pending"), { recursive: true });
      writeFileSync(report, "# a report from the field\n");
      writeFileSync(join(flumeDir, "plan", "pending", ".gitkeep"), "");
      await exec("git", ["add", "-A"], { cwd: repo });
      await exec("git", ["commit", "-q", "-m", "seed the plan artifacts"], {
        cwd: repo,
      });

      // The real `Phase.promptPath` ("prompts/plan.md"), resolved against a
      // config dir this test owns. The shipped prompt's body is not this
      // seam — it is the agent's input, and the agent here is a stub — while
      // its inline-exec spans would put `pnpm tsc` on the fast lane once per
      // tick below.
      mkdirSync(join(configDir, "prompts"), { recursive: true });
      writeFileSync(
        join(configDir, "prompts", "plan.md"),
        "{{SLICE_JOB}}\n\n{{PENDING_SCHEMA}}\n",
      );

      /**
       * One real tick of `name`, with exactly that phase awake so the
       * returned `awakeAfter` is this tick's handoff and no leftover flag.
       */
      const tick = async (
        name: string,
        act: (cwd: string) => Promise<void>,
      ): Promise<TickOutcome> => {
        const baton = new Baton(flumeDir);
        for (const p of chain.phases) baton.sleep(p.name);
        baton.wake(name);
        const outcome = await new Dispatcher({
          ...paths,
          agent: {
            name: "ladder-stub",
            async invoke({ cwd }) {
              await act(cwd);
              return { exitCode: 0, stdout: "", stderr: "" };
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

      return { fx, paths, api, chain, report, tick };
    } catch (err) {
      await fx.cleanup();
      throw err;
    }
  }

  it("the cascade chain the ladder drive ticks is built from the fixture repo's roots", async () => {
    const l = await ladderDrive();
    try {
      // The chain's half: the api cascade composed against carries the
      // dispatcher's own roots, by identity — the same three strings, not
      // two resolutions that agree today. Pinned per root, because
      // `api.paths` also carries the offset the engine computed from them
      // (`stateRootRel`), so it is the roots that are identity-same and not
      // the object around them (spec/chain.md, *Per-run artifacts belong
      // under `FLUME_DIR`*).
      expect(l.api.paths.repoRoot).toBe(l.paths.repoRoot);
      expect(l.api.paths.configDir).toBe(l.paths.configDir);
      expect(l.api.paths.flumeDir).toBe(l.paths.flumeDir);
      expect(l.api.paths.stateRootRel).toBe(".flume");
      expect(l.paths).toEqual({
        repoRoot: l.fx.repo,
        configDir: l.fx.configDir,
        flumeDir: join(l.fx.repo, ".flume"),
      });
      // Named against the roots a module-scope build would have handed it:
      // this checkout's, which no tick here runs against.
      expect(l.paths.repoRoot).not.toBe(EXAMPLE_PATHS.repoRoot);
      expect(l.paths.flumeDir).not.toBe(EXAMPLE_PATHS.flumeDir);

      // The engine's half, off a real tick of that chain through the drive's
      // own `tick`: the state root the dispatcher resolved is the fixture's.
      // A plan slice, because this fixture writes `prompts/plan.md` alone and
      // build wants an assigned entry — which phase the chain declares first
      // is a scheduling fact, and nothing here is about it.
      const slice = l.chain.phases.find((p) => p.name !== "build");
      expect(slice, "cascade declares a plan slice").toBeDefined();
      const outcome = await l.tick(slice!.name, commitsNothing);
      expect(outcome.result?.flumeDir).toBe(l.paths.flumeDir);
      expect(outcome.result?.flumeDir).not.toBe(EXAMPLE_PATHS.flumeDir);
    } finally {
      await l.fx.cleanup();
    }
  });

  it("cascade's plan ladder routes the baton from a TickResult the dispatcher produced", async () => {
    const l = await ladderDrive();
    try {
      const { report, tick } = l;
      const { flumeDir } = l.paths;
      const planSlices = l.chain.phases.filter((p) => p.name !== "build");
      const buildPhase = l.chain.phases.find((p) => p.name === "build");
      // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
      // non-vacuous"): a one-slice plan, or a chain that lost `build`, would
      // satisfy the routing below over a ladder with nothing to order.
      expect(
        planSlices.length,
        "cascade's plan is a ladder — one slice orders nothing",
      ).toBe(2);
      expect(buildPhase, "cascade declares a build phase").toBeDefined();
      const [inbox, derive] = planSlices as [Phase, Phase];

      // The finding is still on disk after the slice committed: a window
      // wider than one tick's budget re-wakes its own slice.
      const held = await tick(
        inbox.name,
        commits("plan: record what the report says", (cwd) =>
          writeFileSync(join(cwd, ".flume", "plan", "state.md"), "# state\n"),
        ),
      );
      expect(held.result?.committed).toBe(true);
      expect(held.result?.gateResults.length).toBeGreaterThan(0);
      expect(held.result?.gateResults.every((g) => g.ok)).toBe(true);
      expect(held.awakeAfter).toEqual([inbox.name]);

      // Same window, and this time the slice closed nothing: it does not
      // re-wake itself, so an unroutable finding costs one tick, not a loop.
      const unroutable = await tick(inbox.name, commitsNothing);
      expect(unroutable.result?.committed).toBe(false);
      expect(unroutable.noCommit).toBe("clean-exit");
      expect(unroutable.awakeAfter).toEqual([derive.name]);

      // The exclusion is the slice's own: its sibling still answers with the
      // rung above, whose window is open.
      const sibling = await tick(derive.name, commitsNothing);
      expect(sibling.result?.committed).toBe(false);
      expect(sibling.awakeAfter).toEqual([inbox.name]);

      // Drained — through a commit the engine carried back to the trunk the
      // ladder's predicate reads — and the baton falls to the next rung.
      const drained = await tick(
        inbox.name,
        commits("plan: drain the inbox", (cwd) =>
          rmSync(join(cwd, ".flume", "inbox", "2026-09-11-report.md")),
        ),
      );
      expect(drained.result?.committed).toBe(true);
      expect(drained.result?.gateResults.length).toBeGreaterThan(0);
      expect(drained.result?.gateResults.every((g) => g.ok)).toBe(true);
      // git removes the directory with its last tracked file, so the drained
      // state the predicate answers on is the ENOENT leg of its own read.
      expect(existsSync(report)).toBe(false);
      expect(existsSync(join(flumeDir, "inbox"))).toBe(false);
      expect(drained.awakeAfter).toEqual([derive.name]);

      // Nothing above, nothing pickable, and the slice that would refill the
      // queue just declined to: hibernation, read off the engine's own
      // post-tick re-read of the queue.
      const quiet = await tick(derive.name, commitsNothing);
      expect(quiet.result?.committed).toBe(false);
      expect(quiet.result?.pickableAfter).toEqual([]);
      expect(quiet.awakeAfter).toEqual([]);

      // The re-derive files one entry. `pickableAfter` is the dispatcher's
      // own verdict over the queue this commit wrote — the fact the ladder's
      // bottom rung turns on.
      const refilled = await tick(
        derive.name,
        commits("plan: file one entry", (cwd) =>
          // One file, named for the entry's tag — a producer adds an entry by
          // adding a file (`spec/pending.md`, *The ledger is a directory —
          // one entry per file*).
          writeFileSync(
            join(
              cwd,
              ".flume",
              "plan",
              "pending",
              entryFileName(filedEntry.tag),
            ),
            `${JSON.stringify(filedEntry, null, 2)}\n`,
          ),
        ),
      );
      expect(refilled.result?.committed).toBe(true);
      expect(
        refilled.result?.gateResults.filter(
          (g) => g.gate === "pending-gate" && g.ok,
        ),
      ).toHaveLength(1);
      expect(refilled.result?.pickableAfter.map((e) => e.tag)).toEqual([
        filedEntry.tag,
      ]);
      expect(refilled.awakeAfter).toEqual([buildPhase!.name]);
    } finally {
      await l.fx.cleanup();
    }
  });
});

/**
 * `.claude/rules/engine-boundary.md`, *Surface, not prescription* — the engine
 * offers the injection points (`GateContext.entry`, `GateResult.details`) and
 * reads none of `tests[]`; judging a declared extension field is the chain's.
 * Cascade declared the field and judged nothing, so the flagship taught the
 * shape of acceptance-driven backpressure without the gate that makes it
 * load-bearing — a `tests[]` line a shipped entry never had to earn.
 *
 * The refusal drives the gate object the factory returns, not a wrapper the
 * test re-composes (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*): the stub suite enters through a doctored
 * `api.shellGate`, so the composition under test — wrapper, options, placement
 * — is the one cascade hands `build`. The reporter payload stays hand-authored,
 * which the same section's carve-out allows: a real vitest run cannot be made
 * to emit "a named behavior with no passing test" on demand.
 */
describe("cascade-chain.ts — the entry's tests[] is judged on the trunk", () => {
  /** vitest's `--reporter=json` shape, trimmed to the keys the judge reads. */
  const report = (file: string, fullName: string, status: string) =>
    JSON.stringify({
      numTotalTestSuites: 1,
      success: true,
      numPassedTests: 1,
      testResults: [
        { name: `/repo/${file}`, status, assertionResults: [{ fullName, status }] },
      ],
    });

  /**
   * The vitest gate cascade ships to `build`, with the runner's spawn — and
   * nothing above it — replaced. The doctored `api.shellGate` still builds
   * the real gate from the real options the factory passed, then answers
   * green with the report the caller supplies, standing in for the `pnpm
   * vitest` process. Everything the chain composes on top (which wrapper,
   * which placement, which command) comes from the factory, so unwrapping
   * `vitestOnTrunk` there fails every case below.
   */
  const shippedVitestGate = (details: string): Gate => {
    const api = buildFlumeApi(EXAMPLE_PATHS);
    const doctored: FlumeApi = {
      ...api,
      shellGate: (opts) => ({
        ...api.shellGate(opts),
        run: async () => ({ ok: true, message: `${opts.name} green`, details }),
      }),
    };
    const gate = cascadeFactory(doctored)
      .chain.phases.find((p) => p.name === "build")
      ?.gates.find((g) => g.name === "vitest");
    expect(gate, "cascade's build phase declares a vitest gate").toBeDefined();
    return gate!;
  };

  const ctxNaming = (tests: unknown): GateContext => ({
    cwd: "/repo",
    repoRoot: "/repo",
    flumeDir: "/repo/.flume",
    stateRootRel: ".flume",
    configDir: "/repo/.flume",
    pendingDir: "/repo/.flume/plan/pending",
    phaseName: "build",
    commitSha: "c".repeat(40),
    baseSha: "b".repeat(40),
    touchedPaths: [],
    entry: {
      tag: "NAMED-BEHAVIOR",
      gate: { kind: "open" },
      dependsOnForks: [],
      priority: 0,
      files: { new: [], edit: [], retire: [] },
      tests,
    } satisfies PendingEntry,
    log: () => {},
  });

  const PINNED = "a behavior somebody pinned";
  const FILE = "tests/thing.test.ts";

  it("the vitest gate cascade ships to build refuses an entry whose named behavior has no passing test", async () => {
    const gate = shippedVitestGate(
      report(FILE, `thing > ${PINNED}`, "passed"),
    );

    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): the same gate over the same report passes the entry that
    // names the behavior the report carries. Without this the refusals below
    // would hold just as well for a gate that refuses everything, or one whose
    // judged set is empty because `tests[]` never reached it.
    const earned = await gate.run(
      ctxNaming([{ path: FILE, asserts: PINNED }]),
    );
    expect(earned.ok, earned.message).toBe(true);
    expect(earned.message).toContain("1 named behavior(s)");

    // No test carries the line.
    const unnamed = await gate.run(
      ctxNaming([{ path: FILE, asserts: "a behavior nobody pinned" }]),
    );
    expect(unnamed.ok).toBe(false);
    expect(unnamed.message).toContain("1 of 1 named behavior(s)");
    expect(unnamed.details).toContain(`- ${FILE}: a behavior nobody pinned`);

    // A test carries the line, but not in the file the entry declared — the
    // `path` half of the declaration is judged too, not decoration beside it.
    const elsewhere = await gate.run(
      ctxNaming([{ path: "tests/other.test.ts", asserts: PINNED }]),
    );
    expect(elsewhere.ok).toBe(false);
    expect(elsewhere.details).toContain(`- tests/other.test.ts: ${PINNED}`);

    // The line's test exists and ran, but failed: a red test names nothing.
    const red = shippedVitestGate(report(FILE, `thing > ${PINNED}`, "failed"));
    expect((await red.run(ctxNaming([{ path: FILE, asserts: PINNED }]))).ok).toBe(
      false,
    );

    // Green suite, unreadable report: every line would pass vacuously.
    const blind = shippedVitestGate("no json here");
    expect(
      (await blind.run(ctxNaming([{ path: FILE, asserts: PINNED }]))).ok,
    ).toBe(false);
  });

  it("the gate cascade ships to build asks its runner for the JSON report the judge reads", async () => {
    // Read off the undoctored chain: the command and placement under test are
    // the ones a real tick spawns, not the stub's.
    const buildPhase = cascadeChain.phases.find((p) => p.name === "build");
    const shipped = buildPhase?.gates.find((g) => g.name === "vitest");
    expect(shipped, "cascade's build phase declares a vitest gate").toBeDefined();
    expect(shipped!.when).toBe("afterMerge");
    expect(shipped!.command).toContain("--reporter=json");

    // An entry naming nothing has nothing to judge, and the wrapper hands the
    // suite's own verdict straight back — vacuous by design, spelled rather
    // than inherited. Driven on the shipped gate over a stub suite, so this
    // never spawns the runner `command` names.
    const nothingNamed = await shippedVitestGate(
      report(FILE, `thing > ${PINNED}`, "passed"),
    ).run(ctxNaming(undefined));
    expect(nothingNamed.ok).toBe(true);
    expect(nothingNamed.message).toBe("vitest green");
  });
});
/**
 * spec/chain.md, *What a gate receives* — `entry` and `baseSha` are the two
 * facts a per-entry gate most needs, and no shipped example read `baseSha` at
 * all, so the value an adopter needs to tell "the tick created this path"
 * from "it was already there" looked unavailable. Cascade now judges the
 * entry's `files` classes against the span they claim to describe
 * (`declaredFilesGate`), reading the pick, the span's base, its tip and its
 * touched paths off the context rather than re-deriving any of them.
 *
 * Driven over a stub at-sha reader: every refusal here is a tree state a real
 * repo cannot be made to produce on demand, and refusal tests keep their
 * hand-authored input (`.claude/rules/engineering.md`, *A seam gate reads what
 * the real writer wrote*). The stub records the refs it was asked for, which is
 * how the "reads the span's base sha off the context" half is pinned rather
 * than assumed — the fixture's `repoRoot` names a directory that does not
 * exist, so a gate that shelled git itself would throw instead.
 */
describe("cascade-chain.ts — the entry's file classes are judged against the span", () => {
  const BASE = "b".repeat(40);
  const TIP = "c".repeat(40);
  const TAG = "DECLARED-FILES-FIXTURE";

  /** A stub of `api.git.readFileAtRef` over a ref → paths world. */
  const readerOver = (world: Record<string, string[]>) => {
    const asked: Array<{ ref: string; path: string }> = [];
    return {
      asked,
      read: async (_repoRoot: string, ref: string, path: string) => {
        asked.push({ ref, path });
        return world[ref]?.includes(path) ? `contents of ${path}` : null;
      },
    };
  };

  const entryDeclaring = (
    files: Partial<PendingEntry["files"]>,
  ): PendingEntry => ({
    tag: TAG,
    gate: { kind: "open" },
    dependsOnForks: [],
    priority: 0,
    files: { new: [], edit: [], retire: [], ...files },
  });

  const ctxFor = (
    entry: PendingEntry | undefined,
    touchedPaths: string[],
  ): GateContext => ({
    cwd: "/nonexistent/declared-files-fixture",
    repoRoot: "/nonexistent/declared-files-fixture",
    flumeDir: "/nonexistent/declared-files-fixture/.flume",
    stateRootRel: ".flume",
    configDir: "/nonexistent/declared-files-fixture/.flume",
    pendingDir: "/nonexistent/declared-files-fixture/.flume/plan/pending",
    phaseName: "build",
    baseSha: BASE,
    commitSha: TIP,
    log: () => {},
    touchedPaths,
    ...(entry ? { entry } : {}),
  });

  it("the cascade example's gate reads the entry tag and the span's base sha from its gate context", async () => {
    const world = {
      [BASE]: ["src/kept.ts", "src/gone.ts"],
      [TIP]: ["src/kept.ts", "src/born.ts"],
    };
    const reader = readerOver(world);
    const gate = declaredFilesGate(reader.read);

    const honest = entryDeclaring({
      new: [{ path: "src/born.ts", description: "the tick creates it" }],
      edit: [{ path: "src/kept.ts", description: "the tick rewrites it" }],
      retire: ["src/gone.ts"],
    });
    const touched = ["src/born.ts", "src/kept.ts", "src/gone.ts"];
    const green = await gate.run(ctxFor(honest, touched));

    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): a gate handed no entry, or one whose declared paths never
    // reached the judge, would return the same `ok: true` over nothing. The
    // verdict names the entry it gated and the count it judged, and the reader
    // was asked about every declared path at both ends of the span.
    expect(green.ok, green.message).toBe(true);
    expect(green.message).toContain(TAG);
    expect(green.message).toContain("3 declared path(s)");
    expect(green.skipped).toBeUndefined();
    expect(reader.asked.filter((a) => a.ref === BASE).map((a) => a.path).sort())
      .toEqual([...touched].sort());
    expect(reader.asked.filter((a) => a.ref === TIP).map((a) => a.path).sort())
      .toEqual([...touched].sort());
    // `baseSha` is what separates the three classes, and the message quotes
    // the span it read rather than a base re-derived from a path convention.
    expect(green.message).toContain(`${BASE.slice(0, 7)}..${TIP.slice(0, 7)}`);

    // A path the entry filed under `new` that the base already held: the
    // tick edited an existing file under a class that claims it created one.
    const misfiledNew = await gate.run(
      ctxFor(
        entryDeclaring({
          new: [{ path: "src/kept.ts", description: "claims to create it" }],
        }),
        ["src/kept.ts"],
      ),
    );
    expect(misfiledNew.ok).toBe(false);
    expect(misfiledNew.message).toContain(TAG);
    expect(misfiledNew.details).toContain("src/kept.ts: declared new");

    // A path filed under `retire` that the commit still carries.
    const notRetired = await gate.run(
      ctxFor(entryDeclaring({ retire: ["src/kept.ts"] }), ["src/kept.ts"]),
    );
    expect(notRetired.ok).toBe(false);
    expect(notRetired.details).toContain("src/kept.ts: declared retire");

    // A path filed under `edit` that the base never held.
    const editedNothing = await gate.run(
      ctxFor(
        entryDeclaring({
          edit: [{ path: "src/born.ts", description: "claims to edit it" }],
        }),
        ["src/born.ts"],
      ),
    );
    expect(editedNothing.ok).toBe(false);
    expect(editedNothing.details).toContain("src/born.ts: declared edit");
  });

  it("the cascade example's gate spells its vacuous cases", async () => {
    const reader = readerOver({ [BASE]: ["src/kept.ts"], [TIP]: ["src/kept.ts"] });
    const gate = declaredFilesGate(reader.read);

    // The span itself is no longer among the cases: `baseSha`, `commitSha`
    // and `touchedPaths` are all stated on every gate context by type, so a
    // context missing any of them is unconstructable rather than refusable,
    // and the gate carries no guard for one. An *empty* touched list is
    // judged below, not here.

    // A singleton tick carries no entry: nothing entry-scoped to judge, said
    // out loud rather than inherited as a pass.
    const noEntry = await gate.run(ctxFor(undefined, ["src/kept.ts"]));
    expect(noEntry.ok).toBe(true);
    expect(noEntry.skipped).toBeTruthy();

    // An entry that declared no files has no class to judge at all — the one
    // legitimately empty selection, spelled in its own case rather than
    // inherited from the zero-touched refusal below.
    const nothingDeclared = await gate.run(
      ctxFor(entryDeclaring({}), ["src/kept.ts"]),
    );
    expect(nothingDeclared.ok).toBe(true);
    expect(nothingDeclared.skipped).toBeTruthy();

    // Every branch above refused or skipped before reading a ref.
    expect(reader.asked).toEqual([]);
  });

  it("the cascade example's gate refuses a commit that touched none of the entry's declared files", async () => {
    const reader = readerOver({ [BASE]: ["src/kept.ts"], [TIP]: ["src/kept.ts"] });
    const gate = declaredFilesGate(reader.read);
    const entry = entryDeclaring({
      edit: [{ path: "src/kept.ts", description: "the tick rewrites it" }],
      retire: ["src/gone.ts"],
    });

    // Cascade's build declares neither `entryChannelPaths` nor a `shipped`
    // predicate, so this commit retires the entry whatever it touched. A green
    // here would ship a file prediction — the one the fanout partition was cut
    // from — that nothing in the span met.
    const nothingMet = await gate.run(
      ctxFor(entry, [".flume/plan/notes/DECLARED-FILES-FIXTURE.md"]),
    );
    expect(nothingMet.ok).toBe(false);
    expect(nothingMet.message).toContain(TAG);
    expect(nothingMet.message).toContain("2 path(s)");
    expect(nothingMet.details).toContain("src/kept.ts: declared edit");
    expect(nothingMet.details).toContain("src/gone.ts: declared retire");
    // Refused on the declaration alone: unjudgeable, not judged-and-wrong.
    expect(reader.asked).toEqual([]);

    // The bounded exception the refusal floors: a span that met part of its
    // declaration is still judged on the part it met, and passes.
    const partial = await gate.run(ctxFor(entry, ["src/kept.ts"]));
    expect(partial.ok, partial.message).toBe(true);
    expect(partial.message).toContain("1 declared path(s)");
    expect(partial.skipped).toBeUndefined();
    expect(reader.asked.map((a) => a.path)).toEqual(["src/kept.ts", "src/kept.ts"]);
  });
});

/**
 * spec/pending.md, *The chain-declared extension* — one declaration drives
 * every surface that reads it. Cascade's `tests[]` carries a title contract
 * `judgedByEntryTests` reverts commits over, and build's prompt stated none of
 * it: the agent held to the rule met it first as a revert. Build's promptArgs
 * now renders the field's own `hint`, so the surface that states the contract
 * and the surface that enforces it read the same string.
 *
 * Agreement pin (.claude/rules/engineering.md, *A seam gate reads what the real
 * writer wrote*): the shipped prompt template is read off disk and both phases'
 * real `promptArgs` run, so a second sentence hand-written into either surface
 * fails here rather than drifting quietly. The fixture's roots name a directory
 * that does not exist — neither builder may reach disk for this.
 */
describe("cascade-chain.ts — build's prompt quotes the declaration it is judged by", () => {
  const buildPhase = cascadeChain.phases.find((p) => p.name === "build");
  const planPhase = cascadeChain.phases.find((p) => p.name === "plan-derive");

  const ctx = (over: Partial<TickContext>): TickContext => ({
    cwd: "/nonexistent/build-prompt-fixture",
    flumeDir: "/nonexistent/build-prompt-fixture/.flume",
    ...over,
  });

  it("cascade's build prompt states the tests[] title contract from the entry extension's own hint", () => {
    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): an undeclared builder on either phase would leave every
    // claim below asserted over nothing.
    expect(buildPhase?.promptArgs, "cascade's build declares promptArgs")
      .toBeTypeOf("function");
    expect(planPhase?.promptArgs, "cascade's plan slices declare promptArgs")
      .toBeTypeOf("function");

    const args = buildPhase!.promptArgs!(
      ctx({
        assignedEntry: {
          tag: "BUILD-PROMPT-FIXTURE",
          gate: { kind: "open" },
          dependsOnForks: [],
          priority: 0,
          files: { new: [], edit: [], retire: [] },
          per: {
            path: "spec/pending.md",
            section: "The chain-declared extension",
          },
        } satisfies PendingEntry,
      }),
    );

    // The template the phase names, not a copy of it: `renderPrompt` throws on
    // a `{{KEY}}` no promptArgs supplies, so the two are read together.
    const template = readFileSync(
      fileURLToPath(
        new URL(`../examples/${buildPhase!.promptPath}`, import.meta.url),
      ),
      "utf8",
    );
    const placeholders = [...template.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)].map(
      (m) => m[1]!,
    );
    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders).toContain("TESTS_HINT");
    // FLUME_DIR is the dispatcher's reserved arg, injected past promptArgs.
    expect(
      placeholders.filter((k) => k !== "FLUME_DIR" && !(k in args)),
    ).toEqual([]);

    // The contract itself, and the other surface rendered from the same field:
    // plan writes entries against `renderSchemaForPrompt`'s block, so a hint
    // build restated by hand would no longer be found inside it.
    const hint = args.TESTS_HINT!;
    expect(hint.length).toBeGreaterThan(0);
    const schemaBlock = planPhase!.promptArgs!(ctx({})).PENDING_SCHEMA!;
    expect(schemaBlock).toContain(`"tests": ${hint}`);
  });
});

/**
 * Agreement pin (.claude/rules/engineering.md, *Derived state is computed,
 * never restated beside its source*): `docs/CHAIN-AUTHORING.md` walks the
 * reader through a fence introduced as the `slicePhase` declaration from
 * `examples/cascade-chain.ts`. That quote is a second copy of code the example
 * owns — and both files ship in the tarball — so it is read back against the
 * real declaration rather than kept in step by discipline.
 *
 * Normalized away on both sides: indentation (the quote sits at column 0, the
 * source inside a factory) and whole-line comments, which diverge
 * deliberately — the doc annotates for a reader who has no surrounding file.
 * Everything else must match. A trailing `//` comment added to one side alone
 * reds this pin rather than being carved out: it fails toward loud.
 */
describe("docs/CHAIN-AUTHORING.md — the walkthrough quotes the chain it names", () => {
  /**
   * The `slicePhase` arrow, from its `const` line through the `});` closing it
   * at the same indentation — the shape prettier holds both files in.
   */
  const declarationBlock = (text: string): string[] => {
    const lines = text.split("\n");
    const start = lines.findIndex((l) => /^\s*const slicePhase\s*=/.test(l));
    expect(start, "a `slicePhase` declaration is present").toBeGreaterThanOrEqual(
      0,
    );
    const indent = /^\s*/.exec(lines[start]!)![0];
    const end = lines.indexOf(`${indent}});`, start);
    expect(
      end,
      "the `slicePhase` declaration closes at its own indentation",
    ).toBeGreaterThan(start);
    return lines.slice(start, end + 1);
  };

  /** Indentation and comments away; the code lines that remain, in order. */
  const normalize = (lines: string[]): string[] =>
    lines
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//"));

  it("the CHAIN-AUTHORING slicePhase quote matches examples/cascade-chain.ts modulo indentation and comments", () => {
    const doc = readFileSync(
      fileURLToPath(new URL("../docs/CHAIN-AUTHORING.md", import.meta.url)),
      "utf8",
    );
    const quoted = [...doc.matchAll(/```ts\n([\s\S]*?)```/g)]
      .map((m) => m[1]!)
      .filter((fence) => /^const slicePhase\b/.test(fence.trim()));
    // Exactly one, so the comparison below cannot pass by picking a twin.
    expect(
      quoted,
      "CHAIN-AUTHORING.md quotes `slicePhase` exactly once",
    ).toHaveLength(1);

    const fromDoc = normalize(declarationBlock(quoted[0]!));
    const fromSource = normalize(
      declarationBlock(
        readFileSync(
          fileURLToPath(
            new URL("../examples/cascade-chain.ts", import.meta.url),
          ),
          "utf8",
        ),
      ),
    );

    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): a truncated extraction on either side would leave the
    // equality below comparing nothing against nothing. The fence's substance
    // is the `writablePaths` list, so that is what is asserted present.
    expect(fromSource.length).toBeGreaterThan(10);
    expect(fromSource).toContain("writablePaths: [");
    expect(fromSource).toContain("`${stateRoot}/plan/pending/*.json`,");

    expect(fromDoc).toEqual(fromSource);
  });
});

/**
 * Doc-surface pin (`.claude/rules/engineering.md`, *Narration is the ladder's
 * bottom rung*, the `docs/` carve-out): *Use the built-ins first* is the
 * inventory a chain author reads before any hover text, and a built-in the
 * list skips is one nobody finds — `chainLoadGate` shipped on `FlumeApi` with
 * zero hits on this whole page. A bullet the module no longer exports is an
 * instruction to reach for something that is not there, so the claim is
 * equality rather than coverage and either side moving alone reds.
 *
 * The second case holds the walk as the section's only naming of the set:
 * prose re-listing the gates beside the bullets is a copy no equality read
 * reaches, so an eighth built-in lands in the walk and strands it (*Derived
 * state is computed, never restated beside its source*). The third reads what
 * the `shellGate` bullet claims about the rest, which is where the listing
 * stops being a listing.
 *
 * The set is the module's own runtime exports, read off the namespace rather
 * than listed here (same section): a gate added to `src/builtinGates.ts`
 * joins it without anyone extending a list, and the third case has already
 * classified every one of them as a gate or the factory for one.
 */
describe("docs/CHAIN-AUTHORING.md — the built-ins list walks the gate module", () => {
  /**
   * The gates `src/builtinGates.ts` exports, against the section that lists
   * them — armed by `docWalk` (`tests/helpers/docWalk.ts`), the reader this
   * page's other three walks arm through, so the vacuity anchor and the
   * section's own anchor are spelled once rather than once per case.
   *
   * This is the supplied arm: a built-in is a `const` on a namespace, not a
   * member of an interface, so no checker reaches the set. It stays computed
   * all the same — `Object.keys`, never a list spelled out beside the module.
   */
  const BUILT_INS: DocWalkRequest = {
    members: Object.keys(builtinGates),
    member: "chainLoadGate",
    page: "docs/CHAIN-AUTHORING.md",
    heading: "### Use the built-ins first",
    anchor: "- `tscGate` —",
  };

  it("docs/CHAIN-AUTHORING.md names every gate src/builtinGates.ts exports", () => {
    const { members: exported, section } = docWalk(BUILT_INS);

    expect(
      walkOf(section, exported).sort(),
      "docs/CHAIN-AUTHORING.md gives every gate `src/builtinGates.ts` exports a bullet of its own",
    ).toEqual([...exported].sort());
  });

  it("docs/CHAIN-AUTHORING.md's built-ins section names the gate set in one place", () => {
    const { members: exported, section } = docWalk(BUILT_INS);

    // The walk is there before an absence is asserted beside it: over a
    // section that walks nothing, every listing reads as the only one
    // (.claude/rules/engineering.md, "A green verdict is proven non-vacuous").
    expect(
      walkOf(section, exported).length,
      "docs/CHAIN-AUTHORING.md's built-ins section walks the gates at all",
    ).toBeGreaterThan(1);

    // The sample fence destructures the gates unbackticked, which no naming
    // read reaches; what this catches is prose — a paragraph sorting the
    // built-ins into classes beside the bullets that already carry them,
    // which is the copy an eighth gate strands.
    expect(
      restatementsOf(section, exported),
      "docs/CHAIN-AUTHORING.md's built-ins section lists the gates beside its walk",
    ).toEqual([]);
  });

  /**
   * The list's `shellGate` bullet says which of those built-ins `shellGate`
   * composes. Spelled as a count — "the four built-ins above" — that claim
   * resolved against nothing, and was wrong over five bullets, only three of
   * which `shellGate` builds. So the bullet names its members, and the names
   * are read back against `src/builtinGates.ts` rather than kept true by
   * discipline.
   *
   * Composition is read off the program, not off the page's vocabulary: a
   * `shellGate`-built gate's `run` *is* the closure `shellGate` returns, so an
   * export whose `run` source matches a probe instance's is one `shellGate`
   * composed. `command` is the evidence the bullet offers a reader, not this
   * test's — any hand-rolled gate may set it.
   */
  it("docs/CHAIN-AUTHORING.md names exactly the built-in gates shellGate composes", () => {
    const { members: exported, section } = docWalk(BUILT_INS);
    const probe = builtinGates.shellGate({
      name: "probe",
      when: "afterCommit",
      cmd: "true",
      args: [],
    });
    /**
     * Every runtime export of the module, as the gate it is or the one it
     * builds. Declared divergence from `.claude/rules/engineering.md`,
     * *Derived state is computed, never restated beside its source*: this is
     * a hand-spelled second listing of a set `Object.keys(builtinGates)`
     * already yields, and the sibling case walking that namespace is the
     * reason a reader arrives here expecting no such list.
     *
     * The divergence is the right depth because the copy is not the set — it
     * is the classification. Regenerating it is not mechanical: a factory
     * export has to be *called*, with arguments only a reader who knows that
     * gate can supply, and which exports are factories is precisely what this
     * case exists to judge. Deriving it would make the subject an assumption.
     *
     * The refusal that bounds it is the `toEqual` immediately below
     * (*Loud or nothing*): the keys are read back against the walked exports
     * before the composed set is computed, so a gate added to the module reds
     * here rather than dropping out of the comparison. The copy cannot go
     * stale silently — only loudly.
     */
    const instances: Record<string, Gate> = {
      shellGate: probe,
      tscGate: builtinGates.tscGate,
      vitestGate: builtinGates.vitestGate,
      eslintGate: builtinGates.eslintGate,
      chainLoadGate: builtinGates.chainLoadGate,
      pendingGate: builtinGates.pendingGate({
        targetFence: { writablePaths: [], entryChannelPaths: [] },
      }),
      writablePathsGate: builtinGates.writablePathsGate([]),
    };
    // A gate added to the module is classified here before the composed set
    // below can quietly omit it.
    expect(Object.keys(instances).sort()).toEqual([...exported].sort());

    const fingerprint = probe.run.toString();
    const composed = Object.keys(instances)
      .filter(
        (name) =>
          name !== "shellGate" && instances[name]!.run.toString() === fingerprint,
      )
      .sort();
    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): an empty composed set is named in full by any bullet at
    // all, including one that names nothing.
    expect(composed.length).toBeGreaterThan(0);

    // The one bullet, through the next list item or the section's end, read as
    // a single line — the claim wraps across source lines.
    const bullet = bulletOf(section, "- `shellGate` —");
    const CLAIM = "are `shellGate` instances";
    expect(
      bullet,
      "the `shellGate` bullet names which built-ins it composes",
    ).toContain(CLAIM);

    const named = [
      ...new Set(
        [...bullet.slice(0, bullet.indexOf(CLAIM)).matchAll(/`(\w+Gate)`/g)].map(
          (m) => m[1]!,
        ),
      ),
    ]
      .filter((name) => name !== "shellGate")
      .sort();

    expect(named).toEqual(composed);
  });
});

/**
 * Agreement pin (.claude/rules/engineering.md, *A seam gate reads what the
 * real writer wrote*): `docs/CHAIN-AUTHORING.md`'s supervisor-policy section
 * is the only prose a chain author reads before declaring
 * `Chain.supervisorPolicy`, and a knob the section skips is a knob nobody
 * finds — `tickTimeoutMs` and `partitionIgnore` were each reachable only
 * through a migration note for a release line before this pin. A bullet the
 * block no longer declares is a knob nobody can set, so the claim is equality
 * rather than coverage, and the walk is read by `walkOf`
 * (`tests/helpers/docSections.ts`), the one reader the page's walks share.
 *
 * The second case holds the walk as the section's only naming of the set:
 * prose re-listing the knobs beside the bullets is a copy no equality read
 * reaches, so a seventh knob lands in the walk and strands it (*Derived state
 * is computed, never restated beside its source*). The third reads what the
 * listing used to carry — each knob's binding class — from the bullet that
 * decides it, which is where the fact stops being a list.
 *
 * The knob list is read off the declaration through `docWalk`
 * (`tests/helpers/docWalk.ts`), never kept as a second list beside it
 * (*Derived state is computed, never restated beside its source*): a field
 * added to the type without a paragraph reds here, which a hand-kept list
 * could only do if someone remembered to extend it. A checker resolves it, so
 * the pin survives the block becoming a named type rather than the inline
 * literal it is today.
 */
describe("docs/CHAIN-AUTHORING.md — the supervisor-policy walk covers the block", () => {
  /**
   * The knobs `Chain["supervisorPolicy"]` declares, against the section that
   * walks them — both armed by `docWalk` (`tests/helpers/docWalk.ts`), the one
   * reader the three walks over this page share, so the resolution, its
   * vacuity anchor and the section's own anchor are spelled once each rather
   * than once per walk.
   */
  const POLICY: DocWalkRequest = {
    module: "src/Phase.ts",
    interface: "Chain",
    through: "supervisorPolicy",
    member: "quarantineScope",
    page: "docs/CHAIN-AUTHORING.md",
    heading: /^## \d+\. Supervisor policy \(`supervisorPolicy`\)$/m,
    anchor: "`Chain.supervisorPolicy`",
  };

  it("docs/CHAIN-AUTHORING.md's supervisor-policy section names every Chain.supervisorPolicy field the engine reads", () => {
    const { members: knobs, section } = docWalk(POLICY);

    expect(
      [...walkOf(section, knobs)].sort(),
      "docs/CHAIN-AUTHORING.md's supervisor-policy section walks exactly the knobs `Chain.supervisorPolicy` declares",
    ).toEqual([...knobs].sort());
  });

  it("docs/CHAIN-AUTHORING.md's supervisor-policy section names the knob set in one place", () => {
    const { members: knobs, section } = docWalk(POLICY);

    // The walk is there before an absence is asserted beside it: over a
    // section that walks nothing, every listing reads as the only one
    // (.claude/rules/engineering.md, "A green verdict is proven non-vacuous").
    expect(
      walkOf(section, knobs).length,
      "docs/CHAIN-AUTHORING.md's supervisor-policy section walks the knobs at all",
    ).toBeGreaterThan(1);

    // The declaration sample is a fenced block naming the knobs unbackticked,
    // which no naming read reaches; what this catches is prose — a paragraph
    // sorting the knobs into classes beside the bullets that already carry
    // them, which is the copy a seventh knob strands.
    expect(
      restatementsOf(section, knobs),
      "docs/CHAIN-AUTHORING.md's supervisor-policy section lists the knobs beside its walk",
    ).toEqual([]);
  });

  it("docs/CHAIN-AUTHORING.md's supervisor-policy section says when each knob is bound", () => {
    const { members: knobs, section } = docWalk(POLICY);

    // Binding time is what the retired listing was for, and it is per-knob
    // truth: a chain that edits itself mid-run is governed by the old value
    // of a once-per-run knob with no indication the new one was ignored. A
    // bullet silent on its class sends that author to the prose the listing
    // no longer is. Every declared knob answers, so a seventh cannot ship
    // mute.
    for (const knob of knobs) {
      expect(
        bulletOf(section, `- **\`${knob}\`** —`),
        `docs/CHAIN-AUTHORING.md's \`${knob}\` bullet states its binding time`,
      ).toMatch(/\*\*once per run\*\*|\*\*per tick\*\*/);
    }
  });
});

/**
 * Agreement pin (.claude/rules/engineering.md, *Narration is the ladder's
 * bottom rung*: a `docs/` page stating what a shipped interface does — "a
 * runner's operations" — may be pinned against the interface it describes).
 * *What adoption costs* prices a non-vitest adoption by walking the runner's
 * operations one bullet each, and that walk is the whole quote a consumer
 * gets before it starts porting. An operation `Runner` gains and the page
 * skips is a cost nobody was quoted; a bullet the interface no longer
 * declares is a cost nobody owes — so the claim is equality, not coverage,
 * and either side moving alone reds.
 *
 * The second case holds the walk as the section's only naming of the set:
 * prose re-listing the operations beside the bullets is a copy no equality
 * read reaches, so a fourth operation lands in the walk and strands it
 * (*Derived state is computed, never restated beside its source*). Both cases
 * read one page through `walkOf` and `restatementsOf`
 * (`tests/helpers/docSections.ts`), the reader this page's walks share, so
 * neither can be green over a naming the other cannot see.
 *
 * Neither side is restated here (same section): the members come off the
 * declaration through a checker, the namings off the page.
 *
 * `docs/MIGRATING-0.16.md` states the same three operations and is
 * deliberately not pinned: that page opens by declaring itself a dated
 * record of one release's port, a divergence declared at its own site.
 */
describe("docs/CHAIN-AUTHORING.md — the adoption price walks the runner", () => {
  /**
   * The operations `Runner` (`harness/runner.ts`) declares, against the
   * section that prices them — armed by `docWalk` (`tests/helpers/docWalk.ts`),
   * the reader the sibling walks above and below arm through too.
   */
  const ADOPTION: DocWalkRequest = {
    module: "harness/runner.ts",
    interface: "Runner",
    member: "runAtBase",
    page: "docs/CHAIN-AUTHORING.md",
    heading: /^### What adoption costs$/m,
    anchor: "**The runner is the largest single piece**",
  };

  it("docs/CHAIN-AUTHORING.md's adoption section names every operation Runner declares", () => {
    const { members: operations, section } = docWalk(ADOPTION);

    expect(
      [...walkOf(section, operations)].sort(),
      "docs/CHAIN-AUTHORING.md's adoption section walks exactly the operations `Runner` declares",
    ).toEqual([...operations].sort());
  });

  it("docs/CHAIN-AUTHORING.md's adoption section names Runner's operation set in one place", () => {
    const { members: operations, section } = docWalk(ADOPTION);

    // The walk is there before an absence is asserted beside it: over a
    // section that walks nothing, every listing reads as the only one
    // (.claude/rules/engineering.md, "A green verdict is proven non-vacuous").
    expect(
      walkOf(section, operations).length,
      "docs/CHAIN-AUTHORING.md's adoption section walks the operations at all",
    ).toBeGreaterThan(1);

    expect(
      restatementsOf(section, operations),
      "docs/CHAIN-AUTHORING.md's adoption section lists the operations beside its walk",
    ).toEqual([]);
  });
});

/**
 * Agreement pin (.claude/rules/engineering.md, *Narration is the ladder's
 * bottom rung*: a `docs/` page stating what a shipped interface does — "the
 * files a verb writes", a gate's input surface — may be pinned against the
 * interface it describes). *What's on `ctx`* is the only standing page that
 * tells a chain author what a gate is handed; a migration page reaches
 * whoever ports across one release and nobody after. A field `GateContext`
 * gains and the page skips is a capability a chain rebuilds by hand off a
 * convention the engine never promised — the failure `baseSha` and
 * `landedOnSha` each shipped into — and a field the interface drops is an
 * instruction to read something that is not there, so the claim is equality
 * rather than coverage and either side moving alone reds.
 *
 * Neither side is restated here (*Derived state is computed, never restated
 * beside its source*): the fields come off the declaration through a
 * checker, the walk off the page's own bullets.
 *
 * `docs/MIGRATING-0.15.md` names a subset of the same fields and is
 * deliberately not pinned: that page is a dated record of one release's
 * port, not the standing surface.
 */
describe("docs/CHAIN-AUTHORING.md — the gate section walks GateContext", () => {
  /**
   * The fields `GateContext` (`src/Gate.ts`) declares, against the section
   * that walks them — armed by `docWalk` (`tests/helpers/docWalk.ts`), as the
   * sibling walks over this page are. The unresolved `PendingEntry` import
   * costs that reader's cheap tier nothing: a property's name is readable
   * whether or not its type resolved.
   */
  const GATE: DocWalkRequest = {
    module: "src/Gate.ts",
    interface: "GateContext",
    member: "baseSha",
    page: "docs/CHAIN-AUTHORING.md",
    heading: /^### What's on `ctx`$/m,
    anchor: "`GateContext` is the gate's whole input surface",
  };

  it("docs/CHAIN-AUTHORING.md's gate section names every GateContext field the engine sets", () => {
    const { members: fields, section } = docWalk(GATE);

    expect(
      [...walkOf(section, fields)].sort(),
      "docs/CHAIN-AUTHORING.md's gate section walks exactly the fields `GateContext` declares",
    ).toEqual([...fields].sort());
  });

  it("docs/CHAIN-AUTHORING.md's gate section names GateContext's field set in one place", () => {
    const { members: fields, section } = docWalk(GATE);

    // The walk is there before an absence is asserted beside it: over a
    // section that walks nothing, every listing reads as the only one.
    expect(
      walkOf(section, fields).length,
      "docs/CHAIN-AUTHORING.md's gate section walks the fields at all",
    ).toBeGreaterThan(1);

    // The walk's own two lists — where the gate is running, what is being
    // gated — are both walk, so this reads the prose around them: a paragraph
    // naming two fields is the section listing the set a second time, while a
    // bullet naming a sibling is the walk explaining itself.
    expect(
      restatementsOf(section, fields),
      "docs/CHAIN-AUTHORING.md's gate section lists the fields beside its walk",
    ).toEqual([]);
  });

  it("docs/CHAIN-AUTHORING.md's gate section says which stage sets each span field", () => {
    const { section } = docWalk(GATE);

    /** One bullet of the walk, by the lead this section spells its names with. */
    const bulletFor = (field: string): string =>
      bulletOf(section, `- \`${field}\` —`);

    // A field whose availability varies is the one a chain guesses wrong
    // about: `baseSha` at both stages, `landedOnSha` only where a trunk
    // exists. Naming the field without naming its stage is how a gate ends
    // up branching on a value it assumed was there.
    expect(bulletFor("baseSha")).toContain("**both** stages");
    const landedOn = bulletFor("landedOnSha");
    expect(landedOn).toContain("`afterMerge`");
    expect(landedOn).toContain("Absent under `afterCommit`");
    expect(bulletFor("entry")).toContain("absent on a singleton tick");
  });
});

/**
 * spec/chain.md, *Per-run artifacts belong under `FLUME_DIR`* — "`examples/`
 * shows it". The backlog groomer is the example that does, so the placement
 * is driven rather than read: a real `groom` tick runs, and the transcript
 * the chain opted into capturing is looked for under the state root the
 * engine handed the factory.
 *
 * In this lane deliberately, alongside the ladder drive above: git plumbing
 * over a fixture is not a lane trigger, and the chain's agent is its own
 * deterministic groomer, so no `claude` starts. The gate that decides every
 * build runs this lane, which is where a placement claim has to be pinned to
 * guard anything.
 */
describe("backlog-groomer-chain.ts — where the session capture lands", () => {
  /** One shippable backlog item, seeded and committed — a groom tick needs work to have stdout. */
  async function seedBacklog(repo: string): Promise<void> {
    const backlog = [
      {
        tag: "trim-notes-intro",
        gate: { kind: "open" },
        dependsOnForks: [],
        files: { edit: [{ path: "README.md", description: "trim the intro" }] },
        reason: "intro paragraph restates the title",
      },
    ];
    writeFileSync(join(repo, "BACKLOG.json"), `${JSON.stringify(backlog, null, 2)}\n`);
    await exec("git", ["add", "BACKLOG.json"], { cwd: repo });
    await exec("git", ["commit", "-q", "-m", "seed backlog"], { cwd: repo });
  }

  /**
   * One real groom tick over `fx.repo` with state at `flumeDir`. The chain is
   * built from the same `FlumePaths` object the `Dispatcher` is spread from, so
   * `api.paths.flumeDir` is the root the engine resolved, by identity — neither
   * half can agree with itself (`.claude/rules/engineering.md`, *A seam gate
   * reads what the real writer wrote*). `configDir` is the shipped `examples/`,
   * so `Phase.promptPath` finds the committed prompt rather than a copy.
   */
  async function groomTick(fx: Fixture, flumeDir: string): Promise<TickOutcome> {
    const paths: FlumePaths = {
      repoRoot: fx.repo,
      configDir: EXAMPLE_PATHS.configDir,
      flumeDir,
    };
    const { chain } = backlogGroomerFactory(buildFlumeApi(paths));
    new Baton(flumeDir).wake("groom");
    const outcome = await new Dispatcher({
      ...paths,
      // Stands in for the dispatcher default so a resolution regression
      // fails loudly here rather than spawning a real `claude`: the chain's
      // own `Phase.agent` must win.
      agent: {
        name: "never",
        async invoke() {
          throw new Error("Phase.agent should have taken precedence");
        },
      },
      chainLoader: async () => ({ chain }),
      log: silent,
    }).tick();
    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): a declined or failed tick produced no stdout at all, and
    // every capture assertion below would be judging the absence of a tick, not
    // a placement.
    expect(outcome.failed, outcome.summary).toBeUndefined();
    expect(outcome.declined, outcome.summary).toBeUndefined();
    expect(outcome.result?.committed, outcome.summary).toBe(true);
    return outcome;
  }

  /** Files under `<flumeDir>/sessions/`, or `undefined` when the chain never created it. */
  function captures(flumeDir: string): { name: string; text: string }[] | undefined {
    const dir = join(flumeDir, "sessions");
    if (!existsSync(dir)) return undefined;
    return readdirSync(dir).map((name) => ({
      name,
      text: readFileSync(join(dir, name), "utf8"),
    }));
  }

  it("the backlog groomer example writes its session capture under the flumeDir the engine handed its factory", async () => {
    const fx = await makeFixture();
    try {
      await seedBacklog(fx.repo);
      const flumeDir = join(fx.repo, ".flume");

      await groomTick(fx, flumeDir);

      const written = captures(flumeDir);
      // The capture set itself pinned non-vacuous before its content is
      // read: no sessions dir, or an empty one, is the pre-fix tree.
      expect(written ?? []).toHaveLength(1);
      // Non-empty, and carrying this tick's work. `withSessionCapture` tees
      // the stdout *stream*, never the returned `AgentResult`, so an agent
      // that only returns its line leaves a zero-byte file behind.
      expect(written![0]!.text).toContain("shipped trim-notes-intro");
      // Under the state root, not under the worktree the singleton ticked in
      // — `<flumeDir>/worktrees/` is git's to remove.
      expect(existsSync(join(flumeDir, "worktrees", "sessions"))).toBe(false);
    } finally {
      await fx.cleanup();
    }
  });

  it("a relocated flumeDir moves the backlog groomer's session capture with it", async () => {
    const fx = await makeFixture();
    // A relocated state root is expected to live outside the working tree
    // (spec/chain.md, same section), so this one is a sibling temp dir.
    const relocated = mkTempDirSync("flume-relocated-");
    try {
      await seedBacklog(fx.repo);

      await groomTick(fx, relocated);

      const moved = captures(relocated);
      expect(moved ?? []).toHaveLength(1);
      expect(moved![0]!.text).toContain("shipped trim-notes-intro");
      // Not a copy in both places, and no `?? CHAIN_DIR`-shaped fallback to
      // the default root: `<repoRoot>/.flume` holds no capture at all.
      expect(captures(join(fx.repo, ".flume"))).toBeUndefined();
    } finally {
      rmSync(relocated, { recursive: true, force: true });
      await fx.cleanup();
    }
  });
});

/**
 * `.claude/rules/engineering.md`, *Loud or nothing* — the groomer's `reason`
 * is interpolated into `SHIPPED.md`'s ledger line (`- <tag>: <reason>`), and
 * the same chain reads that file back line by line to learn which tags have
 * shipped. Bounded by length alone, a `reason` carrying a newline writes a
 * second line the reader takes for a ledger entry: a shipped tag nothing
 * shipped, silently unblocking a `blockedBy` backlog item on the next tick.
 *
 * Driven through the chain object's own `entryExtension` — the declaration
 * the engine composes and the agent parses against — and then through the
 * real agent, so writer and reader are the shipped ones rather than a
 * fixture's restatement of them (*A seam gate reads what the real writer
 * wrote*).
 */
describe("backlog-groomer-chain.ts — the reason is one line", () => {
  const api = buildFlumeApi(EXAMPLE_PATHS);

  /** One backlog item carrying `reason`, serialized the way `BACKLOG.json` holds it. */
  const backlogWith = (reason: string): string =>
    `${JSON.stringify(
      [
        {
          tag: "trim-notes-intro",
          gate: { kind: "open" },
          dependsOnForks: [],
          files: { edit: [{ path: "README.md", description: "trim the intro" }] },
          reason,
        },
      ],
      null,
      2,
    )}\n`;

  /**
   * A reason whose tail is shaped exactly like the ledger line the chain
   * writes — the forgery the bound exists to refuse.
   */
  const FORGED = "unblocks the rest\n- blocking-item: shipped by nobody";

  it("the backlog groomer's entry extension refuses a multi-line reason", () => {
    const extension = backlogGroomerChain.entryExtension;
    // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
    // non-vacuous"): an absent extension parses both bodies identically, and
    // the refusal below would be judging core-field validation.
    expect(Object.keys(extension ?? {})).toContain("reason");

    // Direction: the same entry with the newline removed is accepted, so the
    // refusal is the line break's doing and not the fixture's shape.
    // The backlog is this chain's own array in one file, so the entry
    // validator is what judges each element — the same shape the chain's own
    // backlog parse composes (`examples/backlog-groomer-chain.ts`).
    const entrySchema = api.composePendingEntry(extension);
    const entryWith = (reason: string): unknown =>
      (JSON.parse(backlogWith(reason)) as unknown[])[0];

    const accepted = entrySchema.safeParse(
      entryWith(FORGED.replace("\n", " ")),
    );
    expect(accepted.success).toBe(true);

    const refused = entrySchema.safeParse(entryWith(FORGED));
    expect(refused.success).toBe(false);
    expect(
      refused.error?.issues.map((issue) => issue.path.join(".")),
    ).toContain("reason");
  });

  it("a newline in a reason never reaches the groomer's shipped ledger", async () => {
    const repo = mkTempDirSync("groomer-reason-");
    try {
      // A real repo, because the groomer commits what it wrote: without one
      // an unbounded `reason` fails at `git add` *after* forging the ledger
      // line, which is the wrong failure for this claim to rest on.
      await exec("git", ["init", "-q"], { cwd: repo });
      await exec("git", ["config", "user.email", "groom@example.test"], { cwd: repo });
      await exec("git", ["config", "user.name", "Groom Fixture"], { cwd: repo });
      // The chain's session capture resolves against the flumeDir its factory
      // was handed, so it is pointed at this temp root rather than the
      // checkout's state dir.
      const { chain } = backlogGroomerFactory(
        buildFlumeApi({
          repoRoot: repo,
          configDir: EXAMPLE_PATHS.configDir,
          flumeDir: join(repo, ".flume"),
        }),
      );
      writeFileSync(join(repo, "BACKLOG.json"), backlogWith(FORGED));

      const groom = chain.phases.find((p) => p.name === "groom");
      expect(groom).toBeDefined();
      const result = await groom!.agent!.invoke({ cwd: repo, prompt: "" });

      // The agent refuses at parse: nonzero, saying which field, and no
      // ledger line written at all. A silent degradation here would be
      // exit 0 with a SHIPPED.md carrying two tag-shaped lines.
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("reason");
      expect(existsSync(join(repo, "SHIPPED.md"))).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
