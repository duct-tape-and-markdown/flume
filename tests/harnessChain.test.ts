/**
 * The harness package's chain factory (`spec/harness.md`, *The phases*): the
 * phase set one declaration produces, the fence and prompt each phase
 * carries, and the handoff each one runs.
 *
 * Every case drives the **real factory over a real declaration**, parsed by
 * the package's own schema rather than cast into shape — a chain wired from
 * a shape no consumer could have written would prove nothing about the
 * adoption path this factory exists to be.
 *
 * The rendering case is an agreement gate (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the real writer is each
 * returned phase's own `promptArgs` over a real `TickContext`, and the real
 * reader is the engine's `renderPrompt` over the markdown the package ships.
 * A hand-authored arg map would re-author, by the tester's hand, exactly the
 * seam that breaks when a prompt grows a placeholder the factory forgot — so
 * the fixture is a real git repository with a real state root under it, and
 * the windows read it with git.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

import { afterAll, beforeAll, expect, it } from "vitest";

import { harnessChain } from "../harness/chain.ts";
import {
  BUILD_PHASE,
  PHASES,
  PLAN_SLICES,
  parseDeclaration,
  type HarnessPhase,
} from "../harness/declaration.ts";
import { defaultHandoff, type Handoff } from "../harness/handoff.ts";
import { consumerIgnores } from "../harness/ignores.ts";
import { promptPath, type PromptName } from "../harness/prompts.ts";
import { notesDir } from "../harness/records.ts";
import type { Runner } from "../harness/runner.ts";
import { planSliceWindows } from "../harness/windows.ts";
import { buildFlumeApi, type FlumeApi } from "../src/flumeApi.ts";
import type { Chain, Phase, TickContext, TickResult } from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import { renderPrompt } from "../src/Prompt.ts";

/** The engine's own placeholder grammar, as the renderer spells it. */
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** The state root every case addresses, repo-relative. */
const STATE_ROOT = ".flume";

/** The section every fixture entry cites, and the file that holds it. */
const CITE = { path: "spec/harness.md", section: "The phases" };

/**
 * A runner the declaration's structural check accepts. No case here rules on
 * a named line — that is `tests/harnessJudge.test.ts`'s subject — so this
 * never runs.
 */
const runner = {
  run: async () => {
    throw new Error("no case in this file judges a named line");
  },
  runAtBase: async () => {
    throw new Error("no case in this file judges a named line");
  },
  lanes: [],
} as unknown as Runner;

/** The declaration every case starts from — a shape a consumer could write. */
const DECLARATION = {
  specLocus: ["spec/**"],
  fence: {
    build: ["src/**", "tests/**"],
    "plan-derive": [`${STATE_ROOT}/scratch/**`],
  },
  runner,
  slices: {
    enabled: [...PLAN_SLICES],
    sweep: { domain: ["src/**"], posturePages: ["rules/**"] },
  },
  supervisor: { maxParallel: 2, abortThreshold: 5, quarantineScope: "run" },
};

/** The fixture repository, its state root, and the API a factory is handed. */
let repo: string;
let flumeDir: string;
let api: FlumeApi;
/** The sha the plan cursors name — one commit behind the tip. */
let cursor: string;

