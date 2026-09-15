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
 */

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Gate, GateContext } from "../src/Gate.ts";
import type { Chain, Phase, TickContext, TickResult } from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import type { PriorAttempt } from "../src/Prompt.ts";
import { renderPrompt } from "../src/Prompt.ts";
import { Baton } from "../src/Baton.ts";
import { Dispatcher, type TickOutcome } from "../src/Dispatcher.ts";
import { resolvePendingPath } from "../src/paths.ts";
import {
  buildFlumeApi,
  type FlumeApi,
  type FlumePaths,
} from "../src/flumeApi.ts";
import { makeFixture, silent, type Fixture } from "./helpers/dispatcherFixture.ts";
import backlogGroomerFactory from "../examples/backlog-groomer-chain.ts";
import cascadeFactory, {
  declaredFilesGate,
} from "../examples/cascade-chain.ts";
import minimalFactory from "../examples/minimal-chain.ts";

const exec = promisify(execFile);

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
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // the lookups below would every() over nothing if the list were empty,
    // and would silently miss a gate if two shared a name.
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
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // an empty phase list would satisfy every absence assertion below.
    expect(cascadeChain.phases.length).toBeGreaterThan(0);
    expect(cascadeChain.phases.map((p) => p.name)).toEqual([
      "plan-inbox",
      "plan-derive",
      "build",
    ]);

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
});

