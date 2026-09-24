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
  DEFAULT_SHELL,
  INBOX_PHASE,
  PHASES,
  PLAN_SLICES,
  parseDeclaration,
  type HarnessPhase,
} from "../harness/declaration.ts";
import { defaultHandoff, type Handoff } from "../harness/handoff.ts";
import { consumerIgnores } from "../harness/ignores.ts";
import { promptPath, type PromptName } from "../harness/prompts.ts";
import {
  continuingNotePath,
  continuingNotesDir,
  noteGlobs,
  notePath,
  notePaths,
  parkedNotePath,
  parkedNotesDir,
  planStatePath,
} from "../harness/layout.ts";
import { writePlanState } from "../harness/planState.ts";
import type { RunnerContext, RunnerFactory } from "../harness/runner.ts";
import { planSliceWindows } from "../harness/windows.ts";
import type { ClaudeCodeOptions } from "../src/Agent.ts";
import { entryDeclaredKey } from "../src/entryKey.ts";
import { computeStateRootRel } from "../src/paths.ts";
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
import { renderPrompt, type PriorAttempt } from "../src/Prompt.ts";
import { sectionOf } from "./helpers/docSections.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { stubRunner } from "./helpers/stubRunner.ts";
import {
  SPAWN_BUDGET_MS,
  gitOutSync,
  spawnCaptureSync,
} from "./helpers/subprocess.ts";

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
  // The queue directory, present and empty: git holds no empty directory, so
  // the placeholder is what keeps it in the tree (`harness/init.ts`).
  await mkdir(join(flumeDir, "plan", "pending"), { recursive: true });
  await writeFile(join(flumeDir, "plan", "pending", ".gitkeep"), "");
  await mkdir(join(flumeDir, "plan", "questions"), { recursive: true });
  await writeFile(
    join(flumeDir, "plan", "questions", "a-parked-fork.md"),
    "# A parked fork\n\nContext.\n",
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

  // Written after the commits because its fields name them, and one file per
  // writing slice, through the package's own writer — the windows read each
  // slice's own file off disk, which is where that slice writes it
  // (`spec/harness.md`, *Plan state as declared state*).
  writePlanState(flumeDir, "plan-derive", { derivedThrough: cursor });
  writePlanState(flumeDir, "plan-sweep", {
    sweptThrough: cursor,
    rotation: { kind: "closed" },
  });

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
  priority: 0,
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
    priorAttempts: new Map(),
    flumeDir,
    configDir: flumeDir,
    shippedTags: [],
    revertedTags: [],
    ...overrides,
  };
}

/**
 * A minimal open entry — the subject of the per-entry refusal cases, which
 * read the record beside an entry rather than anything the entry declares.
 */
const REFUSAL_ENTRY: PendingEntry = {
  tag: "SOME-ENTRY",
  gate: { kind: "open" },
  dependsOnForks: [],
  priority: 0,
  files: { new: [], edit: [], retire: [] },
};

/**
 * A prior attempt that ran, read the entry it was handed, and committed
 * nothing — standing against the declaration `declaredAs` keys.
 */
const cleanExit = (declaredAs: string): PriorAttempt => ({
  mode: "clean-exit",
  finalMessage: "nothing to do here",
  key: "entry",
  keyedAs: "some-entry",
  declaredAs,
  headSha: "9".repeat(40),
  at: "2026-09-16T00:00:00.000Z",
});

/** The refusal context the engine composes for {@link REFUSAL_ENTRY}. */
function refusalContext(
  priorAttempt?: PriorAttempt,
): Parameters<NonNullable<Chain["refusesEntry"]>>[0] {
  return {
    entry: REFUSAL_ENTRY,
    ...(priorAttempt ? { priorAttempt } : {}),
    headSha: "9".repeat(40),
    declaredAs: entryDeclaredKey(REFUSAL_ENTRY),
  };
}

/**
 * The per-entry refusal a built chain carries, with the absence thrown
 * rather than skipped: a factory that declared none would leave every case
 * below green over nothing (`.claude/rules/engineering.md`, *A green verdict
 * is proven non-vacuous*).
 */