const git = (args: string[]): string =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "flume-harness-chain-"));
  flumeDir = join(repo, STATE_ROOT);

  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "commit.gpgsign", "false"]);

  await mkdir(join(repo, "spec"), { recursive: true });
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "rules"), { recursive: true });
  await mkdir(join(flumeDir, "plan"), { recursive: true });

  await writeFile(
    join(repo, CITE.path),
    `# The harness package\n\n### ${CITE.section}\n\nThree plan slices and one fanout build phase.\n`,
  );
  await writeFile(join(repo, "src", "index.ts"), "export const seed = 1;\n");
  await writeFile(join(repo, "rules", "posture.md"), "# Posture\n");
  await writeFile(join(flumeDir, "plan", "pending.json"), "[]\n");
  await writeFile(
    join(flumeDir, "plan", "open-questions.md"),
    "# Open Questions\n\n## A parked fork\n\nContext.\n",
  );
  git(["add", "-A"]);
  git(["commit", "-qm", "seed"]);
  cursor = git(["rev-parse", "HEAD"]);

  // A second commit past the cursor, so the derive and sweep windows render
  // real material rather than an empty range.
  await writeFile(
    join(repo, CITE.path),
    `# The harness package\n\n### ${CITE.section}\n\nThree plan slices, one job each, and one fanout build phase.\n`,
  );
  git(["add", "-A"]);
  git(["commit", "-qm", "spec: reword the phases"]);

  // Written after the commits because its fields name them. The windows read
  // the artifact off disk, which is where a plan slice writes it.
  await writeFile(
    join(flumeDir, "plan", "state.json"),
    `${JSON.stringify(
      { derivedThrough: cursor, sweptThrough: cursor, rotation: { kind: "closed" } },
      null,
      2,
    )}\n`,
  );

  api = buildFlumeApi({ repoRoot: repo, configDir: flumeDir, flumeDir });
});

afterAll(async () => {
  if (repo) await rm(repo, { recursive: true, force: true });
});

/** The chain the factory returns for a declaration, `DECLARATION` by default. */
const chainFor = (declaration: unknown = DECLARATION): Chain =>
  harnessChain({ api, declaration });

/** One phase by name, or a failure naming what the chain actually carried. */
function phaseNamed(chain: Chain, name: string): Phase {
  const phase = chain.phases.find((candidate) => candidate.name === name);
  if (phase === undefined) {
    throw new Error(
      `no phase named ${name}; the chain carries ${chain.phases
        .map((p) => p.name)
        .join(", ")}`,
    );
  }
  return phase;
}

/** One queue entry, citing the section the fixture's spec file holds. */
const entry = (tag: string): PendingEntry => ({
  tag,
  gate: { kind: "open" },
  dependsOnForks: [],
  files: { new: [], edit: [{ path: "src/index.ts", description: "the seed" }], retire: [] },
  summary: "one line",
  per: CITE,
  acceptance: "the suite is green",
  tests: ["a behavior this entry introduces"],
  pins: [],
});

/** The context a tick of `phase` is handed, as the dispatcher builds one. */
function tickContext(phase: Phase): TickContext {
  return {
    cwd: repo,
    flumeDir,
    pending: [entry("SOME-ENTRY")],
    pickable: [],
    priorAttempts: new Map(),
    stateRootRel: STATE_ROOT,
    ...(phase.concurrency === "fanout"
      ? { assignedEntry: entry("SOME-ENTRY") }
      : {}),
  };
}

function tickResult(overrides: Partial<TickResult> = {}): TickResult {
  return {
    phaseName: BUILD_PHASE,
    committed: true,
    gateResults: [],
    pendingAfter: [],
    pickableAfter: [],
    flumeDir,
    configDir: flumeDir,
    shippedTags: [],
    revertedTags: [],
    ...overrides,
  };
}

it("the factory returns the three plan slices and the build phase from a declaration", () => {
  // Non-vacuity: the package's own phase list is what the expectation is
  // read from, so a list that collapsed would make the assertion trivial.
  expect(PHASES.length).toBe(4);

  const chain = chainFor();

  expect(chain.phases.map((phase) => phase.name)).toEqual([
    ...PLAN_SLICES,
    BUILD_PHASE,
  ]);
  expect(
    chain.phases.map((phase) => [phase.name, phase.concurrency]),
  ).toEqual([
    ...PLAN_SLICES.map((name) => [name, "singleton"]),
    [BUILD_PHASE, "fanout"],
  ]);
  // Each phase is complete enough for a tick: a description, gates, and a
  // handoff are what the dispatcher reads before it renders anything.
  for (const phase of chain.phases) {
    expect({
      name: phase.name,
      described: phase.description.length > 0,
      gated: phase.gates.length > 0,
      agent: phase.agent !== undefined,
    }).toEqual({ name: phase.name, described: true, gated: true, agent: true });
  }
  // The package's six entry fields ride the chain, so the queue is validated
  // and the plan prompt's schema block rendered from one declaration.
  expect(Object.keys(chain.entryExtension ?? {})).toContain("per");
});