/**
 * Agreement pin (engineering.md, "A seam gate reads what the real writer
 * wrote"): `examples/prompts/` ships the prompt files the example chains
 * name, and `Phase.promptPath` is the only thing that names one. A file left
 * behind after its phase is cut is dead weight a reader takes for a live
 * template — the shape no test caught when `prompts/spec.md` outlived
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
 * affordance, and two of the plan template's spans carry an `|| echo`
 * fallback: a miss renders as "(none)" and the tick plans blind instead of
 * refusing (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * Agreement gate (`engineering.md`, *A seam gate reads what the real writer
 * wrote*): the real reader is the engine's `renderPrompt` over the shipped
 * markdown, handed the root the way a dispatcher hands it — reserved, merged
 * past `args`. The seam under test is the template's rooting and quoting
 * against that substitution, so the state root is awkward in a shell: the
 * engine quotes nothing, and an unquoted `{{FLUME_DIR}}` word-splits on a
 * space and loses a backslash before `sh` ever opens the file. The prompts'
 * per-tick arg vocabulary is a separate claim, pinned below against the real
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
   * The artifacts a template's spans read under the state root. The queue's
   * path is the engine's (`resolvePendingPath`); the rest are this example's
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
  }> = [
    {
      span: "plan/pending.json",
      at: (root) => resolvePendingPath(root),
      body: '{ "entries": [], "note": "PENDING-SENTINEL" }\n',
      sentinel: "PENDING-SENTINEL",
    },
    {
      span: "plan/state.md",
      at: (root) => join(root, "plan", "state.md"),
      body: "phase: PLAN-STATE-SENTINEL\n",
      sentinel: "PLAN-STATE-SENTINEL",
    },
    {
      span: "plan/open-questions.md",
      at: (root) => join(root, "plan", "open-questions.md"),
      body: "## QUESTIONS-SENTINEL\n",
      sentinel: "QUESTIONS-SENTINEL",
    },
    {
      // The inbox span lists rather than reads, so its sentinel is a filename.
      span: "inbox/",
      at: (root) => join(root, "inbox", "INBOX-SENTINEL.md"),
      body: "# a finding\n",
      sentinel: "INBOX-SENTINEL",
    },
  ];

  /** Every scratch dir a case made, torn down together. */
  const scratch: string[] = [];

  /**
   * The cwd a render runs its spans in. The spans not under test still have
   * to resolve — `git log` carries no fallback, and the render aborts on any
   * non-zero span — so this is a real repo with a real commit, rather than
   * this checkout, whose `pnpm tsc` span would typecheck the tree per case.
   */
  let cwd: string;

  beforeAll(async () => {
    cwd = mkdtempSync(join(tmpdir(), "flume-example-prompts-cwd-"));
    scratch.push(cwd);
    writeFileSync(join(cwd, "README.md"), "scratch\n");
    await exec("git", ["init", "-q", "-b", "main"], { cwd });
    await exec("git", ["add", "-A"], { cwd });
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
      { cwd },
    );
  });

  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  /** One shipped template through the engine's real renderer. */
  async function render(file: string, phase: Phase, root: string): Promise<string> {
    const promptFile = join(PROMPT_DIR, file);
    const raw = readFileSync(promptFile, "utf8");
    const args = Object.fromEntries(
      [...raw.matchAll(PLACEHOLDER)]
        .map((m) => m[1]!)
        .filter((key) => key !== "FLUME_DIR")
        .map((key) => [key, `<per-tick ${key}>`]),
    );
    return renderPrompt({ phase, promptFile, cwd, flumeDir: root, args });
  }

  async function everyPromptReadsItsArtifactsUnder(root: string): Promise<void> {
    scratch.push(root);
    for (const artifact of ARTIFACTS) {
      const at = artifact.at(root);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, artifact.body, "utf8");
    }

    let asserted = 0;
    for (const { file, phase } of shipped) {
      expect(phase, `${file} is named by an example phase`).toBeDefined();
      const spans = [...readFileSync(join(PROMPT_DIR, file), "utf8").matchAll(SPAN)]
        .map((m) => m[1]!);
      const reads = ARTIFACTS.filter((a) => spans.some((s) => s.includes(a.span)));
      if (reads.length === 0) continue;

      const rendered = await render(file, phase!, root);
      for (const artifact of reads) {
        asserted++;
        expect({
          file,
          span: artifact.span,
          read: rendered.includes(artifact.sentinel),
        }).toEqual({ file, span: artifact.span, read: true });
      }
    }

    // Non-vacuity (`engineering.md`, *A green verdict is proven non-vacuous*):
    // a prompt set whose spans stopped naming these artifacts would pass the
    // loop over nothing.
    expect(asserted).toBeGreaterThan(0);
  }

  it("every example prompt's spans read their artifacts under a state root path carrying a space", async () => {
    const root = mkdtempSync(join(tmpdir(), "flume example prompts space-"));
    expect(root).toContain(" ");

    await everyPromptReadsItsArtifactsUnder(root);
  });

  it("every example prompt's spans read their artifacts under a state root path carrying a backslash", async () => {
    const base = mkdtempSync(join(tmpdir(), "flume-example-prompts-backslash-"));
    scratch.push(base);
    // On win32 the separator *is* the backslash, so every state root there is
    // this case. Elsewhere a backslash is an ordinary filename byte, and the
    // same byte reaches `sh`.
    const root = process.platform === "win32" ? base : join(base, "back\\slash");
    mkdirSync(root, { recursive: true });
    expect(root).toContain("\\");

    await everyPromptReadsItsArtifactsUnder(root);
  });

  it("no span in a shipped example prompt names a literal .flume/ path", () => {
    const spans = shipped.flatMap(({ file }) =>
      [...readFileSync(join(PROMPT_DIR, file), "utf8").matchAll(SPAN)].map((m) => ({
        file,
        cmd: m[1]!,
      })),
    );
    // Non-vacuity: a prompt set with no spans at all satisfies the absence.
    expect(spans.length).toBeGreaterThan(0);

    expect(spans.filter((s) => s.cmd.includes(".flume/"))).toEqual([]);
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
 * `flume job run` wakes `phases[0]` unconditionally on a cold job (v0.5
 * decision 6, `src/job.ts` `jobRun`) — it has no notion of `humanOnly` at
 * that call site. A chain whose entry phase is also in its own `humanOnly`
 * list declares a job that can never cold-start on its own machinery; a
 * human has to intervene on tick one, every time. Every chain under
 * `examples/` is a "read this to learn the shape" artifact (v0.1 §7 /
 * v0.8 §7), so this pins the entry-phase/humanOnly relationship across all
 * of them, not just cascade.
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
 * v0.8 §6 / engineering.md "The fix lands at the mechanism" — the flagship
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
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // an undeclared hook, or an empty `pickable`, would make the decline
    // below assert nothing about a predicate that read the queue.
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
    flumeDir = join(mkdtempSync(join(tmpdir(), "cascade-ladder-")), ".flume");
    mkdirSync(join(flumeDir, "inbox"), { recursive: true });
  });

  afterEach(() => {
    rmSync(flumeDir, { recursive: true, force: true });
  });

  const openEntry: PendingEntry = {
    tag: "PICKABLE",
    gate: { kind: "open" },
    dependsOnForks: [],
    files: { new: [], edit: [], retire: [] },
  };

  const after = (over: Partial<TickResult>): TickResult => ({
    phaseName: "build",
    committed: true,
    gateResults: [],
    pendingAfter: [],
    pickableAfter: [],
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
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // a single-slice plan, or a chain that lost `build`, would satisfy every
    // routing claim below over a ladder with nothing to order.
    expect(
      planSlices.length,
      "cascade's plan is a ladder — one slice orders nothing",
    ).toBeGreaterThan(1);
    expect(buildPhase, "cascade declares a build phase").toBeDefined();
    expect(cascadeChain.phases.map((p) => p.name)).toEqual([
      ...planSlices.map((p) => p.name),
      buildPhase!.name,
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
   * The module-scope `EXAMPLE_PATHS` build is this checkout's roots, which
   * the pure shape reads above may hold because they tick nothing. Handing
   * it to a dispatcher driving a temp fixture puts the two halves of one
   * seam on two different repos (`engineering.md`, *A seam gate reads what
   * the real writer wrote*): the first chain to resolve state from
   * `api.paths` would reach into the working tree the suite runs from, and
   * every leg below would still be green.
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
      mkdirSync(join(flumeDir, "plan"), { recursive: true });
      writeFileSync(report, "# a report from the field\n");
      writeFileSync(join(flumeDir, "plan", "pending.json"), "[]\n");
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
      // dispatcher's own roots, by identity — one object, not two that agree
      // today.
      expect(l.api.paths).toBe(l.paths);
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
      const outcome = await l.tick(l.chain.phases[0]!.name, commitsNothing);
      expect(outcome.result?.flumeDir).toBe(l.paths.flumeDir);
      expect(outcome.result?.flumeDir).not.toBe(EXAMPLE_PATHS.flumeDir);
    } finally {
      await l.fx.cleanup();
    }
  }, 30_000);

  it("cascade's plan ladder routes the baton from a TickResult the dispatcher produced", async () => {
    const l = await ladderDrive();
    try {
      const { report, tick } = l;
      const { flumeDir } = l.paths;
      const planSlices = l.chain.phases.filter((p) => p.name !== "build");
      const buildPhase = l.chain.phases.find((p) => p.name === "build");
      // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
      // a one-slice plan, or a chain that lost `build`, would satisfy the
      // routing below over a ladder with nothing to order.
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
          writeFileSync(
            join(cwd, ".flume", "plan", "pending.json"),
            `${JSON.stringify([filedEntry], null, 2)}\n`,
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
  }, 30_000);
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
 * test re-composes (`engineering.md`, *A seam gate reads what the real writer
 * wrote*): the stub suite enters through a doctored `api.shellGate`, so the
 * composition under test — wrapper, options, placement — is the one cascade
 * hands `build`. The reporter payload stays hand-authored, which the same
 * section's carve-out allows: a real vitest run cannot be made to emit "a
 * named behavior with no passing test" on demand.
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
    pendingPath: "/repo/.flume/plan/pending.json",
    phaseName: "build",
    commitSha: "c".repeat(40),
    baseSha: "b".repeat(40),
    touchedPaths: [],
    entry: {
      tag: "NAMED-BEHAVIOR",
      gate: { kind: "open" },
      dependsOnForks: [],
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

    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // the same gate over the same report passes the entry that names the
    // behavior the report carries. Without this the refusals below would hold
    // just as well for a gate that refuses everything, or one whose judged set
    // is empty because `tests[]` never reached it.
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
 * hand-authored input (`engineering.md`, *A seam gate reads what the real
 * writer wrote*). The stub records the refs it was asked for, which is how
 * the "reads the span's base sha off the context" half is pinned rather than
 * assumed — the fixture's `repoRoot` names a directory that does not exist,
 * so a gate that shelled git itself would throw instead.
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
    pendingPath: "/nonexistent/declared-files-fixture/.flume/plan/pending.json",
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

    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // a gate handed no entry, or one whose declared paths never reached the
    // judge, would return the same `ok: true` over nothing. The verdict names
    // the entry it gated and the count it judged, and the reader was asked
    // about every declared path at both ends of the span.
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
 * Agreement pin (engineering.md, *A seam gate reads what the real writer
 * wrote*): the shipped prompt template is read off disk and both phases' real
 * `promptArgs` run, so a second sentence hand-written into either surface
 * fails here rather than drifting quietly. The fixture's roots name a
 * directory that does not exist — neither builder may reach disk for this.
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
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // an undeclared builder on either phase would leave every claim below
    // asserted over nothing.
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
   * built from the same `FlumePaths` object the `Dispatcher` is spread from,
   * so `api.paths.flumeDir` is the root the engine resolved, by identity —
   * neither half can agree with itself (`engineering.md`, *A seam gate reads
   * what the real writer wrote*). `configDir` is the shipped `examples/`, so
   * `Phase.promptPath` finds the committed prompt rather than a copy.
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
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // a declined or failed tick produced no stdout at all, and every capture
    // assertion below would be judging the absence of a tick, not a
    // placement.
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
  }, 30_000);

  it("a relocated flumeDir moves the backlog groomer's session capture with it", async () => {
    const fx = await makeFixture();
    // A relocated state root is expected to live outside the working tree
    // (spec/chain.md, same section), so this one is a sibling temp dir.
    const relocated = mkdtempSync(join(tmpdir(), "flume-relocated-"));
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
  }, 30_000);
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
    // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
    // an absent extension parses both bodies identically, and the refusal
    // below would be judging core-field validation.
    expect(Object.keys(extension ?? {})).toContain("reason");

    // Direction: the same entry with the newline removed is accepted, so the
    // refusal is the line break's doing and not the fixture's shape.
    const accepted = api.parsePending(
      backlogWith(FORGED.replace("\n", " ")),
      extension,
    );
    expect(accepted.errors).toEqual([]);
    expect(accepted.entries).toHaveLength(1);

    const refused = api.parsePending(backlogWith(FORGED), extension);
    expect(refused.ok).toBe(false);
    expect(refused.errors.map((e) => e.path)).toContain("reason");
  });

  it("a newline in a reason never reaches the groomer's SHIPPED.md", async () => {
    const repo = mkdtempSync(join(tmpdir(), "groomer-reason-"));
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