function refusalOf(chain: Chain): NonNullable<Chain["refusesEntry"]> {
  const refusesEntry = chain.refusesEntry;
  if (refusesEntry === undefined) {
    throw new Error("the factory declared no per-entry refusal");
  }
  return refusesEntry;
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

  // Which phases, and how each runs. The order they are declared in is the
  // case below's subject, so this one reads the set — two cases pinning one
  // list would be the second copy that goes stale against the first.
  expect(new Set(chain.phases.map((phase) => phase.name))).toEqual(
    new Set([...PLAN_SLICES, BUILD_PHASE]),
  );
  expect(
    Object.fromEntries(
      chain.phases.map((phase) => [phase.name, phase.concurrency]),
    ),
  ).toEqual({
    ...Object.fromEntries(PLAN_SLICES.map((name) => [name, "singleton"])),
    [BUILD_PHASE]: "fanout",
  });
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

it("the package declares build first and the plan slices after it, the sweep last of them", () => {
  // Non-vacuity, and the claim the second half rests on: the package's own
  // slice order already places the sweep last, so "the sweep last of them"
  // is read off that list rather than respelled here.
  expect(PLAN_SLICES.length).toBe(3);
  expect(PLAN_SLICES.at(-1)).toBe("plan-sweep");

  // Declared order is the priority when the budget is short, and the package
  // leaves the budget at the engine's default of one — so for a consumer
  // that declares no `supervisorPolicy` this list is the whole schedule, and
  // the product outranks insurance.
  expect(chainFor().phases.map((phase) => phase.name)).toEqual([
    BUILD_PHASE,
    ...PLAN_SLICES,
  ]);

  // Whichever slices a declaration enables: build keeps the front, and the
  // enabled ones keep their order behind it rather than closing up in front.
  const withoutSweep = chainFor({
    ...DECLARATION,
    slices: { enabled: ["plan-inbox", "plan-derive"] },
  });
  expect(withoutSweep.phases.map((phase) => phase.name)).toEqual([
    BUILD_PHASE,
    "plan-inbox",
    "plan-derive",
  ]);
});

it("a plan slice the declaration does not enable is absent from the returned chain", () => {
  // The control: the same declaration with every slice enabled carries it.
  expect(chainFor().phases.map((phase) => phase.name)).toContain("plan-sweep");

  const withoutSweep = chainFor({
    ...DECLARATION,
    slices: { enabled: ["plan-inbox", "plan-derive"] },
  });

  expect(withoutSweep.phases.map((phase) => phase.name)).not.toContain(
    "plan-sweep",
  );
  // Absent, not present-and-permanently-closed: the ladder reads the list it
  // is given, and a slice that can never run reads as a phase the chain
  // carries but nothing wakes.
  expect(() => phaseNamed(withoutSweep, "plan-sweep")).toThrow(/no phase named/);
});

it("the returned build phase is fanout and carries the declaration's fence", () => {
  const build = phaseNamed(chainFor(), BUILD_PHASE);
  const globs = noteGlobs(STATE_ROOT);

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
  // Beside the consumer's fence, the package's own channel: the notes a tick
  // writes are the package's paths, never globs every consumer copies — and
  // every kind rides it, because which one a tick wrote is what says whether
  // it shipped, parked, or put the rest of the entry down
  // (`spec/harness.md`, *Records as one file each*).
  //
  // Non-vacuity: one glob per kind, so the containment below covers every
  // home a note has rather than whichever one came first. Read off the paths
  // a tick may write rather than a count spelled here, which a home added to
  // both sides would red for nothing.
  expect(globs.length).toBeGreaterThan(0);
  expect(globs.length).toBe(notePaths(STATE_ROOT, "SOME-TAG").length);
  for (const glob of globs) {
    expect({ glob, fenced: build.writablePaths.includes(glob) }).toEqual({
      glob,
      fenced: true,
    });
  }
  // The channel is declared only where a tick consults it — a scoped tick,
  // whose allowance narrows to the entry's files. On an unscoped phase a
  // declared channel is dead, and the engine refuses the chain at load.
  expect(build.entryChannelPaths).toBeUndefined();
  const scoped = phaseNamed(chainFor({ ...DECLARATION, scopeWritesToEntry: true }), BUILD_PHASE);
  expect(scoped.scopeWritesToEntry).toBe(true);
  for (const glob of globs) {
    expect({ glob, channelled: scoped.entryChannelPaths?.includes(glob) }).toEqual({
      glob,
      channelled: true,
    });
  }

  // And the fence is build's alone — a plan slice writes plan artifacts and
  // whatever that slice declared, never build's paths.
  const derive = phaseNamed(chainFor(), "plan-derive");
  for (const glob of DECLARATION.fence.build) {
    expect({ glob, fenced: derive.writablePaths.includes(glob) }).toEqual({
      glob,
      fenced: false,
    });
  }
  expect(derive.writablePaths).toContain(`${STATE_ROOT}/plan/pending/*.json`);
  expect(derive.writablePaths).toContain(DECLARATION.fence["plan-derive"][0]);
});

/**
 * The leg the inbox drain no longer has: plan state is one file per writer, so
 * the derive cursor is derive's alone and a drain that routed a spec commit's
 * derivation says so in its commit body rather than stamping
 * (`spec/harness.md`, *Plan state as declared state*).
 *
 * Asserted at both layers the old leg lived at — the fence the phase carries
 * and the arguments its prompt is rendered with — because either alone leaves
 * the property half held: a block the prompt no longer names is still a cursor
 * a drain could write, and a fence that admitted derive's file is still a tick
 * the gates would let ship.
 *
 * Read off key sets and one arg's value rather than out of the rendered text:
 * a negative over a whole rendered prompt turns on whatever else that prompt
 * happens to quote (`.claude/rules/posture-sweep.md`, *Standing lenses*), and
 * this drain's prose names the cursor it is told not to touch.
 */
it("the inbox drain leaves the derive cursor untouched", async () => {
  const inbox = phaseNamed(chainFor(), INBOX_PHASE);

  // Its own state file, and no sibling's: a drain that stamped `derivedThrough`
  // anyway has the commit reverted rather than the cursor moved.
  expect(inbox.writablePaths.length).toBeGreaterThan(0);
  expect(inbox.writablePaths).toContain(planStatePath(STATE_ROOT, INBOX_PHASE));
  for (const slice of PLAN_SLICES) {
    if (slice === INBOX_PHASE) continue;
    expect({
      slice,
      fenced: inbox.writablePaths.includes(planStatePath(STATE_ROOT, slice)),
    }).toEqual({ slice, fenced: false });
  }

  // And no argument of the drain's carries the cursor's window. Read off the
  // phase's own `promptArgs` over a real context — the producer a tick renders
  // with (`.claude/rules/engineering.md`, *A seam gate reads what the real
  // writer wrote*).
  const args = inbox.promptArgs?.(tickContext(inbox)) ?? {};
  // Vacuity pin: the drain really is handed material, so the absences below
  // are this leg's removal and not an empty arg map.
  expect(Object.keys(args).length).toBeGreaterThan(0);
  expect(args["RECORDS"]).toBeDefined();
  expect(Object.keys(args)).not.toContain("DERIVE_CURSOR");
  expect(inbox.promptDataKeys).not.toContain("DERIVE_CURSOR");

  // The one plan state path it is handed is its own file, so the block that
  // sends the drain to a state artifact cannot send it to derive's.
  expect(args["PLAN_STATE_PATH"]).toBe(planStatePath(flumeDir, INBOX_PHASE));

  // And the shipped prompt names no placeholder for the removed leg — a key
  // set, not a text scan, so prose that mentions the cursor cannot answer it.
  const raw = await readFile(promptPath(INBOX_PHASE as PromptName), "utf8");
  const named = [...raw.matchAll(PLACEHOLDER)].map((m) => m[1]);
  expect(named.length).toBeGreaterThan(0);
  expect(named).not.toContain("DERIVE_CURSOR");

  // The render still resolves, which is what says the prompt and the args
  // agree after the key left both.
  const rendered = await renderPrompt({
    phase: inbox,
    promptFile: promptPath(INBOX_PHASE as PromptName),
    cwd: repo,
    flumeDir,
    args,
  });
  expect([...rendered.matchAll(PLACEHOLDER)].map((m) => m[0])).toEqual([]);
});

it("the build fence and the park predicate name one note path under a nested state root", () => {
  // A nested state root, as a relocated `FLUME_DIR` produces one: every path the
  // factory composes carries the offset to it, and on win32 the engine
  // reports that offset in the host's own separator. One derivation
  // normalizes it, so the fence glob and the predicate below cannot end up in
  // different alphabets.
  const nested = join(repo, "state", "alpha", STATE_ROOT);
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
  const assigned = entry("SOME-ENTRY");
  const park = parkedNotePath(rel, assigned.tag);

  // The globs that admit the notes a tick writes, both kinds...
  for (const glob of noteGlobs(rel)) {
    expect({ glob, fenced: build.writablePaths.includes(glob) }).toEqual({
      glob,
      fenced: true,
    });
  }
  // ...and the predicate that reads a park back, on the path git would name.
  expect(build.shipped?.(shipContext(assigned, [park]))).toBe(false);
  // The kind is the directory: an observation under the same nested root, one
  // segment up, ships.
  expect(
    build.shipped?.(shipContext(assigned, [notePath(rel, assigned.tag)])),
  ).toBe(true);

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
  expect(derive.writablePaths).toContain(`${rel}/plan/pending/*.json`);
});

it("a note under the parked directory parks its entry", () => {
  const build = phaseNamed(chainFor(), BUILD_PHASE);
  const assigned = entry("SOME-ENTRY");
  const park = parkedNotePath(STATE_ROOT, assigned.tag);

  // The path really is under the parked directory — the one fact the verdict
  // below is about, read off the accessor the build prompt names to the agent
  // rather than assumed from the call.
  expect(park.startsWith(`${parkedNotesDir(STATE_ROOT)}/`)).toBe(true);
  // Non-vacuity: the tick's own fence admits it, so this is a commit a tick
  // could have written rather than one that would have reverted first.
  expect(build.writablePaths).toContain(`${parkedNotesDir(STATE_ROOT)}/*.md`);

  expect(build.shipped?.(shipContext(assigned, [park]))).toBe(false);
});

it("a note beside the parked directory ships its entry", () => {
  const build = phaseNamed(chainFor(), BUILD_PHASE);
  const assigned = entry("SOME-ENTRY");
  const observation = notePath(STATE_ROOT, assigned.tag);

  // The same tag, the same extension, one directory apart — so the verdict
  // below is the location's doing and nothing else's. A tick with something
  // to tell plan and nothing to refuse writes here, and its entry leaves the
  // queue however little else the commit changed.
  expect(observation).not.toBe(parkedNotePath(STATE_ROOT, assigned.tag));
  expect(observation).not.toContain(`${parkedNotesDir(STATE_ROOT)}/`);

  expect(build.shipped?.(shipContext(assigned, [observation]))).toBe(true);
  expect(
    build.shipped?.(shipContext(assigned, [observation, "src/index.ts"])),
  ).toBe(true);
});

it("a commit carrying a continuing note keeps its entry in the queue", async () => {
  const build = phaseNamed(chainFor(), BUILD_PHASE);
  const assigned = entry("SOME-ENTRY");
  const continuing = continuingNotePath(STATE_ROOT, assigned.tag);

  // The path really is under the continuing directory — the one fact the
  // verdict below is about, read off the accessor the build prompt names to
  // the agent rather than assumed from the call.
  expect(continuing.startsWith(`${continuingNotesDir(STATE_ROOT)}/`)).toBe(true);
  // Non-vacuity: the tick's own fence admits it, so this is a commit a tick
  // could have written rather than one that would have reverted first.
  expect(build.writablePaths).toContain(
    `${continuingNotesDir(STATE_ROOT)}/*.md`,
  );
  // And the same commit without the note ships, so the verdict below is that
  // note's presence and not a predicate stuck on one answer.
  expect(build.shipped?.(shipContext(assigned, ["src/index.ts"]))).toBe(true);

  // The note as the tick left it: the worktree is still on disk while the
  // merge loop classifies the entry, and that tree is the commit's.
  const onDisk = join(shipContext(assigned, []).worktreePath, continuing);
  await mkdir(join(onDisk, ".."), { recursive: true });
  await writeFile(onDisk, "# what landed\n\nWhat is next.\n");

  // A green segment of the entry, landed with the rest put down: the span
  // stays on the trunk and the entry stays in the queue for the next tick on
  // it, exactly as a park's does.
  expect(build.shipped?.(shipContext(assigned, [continuing]))).toBe(false);
  expect(
    build.shipped?.(shipContext(assigned, ["src/index.ts", continuing])),
  ).toBe(false);

  // And the tick that completes the entry takes the note with it: the same
  // touched path, the file gone from the tree, so the removal is read as the
  // ship it is rather than as the declaration it retires.
  await rm(onDisk);
  expect(
    build.shipped?.(shipContext(assigned, ["src/index.ts", continuing])),
  ).toBe(true);
});

it("a commit writing a parked note and the entry's work is still a park", () => {
  const build = phaseNamed(chainFor(), BUILD_PHASE);
  const assigned = entry("SOME-ENTRY");
  const park = parkedNotePath(STATE_ROOT, assigned.tag);

  // Vacuity guard: the same commit without the parked note ships, so the
  // verdicts below are that note's presence and not a predicate stuck on one
  // answer.
  expect(build.shipped?.(shipContext(assigned, ["src/index.ts"]))).toBe(true);

  // A refusal that could not help leaving work behind — a half-finished edit,
  // a test it had to touch to reach the wall — is still a refusal: the
  // predicate reads where the tick wrote, never the shape of the path list
  // around it.
  expect(build.shipped?.(shipContext(assigned, ["src/index.ts", park]))).toBe(
    false,
  );
  expect(
    build.shipped?.(
      shipContext(assigned, [park, notePath(STATE_ROOT, assigned.tag)]),
    ),
  ).toBe(false);
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

it("a declared capabilities list reaches Chain.capabilities whole", () => {
  // The shared fixture declares none, so this case states its own list —
  // which is also what keeps the absence pin below reading the fixture
  // rather than a field this case deleted from it.
  const capabilities = ["network", "docker-daemon"];

  expect(chainFor({ ...DECLARATION, capabilities }).capabilities).toEqual(
    capabilities,
  );
});

it("a declaration naming no capabilities leaves Chain.capabilities unasserted", () => {
  // Non-vacuity: the fixture is the declaration that names no capabilities,
  // so a fixture that grew the field would make the assertion below hold for
  // the wrong reason.
  expect(DECLARATION).not.toHaveProperty("capabilities");

  // Undeclared stays undeclared rather than becoming an empty assertion: a
  // `requiresCapability` entry is held back either way, but only an absent
  // field says the chain never spoke on it.
  expect(chainFor().capabilities).toBeUndefined();
});

it("a declared worktreesBase reaches Chain.worktreesBase unchanged", () => {
  // The shared fixture declares none, so this case states its own — which is
  // also what keeps the absence pin below reading the fixture rather than a
  // field this case deleted from it.
  const worktreesBase: NonNullable<Chain["worktreesBase"]> = (paths) =>
    join(paths.repoRoot, "..", "flume-worktrees");

  // The function itself, not a base this factory evaluated: the engine runs
  // it once per chain load against the roots it resolved, which is the only
  // place the roots exist.
  expect(chainFor({ ...DECLARATION, worktreesBase }).worktreesBase).toBe(
    worktreesBase,
  );
});

it("a declaration naming no worktreesBase leaves Chain.worktreesBase absent", () => {
  // Non-vacuity: the fixture is the declaration that names no base, so a
  // fixture that grew the field would make the assertion below hold for the
  // wrong reason.
  expect(DECLARATION).not.toHaveProperty("worktreesBase");

  // Undeclared stays undeclared. The engine reads an absent base as its own
  // `<flumeDir>/worktrees` (`worktreesBase`, `src/paths.ts`), so a factory
  // that supplied one here would place a silent consumer's worktrees
  // somewhere they would have to discover to move.
  expect(chainFor().worktreesBase).toBeUndefined();
});

it("a declared friction directory reaches Chain.friction", () => {
  // The shared fixture declares none, so this case states its own — which is
  // also what keeps the absence arm below reading the fixture rather than a
  // field this case deleted from it.
  expect(DECLARATION).not.toHaveProperty("friction");

  // Whole and unchanged: what the package does with the channel is read the
  // directory the engine was told about, never a second spelling of it.
  expect(chainFor({ ...DECLARATION, friction: "friction" }).friction).toBe(
    "friction",
  );

  // Undeclared stays undeclared. The engine reads an absent `friction` as the
  // whole channel off (`spec/chain.md`, *`Chain.friction` — the declared
  // friction channel*), so a factory that supplied one here would turn a
  // consumer's silence into a directory it has to discover to switch off.
  expect(chainFor().friction).toBeUndefined();
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
  // own wake set — so the line above is the declaration's doing, not the
  // package's answer for this fixture.
  const fallback = defaultHandoff(
    planSliceWindows({
      // Through the package's own parse, so the control set and the
      // factory's read one schema rather than two.
      declaration: parseDeclaration(DECLARATION),
      repoRoot: repo,
      stateRootRel: STATE_ROOT,
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

it("the chain's default handoff wakes every live slice and build together", () => {
  // The wired default over the fixture's real tree: the derive window is
  // open on a spec commit past its cursor, the sweep's rotation is closed
  // over a domain that commit never touched, and the queue reports pickable
  // work — three separate facts, and the answer carries each one that says
  // yes rather than the first of them.
  const build = phaseNamed(chainFor(), BUILD_PHASE);
  const windows = planSliceWindows({
    declaration: parseDeclaration(DECLARATION),
    repoRoot: repo,
    stateRootRel: STATE_ROOT,
  });
  const window = { flumeDir, pickable: true };

  // Vacuity, read off the same windows the chain wired: this tree really
  // does open one of them and shut another, so the answer below is those
  // verdicts and not a set the handoff returns over any tree.
  expect(
    windows.map((w) => [w.name, w.live(window)] as const),
  ).toEqual([
    [INBOX_PHASE, false],
    ["plan-derive", true],
    ["plan-sweep", false],
  ]);

  const result = tickResult({ pickableAfter: [entry("READY")] });
  expect(result.pickableAfter.length).toBeGreaterThan(0);
  expect(build.handoff(result)).toEqual(["plan-derive", BUILD_PHASE]);

  // The control: with nothing pickable the same open window answers alone,
  // so build's name above is the queue's doing.
  expect(build.handoff(tickResult())).toEqual(["plan-derive"]);
});

it("the chain the factory builds declines a clean exit against the entry as declared", () => {
  // Driven through the chain the factory returns, over the context the
  // engine composes at selection (`bindEntryRefusal`, `src/selection.ts`) —
  // so this is the predicate a real wave consults, not the module-level one
  // asserted against itself.
  const refusesEntry = refusalOf(chainFor());
  const declared = entryDeclaredKey(REFUSAL_ENTRY);

  expect(refusesEntry(refusalContext(cleanExit(declared)))).toBe(true);

  // Control: a record standing against a declaration this entry no longer
  // carries leaves it the wave's, so the refusal above is the declaration
  // key's doing rather than a factory that declines every walled entry
  // forever.
  const rewritten = entryDeclaredKey({
    ...REFUSAL_ENTRY,
    summary: "re-scoped by a later plan tick",
  });
  expect(rewritten).not.toBe(declared);
  expect(refusesEntry(refusalContext(cleanExit(rewritten)))).toBe(false);

  // And a first attempt — no record at all — is never held back.
  expect(refusesEntry(refusalContext())).toBe(false);
});

it("a chain declaring its own build handoff still carries the package's per-entry refusal", () => {
  // The case above drives the default declaration, where the ladder and the
  // refusal come from the same place and neither can be seen apart from the
  // other. Here a consumer has replaced build's routing outright — the one
  // value a declaration states about which phase runs next — and the floor
  // beneath it is what this reads.
  const declared: Handoff = () => ["a-phase-the-package-never-names"];
  const chain = chainFor({ ...DECLARATION, handoff: { build: declared } });

  // The ladder really is displaced for that phase, so the refusal below is
  // the floor's doing rather than the package's default still standing.
  expect(
    phaseNamed(chain, BUILD_PHASE).handoff(tickResult({ phaseName: BUILD_PHASE })),
  ).toEqual(["a-phase-the-package-never-names"]);

  const refusesEntry = refusalOf(chain);

  expect(
    refusesEntry(refusalContext(cleanExit(entryDeclaredKey(REFUSAL_ENTRY)))),
  ).toBe(true);

  // And the declaration did not turn the floor into a wall either: the same
  // entry with nothing walled on it is still the wave's.
  expect(refusesEntry(refusalContext())).toBe(false);
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

  // And the discipline gates still lead every phase's set, the
  // consumer's declaration notwithstanding.
  const DISCIPLINE = [
    "records",
    "clean-tree",
    "pending-gate",
    "per cites resolve",
    "plan cursors",
  ];
  expect(chain.phases.length).toBeGreaterThan(0);
  for (const phase of chain.phases) {
    expect([
      phase.name,
      phase.gates.slice(0, DISCIPLINE.length).map((gate) => gate.name),
    ]).toEqual([phase.name, DISCIPLINE]);
  }
  // Nothing of the package's trails into the consumer's own point either:
  // build's afterCommit set is the discipline set, then the declared
  // typecheck, and the judge hangs on afterMerge alone.
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

/**
 * One `claudeCode` call per phase, keyed back to its phase by the model that
 * phase declared — the same link the MCP case above uses, so neither leans
 * on the order the factory happens to build phases in.
 */
const MODELS: Record<HarnessPhase, string> = {
  build: "claude-opus-5",
  "plan-inbox": "claude-sonnet-5",
  "plan-derive": "claude-haiku-4-5-20251001",
  "plan-sweep": "claude-fable-5-1",
};

/**
 * The real factory over a real declaration, with every `claudeCode` call it
 * makes captured — and a reader from a phase to the options that phase's
 * agent was built with.
 */
function capturedAgentOptions(agents: Record<string, unknown>): {
  chain: Chain;
  captured: ClaudeCodeOptions[];
  optionsFor: (phase: HarnessPhase) => ClaudeCodeOptions;
} {
  const captured: ClaudeCodeOptions[] = [];
  const chain = harnessChain({
    api: {
      ...api,
      claudeCode: (opts) => {
        captured.push(opts ?? {});
        return api.claudeCode(opts);
      },
    },
    declaration: { ...DECLARATION, runner: recordingRunner([]), agents },
  });
  const optionsFor = (phase: HarnessPhase): ClaudeCodeOptions => {
    const found = captured.find((opts) => opts.model === MODELS[phase]);
    if (found === undefined) {
      throw new Error(
        `no claudeCode call carried ${phase}'s model; captured ${captured
          .map((opts) => String(opts.model))
          .join(", ")}`,
      );
    }
    return found;
  };
  return { chain, captured, optionsFor };
}

it("a declared agents.contextWindow reaches the adapter as its budget window", () => {
  // How many tokens a model holds is a provider fact nothing in the tree can
  // look up, so the declaration is where it lives — and the engine takes it
  // inside a budget declaration rather than as a flag of its own. The claim
  // is the whole forward: the number a consumer wrote arrives as the
  // adapter's window, and the package adds nothing beside it.
  const windows: Record<HarnessPhase, number> = {
    build: 200_000,
    "plan-inbox": 400_000,
    "plan-derive": 1_000_000,
    "plan-sweep": 120_000,
  };
  const { chain, captured, optionsFor } = capturedAgentOptions(
    Object.fromEntries(
      PHASES.map((phase) => [
        phase,
        { model: MODELS[phase], contextWindow: windows[phase] },
      ]),
    ),
  );

  // Vacuity pin: one call per phase the factory wired, so a chain that built
  // no agent at all cannot satisfy the assertions below.
  expect(captured).toHaveLength(chain.phases.length);
  expect(chain.phases.length).toBeGreaterThan(0);

  for (const phase of PHASES) {
    // The window each phase declared, on the phase that declared it — and
    // nothing else in the budget: the package recommends no cadence and no
    // thresholds, so the engine's line reports on every tool call, which is
    // what a prompt naming its own percentages reads.
    expect([phase, optionsFor(phase).budget]).toEqual([
      phase,
      { contextWindow: windows[phase] },
    ]);
  }
});

it("a declaration naming no contextWindow builds its phase agent with no budget", () => {
  // The absent case is the one a consumer who never heard of the field gets:
  // no budget passed at all, so the adapter registers no hook and the argv is
  // unchanged. A window the package picked would be a provider fact invented
  // on the consumer's behalf.
  const { chain, captured, optionsFor } = capturedAgentOptions(
    Object.fromEntries(PHASES.map((phase) => [phase, { model: MODELS[phase] }])),
  );

  expect(captured).toHaveLength(chain.phases.length);
  expect(chain.phases.length).toBeGreaterThan(0);

  for (const phase of PHASES) {
    expect([phase, "budget" in optionsFor(phase)]).toEqual([phase, false]);
  }
});

/** The context a gate is handed, as the dispatcher builds one, over `cwd`. */
function gateContext(cwd: string): GateContext {
  return {
    cwd,
    repoRoot: repo,
    flumeDir,
    stateRootRel: computeStateRootRel(repo, flumeDir),
    pendingDir: join(flumeDir, "plan", "pending"),
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

/**
 * The declared gate this chain hangs on build under `name`, under `shell`
 * where the case names one and under whatever the schema defaults to
 * otherwise — the omission a case relies on to read the default.
 */
function declaredGate(declared: unknown, name: string, shell?: string): Gate {
  const gate = phaseNamed(
    chainFor({
      ...DECLARATION,
      runner: recordingRunner([]),
      gates: { build: [declared] },
      ...(shell === undefined ? {} : { shell }),
    }),
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

/**
 * The page a chain author reads before any hover text states which facts a
 * declared gate's command can reach, so it is pinned for what it says against
 * the mechanism it describes (`.claude/rules/engineering.md`, *Narration is
 * the ladder's bottom rung*, the `docs/` carve-out). The real writer is the
 * gate's own spawn, read through the real consumer above — a seventh fact, a
 * dropped one, or a renamed one parts the table from the environment and reds
 * here (*A seam gate reads what the real writer wrote*).
 *
 * The bullet bodies below the table stay unpinned: what a variable *means* is
 * prose, and reading it against a doc comment would be prose against prose.
 */
it("docs/CHAIN-AUTHORING.md names exactly the FLUME_ variables a declared gate's child is handed", async () => {
  const gate = declaredGate(
    { kind: "shell", command: REPORT_FLUME_ENV, when: "afterMerge" },
    REPORT_FLUME_ENV,
  );

  // `afterMerge` over a span that touched something: the stage and the span
  // that carry every fact at once, so the page is read against the full set
  // rather than against whichever variables this context happened to fill.
  const { ctx, seen } = await flumeEnvSeenBy(gate, {
    touchedPaths: ["src/widget.ts"],
    landedOnSha: "c".repeat(40),
  });
  expect(ctx.stateRootRel).toBeDefined();

  const doc = await readFile(
    new URL("../docs/CHAIN-AUTHORING.md", import.meta.url),
    "utf8",
  );
  const section = sectionOf(doc, /^#### What a declared command gate's child reads$/m);

  // The span is the one it claims to be before a set is read off it: a heading
  // match that captured the wrong section would compare an empty table against
  // the environment and report every fact missing.
  expect(section).toContain("shell the declaration names");

  /** The table's subjects: one row each, led by the variable in its first cell. */
  const tabled = [...section.matchAll(/^\| `(FLUME_[A-Z_]+)` \|/gm)].map((row) => row[1]!);

  // Vacuity pin (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*): a child that never started would report nothing, and a
  // table read off a mis-cut span would hold nothing — either way two empty
  // sets agree. One anchor apiece rather than a second copy of the list.
  expect(Object.keys(seen).length).toBeGreaterThan(1);
  expect(tabled.length).toBeGreaterThan(1);

  expect(
    [...tabled].sort(),
    "docs/CHAIN-AUTHORING.md tables exactly the facts a declared gate's child is handed",
  ).toEqual(Object.keys(seen).sort());
});

/**
 * A shell of the case's own: a real executable that records the argv it was
 * spawned with before running the command it was handed. The declaration
 * names its absolute path, so what these cases read is the spawn the gate
 * actually made — the real producer driven through a real child — rather
 * than the command line the gate happens to print beside it
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * `exec sh "$@"` at the end so the gate still goes green on a command that
 * succeeds: a recorder that swallowed the command would leave every case
 * below reading a gate that ran nothing.
 *
 * **POSIX-only, by construction.** A shebang line and an executable
 * permission bit are what make this file spawnable, and win32 carries
 * neither (`.claude/rules/platform-facts.md`, *`chmod` denies nothing on
 * win32* for the bit, *win32 spawns no shebang script* for the loader). So
 * {@link posixOnly} guards the cases that declare this path as their shell.
 */
async function recordingShell(tree: string): Promise<string> {
  const shell = join(tree, "recording-shell");
  await writeFile(
    shell,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(tree, "shell-argv.txt")}"\nexec sh "$@"\n`,
  );
  await chmod(shell, 0o755);
  return shell;
}

/*
 * The host {@link recordingShell} needs, declared rather than left to a lane
 * to discover: the interposed recorder *is* the subject of the cases below,
 * and the host that cannot spawn it has no substitute that keeps the subject
 * intact — a `.cmd` recorder is reachable only through cmd.exe's re-parse of
 * the gate's argv, which would put the cases' assertions on that re-parse
 * rather than on the spawn the gate made, a different subject wearing these
 * titles. The shell the package reaches *without* a declaration is covered on
 * every host by the default-shell case further down, and that a declared
 * shell is refused when the host will not run it by the chain-load case after
 * it.
 */
const posixOnly = it.runIf(process.platform !== "win32");

posixOnly("a declared shell runs a command gate's command", async () => {
  const tree = await mkTempDir("flume-harness-chain-declared-shell-");
  try {
    const shell = await recordingShell(tree);
    // Non-vacuity: the declared shell is nothing the package could have
    // reached on its own, so every claim below is about the declaration.
    expect(shell).not.toBe("sh");
    expect(existsSync(join(tree, "shell-argv.txt"))).toBe(false);

    const command = "printf ran > ran-the-command.txt";
    const gate = declaredGate({ kind: "shell", command, when: "afterCommit" }, command, shell);

    // The line a failing tick reports names the declared shell, not the
    // package's default.
    expect(gate.command).toBe(`${shell} -c ${command}`);

    const result = await gate.run(gateContext(tree));

    expect(result.ok, result.details).toBe(true);
    // The declared shell was the process spawned, and it was handed the
    // gate's own invocation form — `-c` and the command, nothing folded in.
    expect(await readFile(join(tree, "shell-argv.txt"), "utf8")).toBe(
      `-c\n${command}\n`,
    );
    // And the command itself ran, in the gate's own tree.
    expect(await readFile(join(tree, "ran-the-command.txt"), "utf8")).toBe("ran");
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
});

posixOnly("a declared shell runs a script gate's committed path", async () => {
  const tree = await mkTempDir("flume-harness-chain-declared-shell-script-");
  try {
    const shell = await recordingShell(tree);
    const script = "scripts/check-the-tree.sh";
    await mkdir(join(tree, "scripts"), { recursive: true });
    await writeFile(join(tree, script), "#!/bin/sh\ntouch ran-the-committed-script\n");
    await chmod(join(tree, script), 0o755);

    const gate = declaredGate({ kind: "script", path: script, when: "afterMerge" }, script, shell);

    const result = await gate.run(gateContext(tree));

    // One mechanism with two names: the script kind takes the declared shell
    // on the same terms the shell kind does.
    expect({
      ok: result.ok,
      argv: await readFile(join(tree, "shell-argv.txt"), "utf8"),
      ran: existsSync(join(tree, "ran-the-committed-script")),
    }).toEqual({ ok: true, argv: `-c\n${script}\n`, ran: true });
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
});

it("an undeclared shell runs a command gate under sh", async () => {
  // Non-vacuity: the base declaration genuinely says nothing about a shell,
  // so what runs below is the schema's own default rather than a value this
  // fixture chose.
  expect("shell" in DECLARATION).toBe(false);

  const report = `printf '%s' "$0"`;
  const command = `${report} > shell-name.txt`;
  const gate = declaredGate({ kind: "shell", command, when: "afterCommit" }, command);
  expect(gate.command).toBe(`${DEFAULT_SHELL} -c ${command}`);

  const tree = await mkTempDir("flume-harness-chain-default-shell-");
  try {
    // What `$0` reads as is the *host's* resolution of the default name, not
    // the name itself: git's `sh` on win32 is bash and reports
    // `/usr/bin/bash`. So the expectation is spawned rather than spelled —
    // the same name, handed to the host directly, under the same `-c` form
    // the gate uses. A posix host answers `sh` here, so this lane's verdict
    // is the one it always was.
    const control = spawnCaptureSync(DEFAULT_SHELL, ["-c", report], { cwd: tree });
    // Vacuity pins: two empty strings would agree. The control ran, and it
    // said something (`.claude/rules/engineering.md`, *A green verdict is
    // proven non-vacuous*).
    expect({ status: control.status, said: control.stdout !== "" }).toEqual({
      status: 0,
      said: true,
    });

    const result = await gate.run(gateContext(tree));

    expect(result.ok, result.details).toBe(true);
    // `$0` under `-c` is the shell as it was invoked, so this is the name the
    // package spawned — read off the child, not off the printed line above.
    expect(await readFile(join(tree, "shell-name.txt"), "utf8")).toBe(control.stdout);
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
});

it("chain load refuses a shell the host does not resolve, naming the gate", () => {
  const command = "printf ran";
  const loadWith = (shell: string) => (): Chain =>
    chainFor({
      ...DECLARATION,
      runner: recordingRunner([]),
      shell,
      gates: { build: [{ kind: "shell", command, when: "afterCommit" }] },
    });

  // Control: the package's default shell loads on this host, so the refusal
  // below is the declared shell's doing and not the gate declaration's.
  expect(loadWith(DEFAULT_SHELL)).not.toThrow();

  // `COMMAND` is the case's unresolvable name throughout this file — a shell
  // no host answers to.
  expect(loadWith(COMMAND)).toThrow();

  let message = "";
  try {
    loadWith(COMMAND)();
  } catch (error) {
    message = (error as Error).message;
  }
  // Both halves by name: which gate is stranded, and which shell stranded it.
  // Either alone leaves a consumer with several command gates guessing.
  expect({ gate: message.includes(command), shell: message.includes(COMMAND) }).toEqual({
    gate: true,
    shell: true,
  });
});

/**
 * The setup hook of a chain built over `declaration`, refusing where the
 * factory returned none — the case reads provisioning off the hook the build
 * phase actually carries rather than off a second reduction built beside it.
 */
function setupHook(declaration: unknown): NonNullable<Phase["setupWorktree"]> {
  const hook = phaseNamed(chainFor(declaration), BUILD_PHASE).setupWorktree;
  if (!hook) throw new Error("the build phase carries no setupWorktree hook");
  return hook;
}

posixOnly("a declared shell runs the setup restore", async () => {
  const tree = await mkTempDir("flume-harness-chain-declared-shell-restore-");
  try {
    const shell = await recordingShell(tree);
    // Non-vacuity: the declared shell is nothing the package could have
    // reached on its own, so every claim below is about the declaration.
    expect(shell).not.toBe(DEFAULT_SHELL);
    expect(existsSync(join(tree, "shell-argv.txt"))).toBe(false);

    const marker = "restored-by-the-declared-shell";
    const restore = `touch ${marker}`;
    const hook = setupHook({
      ...DECLARATION,
      runner: recordingRunner([]),
      shell,
      setup: { directories: ["."], restore },
    });

    await hook({ worktreePath: tree, repoRoot: repo, worktreeKey: BUILD_PHASE });

    // The declared shell was the process spawned, and it was handed the same
    // `-c` form a declared command gate's line takes: a restore is a command
    // line the consumer wrote, so it runs under the shell that consumer
    // named rather than under a spawn of its own.
    expect({
      argv: await readFile(join(tree, "shell-argv.txt"), "utf8"),
      ran: existsSync(join(tree, marker)),
    }).toEqual({ argv: `-c\n${restore}\n`, ran: true });
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
});

it("an undeclared shell runs the setup restore under sh", async () => {
  // Non-vacuity: the base declaration genuinely says nothing about a shell,
  // so what runs below is the schema's own default rather than a value this
  // fixture chose.
  expect("shell" in DECLARATION).toBe(false);

  const report = `printf '%s' "$0"`;
  const restore = `${report} > shell-name.txt`;
  const hook = setupHook({
    ...DECLARATION,
    runner: recordingRunner([]),
    setup: { directories: ["."], restore },
  });

  const tree = await mkTempDir("flume-harness-chain-default-shell-restore-");
  try {
    // Spawned rather than spelled, for the reason the command gate's own
    // default-shell case states: `$0` reads as the *host's* resolution of the
    // default name, which is not the name itself on every host.
    const control = spawnCaptureSync(DEFAULT_SHELL, ["-c", report], { cwd: tree });
    // Vacuity pins: two empty strings would agree. The control ran, and it
    // said something (`.claude/rules/engineering.md`, *A green verdict is
    // proven non-vacuous*).
    expect({ status: control.status, said: control.stdout !== "" }).toEqual({
      status: 0,
      said: true,
    });

    await hook({ worktreePath: tree, repoRoot: repo, worktreeKey: BUILD_PHASE });

    // `$0` under `-c` is the shell as it was invoked, so this is the name the
    // package spawned for a restore the declaration named no shell for.
    expect(await readFile(join(tree, "shell-name.txt"), "utf8")).toBe(control.stdout);
  } finally {
    await rm(tree, { recursive: true, force: true });
  }
});

it("chain load refuses a shell the host does not resolve, naming the setup restore", () => {
  const restore = "printf restored";
  const loadWith = (shell: string) => (): Chain =>
    chainFor({
      ...DECLARATION,
      runner: recordingRunner([]),
      shell,
      setup: { directories: ["."], restore },
    });

  // Control: the package's default shell loads on this host, so the refusal
  // below is the declared shell's doing and not the setup declaration's.
  expect(loadWith(DEFAULT_SHELL)).not.toThrow();

  // `COMMAND` is the case's unresolvable name throughout this file — a shell
  // no host answers to.
  expect(loadWith(COMMAND)).toThrow();

  let message = "";
  try {
    loadWith(COMMAND)();
  } catch (error) {
    message = (error as Error).message;
  }
  // One probe, every declared command line: the restore is refused at load
  // on the same terms a gate's command is, and names both halves — which
  // line is stranded, and which shell stranded it.
  expect({
    restore: message.includes(restore),
    shell: message.includes(COMMAND),
  }).toEqual({ restore: true, shell: true });
});

/**
 * How long a fixture restore holds its turn. Long enough that a wave's
 * spawns overlap on any host the lane runs on — node's own startup is the
 * floor a concurrent wave has to clear — and short enough that a serialized
 * wave of {@link WAVE} stays well inside this file's budget.
 */
const RESTORE_SPAN_MS = 300;

/** The worktrees a fixture wave provisions at once. */
const WAVE = 3;

/**
 * A restore command reporting its own span — `enter <cwd>`, a beat,
 * `exit <cwd>` — into one shared log, so a wave's restores read as
 * overlapping or not off the order the lines landed.
 *
 * A committed script rather than an inline one-liner: the command reaches
 * the child through the declared shell's `-c`, and a program quoted into
 * that would make the case a quoting fixture rather than a concurrency one.
 */
async function spanningRestore(dir: string, log: string): Promise<string> {
  const script = join(dir, "span.mjs");
  await writeFile(
    script,
    [
      `import { appendFileSync } from "node:fs";`,
      `const log = ${JSON.stringify(log)};`,
      "appendFileSync(log, `enter ${process.cwd()}\\n`);",
      `await new Promise((done) => setTimeout(done, ${RESTORE_SPAN_MS}));`,
      "appendFileSync(log, `exit ${process.cwd()}\\n`);",
      "",
    ].join("\n"),
  );
  return `node ${JSON.stringify(script)}`;
}

/**
 * {@link WAVE} worktrees under `dir`, provisioned through `hook` at once —
 * the shape a fanout wave provisions in, where the engine runs every
 * entry's hook concurrently (`spec/worktrees.md`, *`setupWorktree` and
 * `teardownWorktree` — the chain's provisioning hooks*).
 */
async function provisionWave(
  hook: NonNullable<Phase["setupWorktree"]>,
  dir: string,
): Promise<void> {
  const trees = Array.from({ length: WAVE }, (_, index) =>
    join(dir, `entry-${index}`),
  );
  await Promise.all(trees.map((tree) => mkdir(tree, { recursive: true })));
  await Promise.all(
    trees.map((worktreePath, index) =>
      hook({ worktreePath, repoRoot: repo, worktreeKey: `ENTRY-${index}` }),
    ),
  );
}

/**
 * What a span log says about a wave: how many spans it recorded, and how
 * many were open at once at the deepest point. `1` deep is a queue; anything
 * higher is provisioning that ran from several processes at the same time.
 *
 * The count rides beside the depth so every case below carries its own
 * vacuity pin: a log that recorded nothing is one span deep too
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 */
function overlap(log: string): { spans: number; deepest: number } {
  let open = 0;
  let deepest = 0;
  let spans = 0;
  for (const line of log.split("\n").filter((entry) => entry !== "")) {
    if (line.startsWith("enter")) {
      open += 1;
      spans += 1;
    } else {
      open -= 1;
    }
    deepest = Math.max(deepest, open);
  }
  return { spans, deepest };
}

it("setup.serialize runs a fanout wave's restores one worktree at a time", async () => {
  const dir = await mkTempDir("flume-harness-chain-serialized-restore-");
  try {
    const log = join(dir, "spans.log");
    await writeFile(log, "");

    const hook = setupHook({
      ...DECLARATION,
      runner: recordingRunner([]),
      setup: {
        directories: ["."],
        restore: await spanningRestore(dir, log),
        serialize: true,
      },
    });

    await provisionWave(hook, dir);

    // Every worktree got its turn — a queue, not a lock one entry keeps —
    // and no two were ever inside the restore at the same time, which is the
    // claim a consumer whose shared cache cannot be warmed twice at once is
    // making.
    expect(overlap(await readFile(log, "utf8"))).toEqual({
      spans: WAVE,
      deepest: 1,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("setup.serialize leaves the wave's other provisioning parallel", async () => {
  const dir = await mkTempDir("flume-harness-chain-serialize-scope-");
  try {
    // The knob names the restore, and nothing else the wave provisions. A
    // directory declared without one is installed by the engine's own
    // lockfile-aware run against a store built to be written from several
    // processes at once (`spec/worktrees.md`, *Never symlink `node_modules`
    // into a worktree*) — so the queue never reaches it, and a consumer
    // stating the claim about its restore does not serialize the install it
    // said nothing about.
    const spans: string[] = [];
    const installer: FlumeApi["setupWorktree"] = async (root) => {
      spans.push(`enter ${root}`);
      await new Promise((done) => setTimeout(done, RESTORE_SPAN_MS));
      spans.push(`exit ${root}`);
    };

    const chain = harnessChain({
      // The engine's installer as a recorder: what it spawns is
      // `src/setupWorktree.ts`'s subject, and this case is about whether the
      // package queues the call at all.
      api: { ...api, setupWorktree: installer },
      declaration: {
        ...DECLARATION,
        runner: recordingRunner([]),
        setup: { directories: ["."], serialize: true },
      },
    });

    const hook = phaseNamed(chain, BUILD_PHASE).setupWorktree;
    expect(hook).toBeDefined();
    await provisionWave(hook!, dir);

    // Every worktree installed, and the whole wave was inside the install at
    // once — as deep as the wave is wide.
    expect(overlap(spans.join("\n"))).toEqual({ spans: WAVE, deepest: WAVE });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("an undeclared serialize runs restores concurrently", async () => {
  const dir = await mkTempDir("flume-harness-chain-concurrent-restore-");
  try {
    const log = join(dir, "spans.log");
    await writeFile(log, "");
    const setup = {
      directories: ["."],
      restore: await spanningRestore(dir, log),
    };

    // Non-vacuity: the field is one this schema takes, so what the wave shows
    // below is a consumer declining the knob rather than a package that has
    // none — absent is today's behavior, not an absent mechanism.
    expect(
      parseDeclaration({ ...DECLARATION, setup: { ...setup, serialize: true } })
        .setup?.serialize,
    ).toBe(true);

    const hook = setupHook({ ...DECLARATION, runner: recordingRunner([]), setup });

    await provisionWave(hook, dir);

    const { spans, deepest } = overlap(await readFile(log, "utf8"));
    // Overlapped at all is the claim: how deep a wave of real spawns gets is
    // the host's scheduling, and pinning a depth would be pinning that.
    expect({ spans, overlapped: deepest > 1 }).toEqual({
      spans: WAVE,
      overlapped: true,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