it("every phase's agent tees its transcript into a path the consumer ignore set names", () => {
  // An agreement gate over the package's own per-run artifact
  // (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
  // wrote*): the real writer is the factory's own agent wiring, and the real
  // reader is `consumerIgnores` over the state root this fixture declares.
  // A capture relocated on one side alone leaves every transcript untracked
  // under a consumer's state root, which the clean-tree gate reads as a
  // dirty tree on whatever tick runs next.
  const captured: string[] = [];
  const chain = harnessChain({
    api: {
      ...api,
      withSessionCapture: (agent, options) => {
        captured.push(options.dir);
        return api.withSessionCapture(agent, options);
      },
    },
    declaration: DECLARATION,
  });

  // Vacuity pin: one capture per phase the factory wired, so a chain that
  // wrapped nothing cannot satisfy the loop below.
  expect(captured).toHaveLength(chain.phases.length);
  expect(chain.phases.length).toBeGreaterThan(0);

  const ignored = new Set(consumerIgnores(STATE_ROOT));
  for (const dir of captured) {
    expect(ignored).toContain(`${relative(repo, dir).split(sep).join("/")}/`);
  }
});

it("a plan slice the declaration does not enable is absent from the returned chain", () => {
  // The control: the same declaration with every slice enabled carries it.
  expect(chainFor().phases.map((phase) => phase.name)).toContain("plan-sweep");

  const withoutSweep = chainFor({
    ...DECLARATION,
    slices: { enabled: ["plan-inbox", "plan-derive"] },
  });

  expect(withoutSweep.phases.map((phase) => phase.name)).toEqual([
    "plan-inbox",
    "plan-derive",
    BUILD_PHASE,
  ]);
  // Absent, not present-and-permanently-closed: the ladder reads the list it
  // is given, and a slice that can never run reads as a phase the chain
  // carries but nothing wakes.
  expect(() => phaseNamed(withoutSweep, "plan-sweep")).toThrow(/no phase named/);
});

it("the returned build phase is fanout and carries the declaration's fence", () => {
  const build = phaseNamed(chainFor(), BUILD_PHASE);
  const noteGlob = `${notesDir(STATE_ROOT)}/*.md`;

  // Non-vacuity: the declared fence is what the containment below is read
  // against, so an empty one would assert nothing.
  expect(DECLARATION.fence.build.length).toBeGreaterThan(0);

  expect(build.concurrency).toBe("fanout");
  for (const glob of DECLARATION.fence.build) {
    expect({ glob, fenced: build.writablePaths.includes(glob) }).toEqual({
      glob,
      fenced: true,
    });
  }
  // Beside the consumer's fence, the package's own channel: the note a tick
  // parks into is the package's path, never a glob every consumer copies.
  expect(build.writablePaths).toContain(noteGlob);
  // The channel is declared only where a tick consults it — a scoped tick,
  // whose allowance narrows to the entry's files. On an unscoped phase a
  // declared channel is dead, and the engine refuses the chain at load.
  expect(build.entryChannelPaths).toBeUndefined();
  const scoped = phaseNamed(chainFor({ ...DECLARATION, scopeWritesToEntry: true }), BUILD_PHASE);
  expect(scoped.scopeWritesToEntry).toBe(true);
  expect(scoped.entryChannelPaths).toContain(noteGlob);

  // And the fence is build's alone — a plan slice writes plan artifacts and
  // whatever that slice declared, never build's paths.
  const derive = phaseNamed(chainFor(), "plan-derive");
  for (const glob of DECLARATION.fence.build) {
    expect({ glob, fenced: derive.writablePaths.includes(glob) }).toEqual({
      glob,
      fenced: false,
    });
  }
  expect(derive.writablePaths).toContain(`${STATE_ROOT}/plan/pending.json`);
  expect(derive.writablePaths).toContain(DECLARATION.fence["plan-derive"][0]);
});

