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

import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

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
import { notesDir } from "../harness/layout.ts";
import type { RunnerContext, RunnerFactory } from "../harness/runner.ts";
import { planSliceWindows } from "../harness/windows.ts";
import type { ClaudeCodeOptions } from "../src/Agent.ts";
import { computeStateRootRel } from "../src/Dispatcher.ts";
import { buildFlumeApi, type FlumeApi } from "../src/flumeApi.ts";
import type { Gate, GateContext } from "../src/Gate.ts";
import type {
  Chain,
  Phase,
  ShipContext,
  TickContext,
  TickResult,
} from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import { renderPrompt } from "../src/Prompt.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { stubRunner } from "./helpers/stubRunner.ts";
import { SPAWN_BUDGET_MS, gitOutSync } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/** The engine's own placeholder grammar, as the renderer spells it. */
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** The engine's own inline-exec grammar, as the renderer spells it. */
const INLINE_EXEC = /!\s*`([^`]+)`/;

/**
 * A command no host resolves, and the span quoting it — the shape a queue
 * entry or a spec section carries whenever it documents the grammar itself.
 * Unresolvable on purpose: a span that ran would resolve quietly, so only a
 * command that fails proves the sigil never fired.
 */
const COMMAND = "flume-no-such-command-in-this-tree";
const SPAN = `documented as !\`${COMMAND}\` in the corpus`;

/** The state root every case addresses, repo-relative. */
const STATE_ROOT = ".flume";

/** The section every fixture entry cites, and the file that holds it. */
const CITE = { path: "spec/harness.md", section: "The phases" };

/**
 * The declared runner, as a factory recording the context it was called
 * with. A fresh recorder per declaration, so a case reading it never
 * inherits another's call.
 *
 * What it returns is the shared stand-in: no case here rules on a named line
 * — that is `tests/harnessJudge.test.ts`'s subject — so nothing drives it.
 */
const recordingRunner = (
  seen: RunnerContext[],
): RunnerFactory => (received) => {
  seen.push(received);
  return stubRunner;
};