it("each returned phase names its prompt by an absolute path the package ships", () => {
  const chain = chainFor();
  expect(chain.phases.length).toBeGreaterThan(0);

  for (const phase of chain.phases) {
    // Resolved from the package's own location, not from any cwd: that is
    // what lets a consumer's state root reach the same bytes this repo does.
    expect({
      name: phase.name,
      address: phase.promptPath,
      absolute: isAbsolute(phase.promptPath),
      shipped: existsSync(phase.promptPath),
    }).toEqual({
      name: phase.name,
      address: promptPath(phase.name as PromptName),
      absolute: true,
      shipped: true,
    });
  }
});

it("the factory passes the declared supervisor policy to the chain whole", () => {
  // Non-vacuity: a policy with no knob in it would make the equality below
  // hold over nothing.
  expect(Object.keys(DECLARATION.supervisor).length).toBeGreaterThan(0);

  expect(chainFor().supervisorPolicy).toEqual(DECLARATION.supervisor);

  // Undeclared stays undeclared: an omitted knob falls through to the
  // engine's own default rather than to a value this factory chose.
  const { supervisor: _omitted, ...withoutPolicy } = DECLARATION;
  expect(chainFor(withoutPolicy).supervisorPolicy).toBeUndefined();
});

it("every placeholder the package's prompts name is supplied by the phase the factory returns for it", async () => {
  const chain = chainFor();
  expect(chain.phases.length).toBeGreaterThan(0);

  for (const phase of chain.phases) {
    const ctx = tickContext(phase);
    // The real writer: the phase's own `promptArgs`, with nothing added by
    // hand. The real reader: the engine's renderer, which refuses a prompt
    // naming an arg nothing supplied.
    const args = phase.promptArgs?.(ctx) ?? {};
    const rendered = await renderPrompt({
      phase,
      promptFile: phase.promptPath,
      cwd: ctx.cwd,
      flumeDir: ctx.flumeDir,
      args,
      ...(ctx.assignedEntry ? { assignedEntry: ctx.assignedEntry } : {}),
    });

    expect({
      name: phase.name,
      unresolved: [...rendered.matchAll(PLACEHOLDER)].map((match) => match[0]),
      empty: rendered.trim().length === 0,
    }).toEqual({ name: phase.name, unresolved: [], empty: false });
  }
});

it("each returned phase runs the handoff the declaration names for it, else the package's default", () => {
  const declared: Handoff = () => ["a-phase-the-package-never-names"];
  const chain = chainFor({ ...DECLARATION, handoff: { build: declared } });
  const result = tickResult({ phaseName: BUILD_PHASE });

  // The declared one replaces outright for the phase it names.
  expect(phaseNamed(chain, BUILD_PHASE).handoff(result)).toEqual([
    "a-phase-the-package-never-names",
  ]);

  // Control: without the declaration, the same result takes the package's
  // own ladder — so the line above is the declaration's doing, not the
  // ladder's answer for this fixture.
  const fallback = defaultHandoff(
    planSliceWindows({
      // Through the package's own parse, so the control ladder and the
      // factory's read one schema rather than two.
      declaration: parseDeclaration(DECLARATION),
      repoRoot: repo,
    }),
  );
  expect(phaseNamed(chainFor(), BUILD_PHASE).handoff(result)).toEqual(
    fallback(result),
  );

  // And overriding one phase leaves every other on the package's default —
  // which is the whole point of declaring per phase rather than wholesale.
  const slices: HarnessPhase[] = [...PLAN_SLICES];
  expect(slices.length).toBeGreaterThan(0);
  for (const name of slices) {
    const sliceResult = tickResult({ phaseName: name, committed: true });
    expect({ name, woke: phaseNamed(chain, name).handoff(sliceResult) }).toEqual({
      name,
      woke: fallback(sliceResult),
    });
  }
});