/** The declaration every case starts from — a shape a consumer could write. */
const DECLARATION = {
  specLocus: ["spec/**"],
  fence: {
    build: ["src/**", "tests/**"],
    "plan-derive": [`${STATE_ROOT}/scratch/**`],
  },
  runner: recordingRunner([]),
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

const git = (args: string[]): string => gitOutSync(repo, args).trim();

beforeAll(async () => {
  repo = await mkTempDir("flume-harness-chain-");
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

/** The facts the dispatcher hands `shipped` for one merged entry. */
function shipContext(
  assigned: PendingEntry,
  touchedPaths: readonly string[],
): ShipContext {
  return {
    entry: assigned,
    mergedSha: "0".repeat(40),
    baseSha: "1".repeat(40),
    touchedPaths,
    gateResults: [],
    worktreePath: join(repo, STATE_ROOT, "worktrees", assigned.tag),
    repoRoot: repo,
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

it("the package refuses a state root resolved outside the repository, naming both roots", () => {
  // Control: the same declaration over a root inside the repository loads,
  // so the refusal below is the relocation's doing and not the fixture's.
  expect(chainFor().phases.length).toBeGreaterThan(0);

  // A sibling of the fixture repo rather than a child of it, and neither
  // path a substring of the other — so "names both roots" below is read off
  // two distinct spans.
  const relocated = join(tmpdir(), "flume-harness-chain-relocated", STATE_ROOT);
  expect(relocated.startsWith(repo)).toBe(false);
  // The shape the engine reports for such a root: no repo-relative path, so
  // the queue, the records and build's park note address nothing a commit
  // holds.
  expect(computeStateRootRel(repo, relocated)).toBeUndefined();

  const load = (): Chain =>
    harnessChain({
      api: buildFlumeApi({
        repoRoot: repo,
        configDir: relocated,
        flumeDir: relocated,
      }),
      declaration: DECLARATION,
    });

  // Refused at load, not degraded into a chain whose gates address nothing.
  expect(load).toThrow(/outside the repository/);

  let message = "";
  try {
    load();
  } catch (error) {
    message = (error as Error).message;
  }
  // Both roots by name: "outside the repository" alone leaves an operator
  // unable to tell which of the two moved.
  expect({ root: message.includes(relocated), repo: message.includes(repo) }).toEqual({
    root: true,
    repo: true,
  });
});

it("the chain calls the runner factory with the api and a provision function", async () => {
  const seen: RunnerContext[] = [];
  const tree = join(repo, "provisioned-by-the-runner-context");
  await mkdir(tree, { recursive: true });

  harnessChain({
    api,
    declaration: {
      ...DECLARATION,
      runner: recordingRunner(seen),
      // A consumer whose provisioning is its own: the reduction the runner
      // is handed has to be this one, not the engine's installer at a root
      // this consumer never installs at.
      setup: { directories: ["."], restore: "touch provisioned" },
    },
  });

  // Once at load, not once per gate run: the judge drives one runner for the
  // life of the chain.
  expect(seen).toHaveLength(1);
  // The identity-same surface, not a copy of it — the runner's base checkout
  // reads this API's state root, and a second one built beside the
  // declaration would resolve none of it
  // (`spec/harness.md`, *The runner interface*).
  expect(seen[0]!.api).toBe(api);

  // And the declared `setup`, already reduced: what the factory is handed
  // provisions a checkout the way this consumer's build worktree is
  // provisioned, so the runner never re-derives the rule from the
  // declaration it cannot see.
  await seen[0]!.provision(tree);
  expect(existsSync(join(tree, "provisioned"))).toBe(true);
});

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

it("the build fence and the park predicate name one note path under a nested state root", () => {
  // A nested state root, as a job namespace produces one: every path the
  // factory composes carries the offset to it, and on win32 the engine
  // reports that offset in the host's own separator. One derivation
  // normalizes it, so the fence glob and the predicate below cannot end up in
  // different alphabets.
  const nested = join(repo, "jobs", "alpha", STATE_ROOT);
  const rel = relative(repo, nested).split(sep).join("/");
  // Non-vacuity: the root is genuinely more than one segment deep, which is
  // the only shape whose dialect can differ at all.
  expect(rel.split("/").length).toBeGreaterThan(1);

  const build = phaseNamed(
    harnessChain({
      api: buildFlumeApi({ repoRoot: repo, configDir: nested, flumeDir: nested }),
      declaration: DECLARATION,
    }),
    BUILD_PHASE,
  );
  const parked = entry("SOME-ENTRY");
  const note = `${notesDir(rel)}/${parked.tag}.md`;

  // The glob that admits the note a tick parks into...
  expect(build.writablePaths).toContain(`${notesDir(rel)}/*.md`);
  // ...and the predicate that reads one back, on the path git would name.
  expect(build.shipped?.(shipContext(parked, [note]))).toBe(false);
  // A tests-only commit is a ship; only the note alone is a park.
  expect(build.shipped?.(shipContext(parked, [note, "src/index.ts"]))).toBe(true);

  // And the queue the plan slices fence is under the same root, in the same
  // alphabet — composed with `node:path`, so it is the one path here that
  // would otherwise arrive re-dialected.
  const derive = phaseNamed(
    harnessChain({
      api: buildFlumeApi({ repoRoot: repo, configDir: nested, flumeDir: nested }),
      declaration: DECLARATION,
    }),
    "plan-derive",
  );
  expect(derive.writablePaths).toContain(`${rel}/plan/pending.json`);
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
}, SPAWN_BUDGET_MS);

it("every prompt-arg key the package's producers return is declared in its phase's promptDataKeys", () => {
  const chain = chainFor();
  expect(chain.phases.length).toBeGreaterThan(0);

  for (const phase of chain.phases) {
    // The real writer again: the keys are read off what `promptArgs`
    // returned for a real tick, never off a list the test spells. A producer
    // that grows a key without its declaration loses neutralization
    // silently, which is exactly what this reads back.
    const keys = Object.keys(phase.promptArgs?.(tickContext(phase)) ?? {});
    const declared = new Set(phase.promptDataKeys ?? []);

    expect({ name: phase.name, produced: keys.length > 0 }).toEqual({
      name: phase.name,
      produced: true,
    });
    expect({
      name: phase.name,
      undeclared: keys.filter((key) => !declared.has(key)),
    }).toEqual({ name: phase.name, undeclared: [] });
  }
});

it("a substituted value carrying an inline-exec span reaches the agent inert", async () => {
  const build = phaseNamed(chainFor(), BUILD_PHASE);
  const spanned: PendingEntry = {
    ...entry("SPANNED-ENTRY"),
    summary: `one line ${SPAN}`,
  };
  const raw = JSON.stringify(spanned, null, 2);
  // Vacuity: the entry really carries the grammar the engine scans for, so
  // the render below is proving something about a live span.
  expect(raw).toMatch(INLINE_EXEC);

  const ctx: TickContext = {
    ...tickContext(build),
    pending: [spanned],
    assignedEntry: spanned,
  };
  const args = build.promptArgs?.(ctx) ?? {};
  const render = (phase: Phase, overrides: Record<string, string> = {}) =>
    renderPrompt({
      phase,
      promptFile: build.promptPath,
      cwd: repo,
      flumeDir,
      args: { ...args, ...overrides },
      assignedEntry: spanned,
    });

  // The control, hand-authored because no real writer produces an
  // undeclared span (`.claude/rules/engineering.md`, *A seam gate reads what
  // the real writer wrote*): the same bytes through a phase that declares
  // nothing refuse the tick, so the scan this phase escapes is live.
  const { promptDataKeys: _undeclared, ...passThrough } = build;
  await expect(render(passThrough, { ENTRY_JSON: raw })).rejects.toThrow(
    /inline-exec/,
  );

  // And through the phase the factory returned, the same value renders: the
  // command text reaches the agent, and no span the engine would scan does.
  const rendered = await render(build);
  expect(rendered).toContain(COMMAND);
  expect(rendered).not.toMatch(new RegExp(`!\\s*\`${COMMAND}`));
}, SPAWN_BUDGET_MS);

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

it("the package's judge runs after a consumer's declared gates at the same when", () => {
  // Both points, so the claim is about ordering within a `when` rather than
  // about which point a gate hangs on.
  const declared = {
    afterCommit: "pnpm tsc --noEmit",
    afterMerge: "pnpm tsc --noEmit --project tsconfig.build.json",
  } as const;
  const chain = chainFor({
    ...DECLARATION,
    runner: recordingRunner([]),
    gates: {
      build: [
        { kind: "shell", command: declared.afterCommit, when: "afterCommit" },
        { kind: "shell", command: declared.afterMerge, when: "afterMerge" },
      ],
    },
  });

  const build = phaseNamed(chain, BUILD_PHASE);
  const at = (when: string): string[] =>
    build.gates.filter((gate) => gate.when === when).map((gate) => gate.name);

  // Vacuity pin: an ordering claim over a set holding neither side is green
  // over nothing.
  expect({
    judge: build.gates.some((gate) => gate.name === "named lines"),
    declaredCommit: at("afterCommit").includes(declared.afterCommit),
    declaredMerge: at("afterMerge").includes(declared.afterMerge),
  }).toEqual({ judge: true, declaredCommit: true, declaredMerge: true });

  // The judge runs the consumer's suite — twice for a red line — so a
  // seconds-long typecheck declared at the same point reports its refusal
  // ahead of it, not behind it.
  const afterMerge = at("afterMerge");
  expect(afterMerge.indexOf(declared.afterMerge)).toBeLessThan(
    afterMerge.indexOf("named lines"),
  );

  // And the four discipline gates still lead every phase's set, the
  // consumer's declaration notwithstanding.
  const DISCIPLINE = ["records", "clean-tree", "pending-gate", "per cites resolve"];
  expect(chain.phases.length).toBeGreaterThan(0);
  for (const phase of chain.phases) {
    expect([phase.name, phase.gates.slice(0, 4).map((gate) => gate.name)]).toEqual([
      phase.name,
      DISCIPLINE,
    ]);
  }
  // Nothing of the package's trails into the consumer's own point either:
  // build's afterCommit set is the four, then the declared typecheck, and
  // the judge hangs on afterMerge alone.
  expect(at("afterCommit")).toEqual([...DISCIPLINE, declared.afterCommit]);
});

it("a declared agents inheritUserMcp reaches the phase's claudeCode options", () => {
  // The engine owns the knob and its default; the declaration is the only
  // spelling a consumer has for it, because the `agents` schema is strict —
  // an undeclared field is refused at load rather than carried through. So
  // the claim is a pass-through one, read off the real factory's calls into
  // the real engine surface.
  //
  // Each phase declares its own model, which is what links a captured call
  // back to the phase that asked for it without leaning on call order.
  const models: Record<HarnessPhase, string> = {
    build: "claude-opus-5",
    "plan-inbox": "claude-sonnet-5",
    "plan-derive": "claude-haiku-4-5-20251001",
    "plan-sweep": "claude-fable-5-1",
  };
  const captured: ClaudeCodeOptions[] = [];
  const chain = harnessChain({
    api: {
      ...api,
      claudeCode: (opts) => {
        captured.push(opts ?? {});
        return api.claudeCode(opts);
      },
    },
    declaration: {
      ...DECLARATION,
      runner: recordingRunner([]),
      agents: Object.fromEntries(
        PHASES.map((phase) => [
          phase,
          {
            model: models[phase],
            ...(phase === BUILD_PHASE ? { inheritUserMcp: true } : {}),
          },
        ]),
      ),
    },
  });

  // Vacuity pin: one call per phase the factory wired, so a chain that built
  // no agent at all cannot satisfy the assertions below.
  expect(captured).toHaveLength(chain.phases.length);
  expect(chain.phases.length).toBeGreaterThan(0);

  const optionsFor = (phase: HarnessPhase): ClaudeCodeOptions => {
    const found = captured.find((opts) => opts.model === models[phase]);
    if (found === undefined) {
      throw new Error(
        `no claudeCode call carried ${phase}'s model; captured ${captured
          .map((opts) => String(opts.model))
          .join(", ")}`,
      );
    }
    return found;
  };

  // The phase that declared it gets it; every other phase is left on the
  // engine's own default rather than handed a `false` the package invented.
  expect(optionsFor(BUILD_PHASE).inheritUserMcp).toBe(true);
  for (const phase of PLAN_SLICES) {
    expect([phase, "inheritUserMcp" in optionsFor(phase)]).toEqual([phase, false]);
  }
});

/** The context a gate is handed, as the dispatcher builds one, over `cwd`. */
function gateContext(cwd: string): GateContext {
  return {
    cwd,
    repoRoot: repo,
    flumeDir,
    stateRootRel: computeStateRootRel(repo, flumeDir),
    pendingPath: join(flumeDir, "plan", "pending.json"),
    configDir: flumeDir,
    phaseName: BUILD_PHASE,
    commitSha: "0".repeat(40),
    baseSha: "1".repeat(40),
    touchedPaths: [],
    log: () => {},
  };
}

it("a declaration with no setup leaves every returned phase without a setupWorktree hook", () => {
  // Non-vacuity: the base declaration genuinely says nothing about setup, so
  // the absence below is the factory's answer to silence rather than to a
  // fixture that happened to declare an empty one.
  expect("setup" in DECLARATION).toBe(false);

  const chain = chainFor();
  expect(chain.phases.length).toBeGreaterThan(0);

  // No hook at all, rather than one that installs on the engine's own
  // authority: a tree the consumer said nothing about is one the engine
  // skips the step for.
  expect(
    chain.phases.filter((phase) => phase.setupWorktree !== undefined).map((p) => p.name),
  ).toEqual([]);
});

it("a declared setup gives every returned phase a setupWorktree hook that provisions its worktree", async () => {
  // A restore command rather than the engine's installer, so the case reads
  // provisioning off a marker the declaration itself named — a consumer
  // whose stack has no lockfile the engine reads declares exactly this.
  const marker = "provisioned-by-the-worktree-hook";
  const chain = chainFor({
    ...DECLARATION,
    runner: recordingRunner([]),
    setup: { directories: ["."], restore: `touch ${marker}` },
  });
  expect(chain.phases.length).toBeGreaterThan(0);

  // Singleton and fanout alike: a plan slice runs in a worktree too, so a
  // hook hung on build alone would leave three phases judging an uninstalled
  // tree.
  for (const phase of chain.phases) {
    const worktreePath = join(repo, "setup-hook", phase.name);
    await mkdir(worktreePath, { recursive: true });

    const hook = phase.setupWorktree;
    expect([phase.name, hook !== undefined]).toEqual([phase.name, true]);
    await hook!({ worktreePath, repoRoot: repo, worktreeKey: phase.name });

    expect([phase.name, existsSync(join(worktreePath, marker))]).toEqual([
      phase.name,
      true,
    ]);
  }

  // At the worktree's root, not the repo's: the hook provisions the tree the
  // tick was handed, and a reduction anchored to the checkout it was built
  // from would install where no gate runs.
  expect(existsSync(join(repo, marker))).toBe(false);
});

it("each registry gate name the package ships constructs that builtin at the declared when", () => {
  // The keys are spelled as a consumer spells them, and each is paired with
  // the builtin it has to construct. The registry in `src/builtinGates.ts`
  // keys by each gate's own `Function.name`, so the name a declaration
  // carries and the name the package ships are two sides of a seam no type
  // joins — this reads the declaration side through the real factory.
  const shipped: Record<string, Gate> = {
    tsc: api.tscGate,
    vitest: api.vitestGate,
    eslint: api.eslintGate,
    "chain-load": api.chainLoadGate,
  };
  expect(
    Object.entries(shipped).map(([declared, gate]) => [declared, gate.name]),
  ).toEqual(Object.keys(shipped).map((declared) => [declared, declared]));

  // And every builtin defaults to `afterCommit`, so the declared `when`
  // below is read off a gate that actually moved.
  expect(Object.values(shipped).map((gate) => gate.when)).toEqual(
    Object.values(shipped).map(() => "afterCommit"),
  );

  const build = phaseNamed(
    chainFor({
      ...DECLARATION,
      runner: recordingRunner([]),
      gates: {
        build: Object.keys(shipped).map((name) => ({
          kind: "registry" as const,
          name,
          when: "afterMerge" as const,
        })),
      },
    }),
    BUILD_PHASE,
  );

  for (const [declared, builtin] of Object.entries(shipped)) {
    const gate = build.gates.find((candidate) => candidate.name === declared);
    // The builtin's own spawn line, not `sh -c <name>`: a registry name that
    // fell through to the shell arm would carry the name and run nothing.
    expect({ declared, when: gate?.when, command: gate?.command }).toEqual({
      declared,
      when: "afterMerge",
      command: builtin.command,
    });
  }

  // `chain-load` carries no command to compare, being a plain `Gate` the
  // factory spreads — so what it runs is read by identity instead.
  expect(build.gates.find((gate) => gate.name === "chain-load")?.run).toBe(
    api.chainLoadGate.run,
  );
});

it("a registry gate name the package does not ship refuses the load naming the set it could have been", () => {
  // Read off the builtins rather than respelled: the previous case owns the
  // claim that these are the names a declaration writes.
  const shipped = [api.tscGate, api.vitestGate, api.eslintGate, api.chainLoadGate].map(
    (gate) => gate.name,
  );
  expect(shipped.length).toBeGreaterThan(0);

  const loadWith = (name: string) => (): Chain =>
    chainFor({
      ...DECLARATION,
      runner: recordingRunner([]),
      gates: { build: [{ kind: "registry", name, when: "afterCommit" }] },
    });

  // Control: a name the registry does hold loads, so the refusal below is
  // the name's doing and not the gate declaration's.
  expect(loadWith(shipped[0]!)).not.toThrow();

  // Refused at load, not dropped into a phase whose gate set silently lost a
  // check the consumer declared.
  expect(loadWith("typecheck")).toThrow(/typecheck/);

  let message = "";
  try {
    loadWith("typecheck")();
  } catch (error) {
    message = (error as Error).message;
  }
  // Every name it could have been, by name: "not one the registry ships"
  // alone leaves a consumer guessing at the spelling.
  expect(shipped.filter((name) => !message.includes(`\`${name}\``))).toEqual([]);
  // And the two kinds that need no registry at all, so a consumer whose
  // check is a command is not left thinking the registry is the only door.
  expect({
    shell: message.includes("shell"),
    script: message.includes("script"),
  }).toEqual({ shell: true, script: true });
});

it("a declared script gate hangs the committed path at the declared when, named by the path", async () => {
  const script = "scripts/check-the-tree.sh";
  const build = phaseNamed(
    chainFor({
      ...DECLARATION,
      runner: recordingRunner([]),
      gates: { build: [{ kind: "script", path: script, when: "afterMerge" }] },
    }),
    BUILD_PHASE,
  );

  const gate = build.gates.find((candidate) => candidate.name === script);
  // Named by the path itself: the gate's name is what a failing tick reports
  // and what the next tick's prompt carries, so a second spelling would be a
  // name the consumer never wrote.
  expect({ name: gate?.name, when: gate?.when, command: gate?.command }).toEqual({
    name: script,
    when: "afterMerge",
    command: `sh -c ${script}`,
  });

  // And the path is the gate's own tree's, resolved there and run under its
  // own shebang — which is what makes a committed script declarable at all.
  const tree = await mkTempDir("flume-harness-chain-script-");
  try {
    await mkdir(join(tree, "scripts"), { recursive: true });
    await writeFile(join(tree, script), "#!/bin/sh\ntouch ran-the-committed-script\n");
    await chmod(join(tree, script), 0o755);

    const result = await gate!.run(gateContext(tree));
    expect({
      ok: result.ok,
      ran: existsSync(join(tree, "ran-the-committed-script")),
    }).toEqual({ ok: true, ran: true });
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
});

/**
 * The line a declared command gate runs to report the `FLUME_` half of its
 * own environment. Written as JSON by a real child process, so what these
 * cases read is what a consumer's gate would read — the real producer
 * (`constructGate`'s gate) driven through the real consumer (a spawned
 * command), never a fixture standing in for either
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
const REPORT_FLUME_ENV =
  `node -e 'require("fs").writeFileSync("gate-env.json", JSON.stringify(` +
  `Object.fromEntries(Object.entries(process.env).filter(` +
  `([k]) => k.startsWith("FLUME_")))))'`;

/**
 * The facts the gate's environment carries, as a consumer writes a command
 * against them: the variable name paired with the context field it reports.
 *
 * Spelled here rather than taken from the package's own helper — a
 * comparison of the writer with itself would pass over any renaming of the
 * pair.
 */
const expectedFacts = (ctx: GateContext): Record<string, string> => ({
  FLUME_COMMIT_SHA: ctx.commitSha,
  FLUME_BASE_SHA: ctx.baseSha,
  FLUME_STATE_ROOT: ctx.flumeDir,
  FLUME_STATE_ROOT_REL: ctx.stateRootRel!,
  FLUME_TOUCHED_PATHS: ctx.touchedPaths.join("\n"),
  ...(ctx.landedOnSha ? { FLUME_LANDED_ON_SHA: ctx.landedOnSha } : {}),
});

/**
 * Run `gate` in a throwaway tree and report both the context it was handed
 * and the `FLUME_` environment its child saw.
 *
 * The host's own `FLUME_` variables are cleared across the run: this suite
 * runs inside a flume tick, whose environment already carries `FLUME_DIR`
 * and friends, so a child read against the live host environment would judge
 * the gate's facts against whatever the host exported — and the absence case
 * below would be green by the host's silence rather than by the gate's
 * (`.claude/rules/posture-sweep.md`, a negative assertion over a whole
 * rendered artifact).
 */
async function flumeEnvSeenBy(
  gate: Gate,
  over: { touchedPaths: string[]; landedOnSha?: string },
  seed: (tree: string) => Promise<void> = async () => {},
): Promise<{ ctx: GateContext; seen: Record<string, string> }> {
  const tree = await mkTempDir("flume-harness-chain-gate-env-");
  const hostFlumeEnv = Object.entries(process.env).filter(
    ([key, value]) => key.startsWith("FLUME_") && value !== undefined,
  ) as [string, string][];
  try {
    await seed(tree);
    for (const [key] of hostFlumeEnv) delete process.env[key];
    const ctx: GateContext = { ...gateContext(tree), ...over };
    const result = await gate.run(ctx);
    // The facts ride a green run: a child that never started would report an
    // empty environment and satisfy the absence case by accident.
    expect(result.ok, result.details).toBe(true);
    const seen = JSON.parse(
      await readFile(join(tree, "gate-env.json"), "utf8"),
    ) as Record<string, string>;
    return { ctx, seen };
  } finally {
    for (const [key, value] of hostFlumeEnv) process.env[key] = value;
    await rm(tree, { recursive: true, force: true });
  }
}

/** The declared gate this chain hangs on build under `name`. */
function declaredGate(declared: unknown, name: string): Gate {
  const gate = phaseNamed(
    chainFor({ ...DECLARATION, runner: recordingRunner([]), gates: { build: [declared] } }),
    BUILD_PHASE,
  ).gates.find((candidate) => candidate.name === name);
  if (!gate) throw new Error(`the build phase hangs no gate named "${name}"`);
  return gate;
}

it("a declared shell gate's child is handed the engine's gate facts FLUME_-prefixed", async () => {
  const gate = declaredGate(
    { kind: "shell", command: REPORT_FLUME_ENV, when: "afterMerge" },
    REPORT_FLUME_ENV,
  );

  // A span that touched something, and a trunk tip it landed onto: the facts
  // below are read off values the case actually varied, never off a context
  // whose every field was the engine's own placeholder.
  const touchedPaths = ["src/widget.ts", "docs/a page.md"];
  const landedOnSha = "a".repeat(40);
  const { ctx, seen } = await flumeEnvSeenBy(gate, { touchedPaths, landedOnSha });

  // Vacuity pins: the fixture's state root is inside the repo, so its offset
  // is a value and not the relocated-root absence, and the expected set is
  // the whole acceptance rather than whatever happened to survive.
  expect(ctx.stateRootRel).toBeDefined();
  expect(Object.keys(expectedFacts(ctx)).sort()).toEqual([
    "FLUME_BASE_SHA",
    "FLUME_COMMIT_SHA",
    "FLUME_LANDED_ON_SHA",
    "FLUME_STATE_ROOT",
    "FLUME_STATE_ROOT_REL",
    "FLUME_TOUCHED_PATHS",
  ]);

  expect(seen).toEqual(expectedFacts(ctx));
  // And the touched paths survive the shell verbatim, spaces and all — one
  // path per line is the encoding a gate reads with `while read`.
  expect(seen.FLUME_TOUCHED_PATHS!.split("\n")).toEqual(touchedPaths);
});

it("a declared script gate's child is handed the same facts", async () => {
  const script = "scripts/report-gate-env.sh";
  const gate = declaredGate({ kind: "script", path: script, when: "afterMerge" }, script);

  const touchedPaths = ["src/widget.ts"];
  const landedOnSha = "b".repeat(40);
  const { ctx, seen } = await flumeEnvSeenBy(
    gate,
    { touchedPaths, landedOnSha },
    async (tree) => {
      await mkdir(join(tree, "scripts"), { recursive: true });
      await writeFile(join(tree, script), `#!/bin/sh\nexec ${REPORT_FLUME_ENV}\n`);
      await chmod(join(tree, script), 0o755);
    },
  );

  expect(ctx.stateRootRel).toBeDefined();
  // The same set, by the same contract: a committed script and an inline
  // command are one mechanism, so neither kind carries facts the other lacks.
  expect(seen).toEqual(expectedFacts(ctx));
});

it("FLUME_LANDED_ON_SHA is absent from an afterCommit gate's environment", async () => {
  const gate = declaredGate(
    { kind: "shell", command: REPORT_FLUME_ENV, when: "afterCommit" },
    REPORT_FLUME_ENV,
  );

  const touchedPaths = ["src/widget.ts"];
  const { ctx, seen } = await flumeEnvSeenBy(gate, { touchedPaths });

  // Control: no trunk means no `landedOnSha` on the context, so the absence
  // below is the engine's own field speaking and not a dropped variable.
  expect(ctx.landedOnSha).toBeUndefined();
  // The rest of the set is present, so the missing key is this one fact
  // rather than an environment the child never received.
  expect(seen).toEqual(expectedFacts(ctx));
  expect("FLUME_LANDED_ON_SHA" in seen).toBe(false);
});
