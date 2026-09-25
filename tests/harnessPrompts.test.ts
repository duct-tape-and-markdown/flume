/**
 * The prompts the harness package ships (`spec/harness.md`, *The prompts and
 * their discipline*): where each one is addressed, that every address is a
 * file the package actually ships, and that the facts a prompt must not
 * restate reach it from the surface that owns them.
 *
 * The rendering cases here are agreement gates (`.claude/rules/engineering.md`,
 * *A seam gate reads what the real writer wrote*): the real writer is
 * `sharedPromptArgs` over a real parsed declaration and the package's own
 * entry extension, and the real reader is the engine's `renderPrompt` over
 * the shipped markdown. A hand-authored prompt fixture would re-author the
 * placeholder vocabulary by the tester's hand and let a one-sided change — a
 * prompt naming an arg nothing supplies — ship green, which is the failure
 * this file exists to hold.
 */

import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { parseDeclaration, type Declaration } from "../harness/declaration.ts";
import {
  INBOX_PHASE,
  PHASES,
  PLAN_SLICES,
  type HarnessPhase,
  type PlanSlice,
} from "../harness/declaration.ts";
import { entryExtension } from "../harness/entryExtension.ts";
import { harnessInit } from "../harness/init.ts";
import {
  QUESTION_EXT,
  QUESTIONS_DIR_REL,
  planStatePath,
} from "../harness/layout.ts";
import { PLAN_STATE_SCHEMAS, writePlanState } from "../harness/planState.ts";
import { NONE_OPEN, renderQuestions } from "../harness/questions.ts";
import {
  PROMPT_NAMES,
  planSlicePromptArgs,
  promptPath,
  sharedPromptArgs,
  type PlanSlicePromptArg,
  type PromptName,
  type SharedPromptArg,
} from "../harness/prompts.ts";
import { entryFileName } from "../src/PendingSchema.ts";
import { resolvePendingDir } from "../src/paths.ts";
import type { Phase } from "../src/Phase.ts";
import {
  InlineExecRenderError,
  NO_COMMIT_MODES,
  renderPrompt,
} from "../src/Prompt.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/** The repo root, and the directory the package's prompts ship in. */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROMPT_DIR = fileURLToPath(
  new URL("../harness/prompts/", import.meta.url),
);

/** The engine's own placeholder grammar, as the renderer spells it. */
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** Its inline-exec grammar, likewise — what stage 2 scans the file with. */
const SPAN = /!\s*`([^`]+)`/g;

/** A state root with the artifacts the slice prompts' inline-exec spans read. */
let stateRoot: string;
let declaration: Declaration;

beforeAll(async () => {
  stateRoot = await mkTempDir("flume-prompts-");
  // The queue is a directory, present and empty — the state adoption seeds
  // (`harness/init.ts`) and the one every slice's span reads.
  await mkdir(resolvePendingDir(stateRoot), { recursive: true });
  // One question open, as presence states it (`spec/harness.md`, *Records as
  // one file each*): a file under the questions directory, not a section of a
  // page.
  await mkdir(join(stateRoot, QUESTIONS_DIR_REL), { recursive: true });
  await writeFile(
    join(stateRoot, QUESTIONS_DIR_REL, `a-parked-fork${QUESTION_EXT}`),
    "# A parked fork\n",
  );

  // Parsed, not cast: the args under test read `specLocus` and `slots`, and a
  // shape the schema would refuse is not a declaration any consumer could
  // have handed the factory.
  declaration = parseDeclaration({
    specLocus: ["spec/**", "rules/**"],
    fence: { build: ["src/**"] },
    runner: () => ({
      run: async () => [],
      runAtBase: async () => [],
      lanes: [],
    }),
    slices: { enabled: [] },
  });
});

/** Every scratch root a case seeded, torn down together. */
const oddRoots: string[] = [];

afterAll(async () => {
  if (stateRoot) await rm(stateRoot, { recursive: true, force: true });
  for (const root of oddRoots) await rm(root, { recursive: true, force: true });
});

/**
 * Whether `name` is a plan slice — the roster's own membership test, so a
 * slice added to the package reaches the per-slice producer below without
 * this file naming it.
 */
const isPlanSlice = (name: HarnessPhase): name is PlanSlice =>
  (PLAN_SLICES as readonly string[]).includes(name);

/**
 * Every argument the package supplies for one prompt: the shared set, plus a
 * plan slice's own.
 *
 * Both real producers, never a hand-built map: the per-slice half is where a
 * plan state path comes from now that it is one file per writer
 * (`harness/prompts.ts`, `planSlicePromptArgs`), and a fixture spelling it
 * here would re-author the seam this file exists to hold.
 */
function args(
  name: HarnessPhase,
  root: string = stateRoot,
  claimed: readonly string[] = [],
): Record<string, string> {
  return {
    ...sharedPromptArgs({
      declaration,
      extension: entryExtension(),
      phase: name,
      stateRoot: root,
    }),
    ...(isPlanSlice(name) ? planSlicePromptArgs(name, root, claimed) : {}),
  };
}

function phase(name: string): Phase {
  return {
    name,
    description: `${name} under test`,
    promptPath: promptPath(name as PromptName),
    concurrency: "singleton",
    writablePaths: ["**"],
    gates: [],
    handoff: () => [],
  };
}

/**
 * One shipped prompt through the engine's real renderer.
 *
 * Whatever the shared args do not cover is a per-tick arg the chain factory
 * supplies, and it is filled here from the file's own placeholders rather
 * than from a list by hand: a list would be this test's copy of a vocabulary
 * the prompts own, and it would go stale the moment a prompt grew an arg.
 */
async function render(
  name: HarnessPhase,
  root: string = stateRoot,
  claimed: readonly string[] = [],
): Promise<string> {
  const promptFile = promptPath(name);
  const raw = await readFile(promptFile, "utf8");
  const shared = args(name, root, claimed);
  const perTick = Object.fromEntries(
    [...raw.matchAll(PLACEHOLDER)]
      .map((match) => match[1]!)
      .filter((key) => !(key in shared) && key !== "FLUME_DIR")
      .map((key) => [key, `<per-tick ${key}>`]),
  );
  return renderPrompt({
    phase: phase(name),
    promptFile,
    // The repo itself, so build's `git log` span resolves against a real
    // history rather than an empty scratch directory.
    cwd: REPO_ROOT,
    flumeDir: root,
    args: { ...shared, ...perTick },
  });
}

it("the package addresses each phase's prompt absolutely from its own location", () => {
  // Non-vacuity: a phase list that collapsed to zero would pass the loop
  // below over nothing (`.claude/rules/engineering.md`, *A green verdict is
  // proven non-vacuous*).
  expect(PHASES.length).toBeGreaterThan(0);

  for (const name of PHASES) {
    const address = promptPath(name);
    // Both sides resolve from a module URL rather than from a cwd, so the
    // equality holds wherever the suite is started from — which is the
    // property a consumer's state root depends on.
    expect({ name, absolute: isAbsolute(address), address }).toEqual({
      name,
      absolute: true,
      address: join(PROMPT_DIR, `${name}.md`),
    });
  }
});

it("every prompt address the package names is a file it ships", async () => {
  expect(PROMPT_NAMES.length).toBeGreaterThan(0);

  for (const name of PROMPT_NAMES) {
    const address = promptPath(name);
    const body = existsSync(address) ? await readFile(address, "utf8") : "";
    expect({
      name,
      exists: existsSync(address),
      empty: body.trim() === "",
    }).toEqual({
      name,
      exists: true,
      empty: false,
    });
  }

  // And the other direction: a prompt file nothing addresses is an orphan
  // that no phase renders and no rename would ever catch.
  const shipped = (await readdir(PROMPT_DIR)).filter((f) => f.endsWith(".md"));
  expect(shipped.sort()).toEqual(
    PROMPT_NAMES.map((name) => `${name}.md`).sort(),
  );
});

it("the package's prompt args name the no-commit modes from the engine's exported value", async () => {
  // Non-vacuity: an empty taxonomy would make every assertion below trivial.
  expect(NO_COMMIT_MODES.length).toBeGreaterThan(0);

  const rendered = await render("plan-inbox");
  for (const mode of NO_COMMIT_MODES) {
    expect({ mode, named: rendered.includes(`\`${mode}\``) }).toEqual({
      mode,
      named: true,
    });
  }

  // The list reached the prompt through the arg, not through the file: no
  // shipped prompt carries the taxonomy entire in its own bytes. Prose
  // naming one mode inline is not a copy — restating the whole set is.
  for (const name of PROMPT_NAMES) {
    const raw = await readFile(promptPath(name), "utf8");
    expect({
      name,
      restatesTaxonomy: NO_COMMIT_MODES.every((mode) => raw.includes(mode)),
    }).toEqual({ name, restatesTaxonomy: false });
  }
}, SPAWN_BUDGET_MS);

it("every phase prompt the package ships resolves every placeholder it names", async () => {
  expect(PHASES.length).toBeGreaterThan(0);

  for (const name of PHASES) {
    const rendered = await render(name);
    expect({
      name,
      unresolved: [...rendered.matchAll(PLACEHOLDER)].map((m) => m[0]),
    }).toEqual({
      name,
      unresolved: [],
    });
  }
}, SPAWN_BUDGET_MS);

it("the discipline page names no placeholder, since no tick renders it", async () => {
  const raw = await readFile(promptPath("plan-discipline"), "utf8");
  expect(raw.length).toBeGreaterThan(0);
  expect([...raw.matchAll(PLACEHOLDER)].map((m) => m[0])).toEqual([]);
});

it("every plan slice the package declares points its reader at the discipline page", async () => {
  // The roster is read off the declaration, not filtered out of PHASES by
  // name: a slice named off-prefix would leave the judged set silently, and
  // the non-vacuity pin below counts a subset as happily as the whole
  // (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
  expect(PLAN_SLICES.length).toBeGreaterThan(0);

  // Each one sends its reader there by the address the package resolves,
  // rather than by a path spelled in the markdown.
  for (const name of PLAN_SLICES) {
    expect({
      name,
      points: (await render(name)).includes(promptPath("plan-discipline")),
    }).toEqual({
      name,
      points: true,
    });
  }
}, SPAWN_BUDGET_MS);

// ---------------------------------------------------------------- odd roots

/**
 * The artifacts the slice prompts' spans read, each addressed through the
 * module that owns its path rather than through a layout spelled here: the
 * queue's absolute form is the engine's resolver and the plan state's is
 * `layout.ts`'s, with every other plan artifact's. The questions directory is
 * not among them — it is listed by the package rather than opened by a span,
 * and the cases at the end of this file judge that render.
 * A sentinel rides each body so a case
 * asserts the bytes *arrived*, not merely that the render did not throw — a
 * span whose guard mis-fired would render its placeholder over a readable
 * artifact and look identical from the outside.
 *
 * `placeholder` is what the span renders when the artifact is legitimately
 * absent; an artifact carrying none refuses on absence instead, which the
 * unguarded-span cases below pin.
 */
const ARTIFACTS: ReadonlyArray<{
  readonly key: PromptArg;
  readonly at: (root: string, prompt: HarnessPhase) => string | undefined;
  /**
   * Where the sentinel bytes are written, when that is not the path a span
   * opens. The queue is a directory (`spec/pending.md`, *The ledger is a
   * directory — one entry per file*): the span opens the directory and a case
   * damages *it*, while the bytes that prove arrival live in an entry file
   * under it. Every other artifact is a file, where the two coincide.
   */
  readonly seedAt?: (root: string, prompt: HarnessPhase) => string | undefined;
  readonly body: string;
  readonly sentinel: string;
  readonly placeholder?: string;
}> = [
  {
    key: "PENDING_DIR",
    at: (root) => resolvePendingDir(root),
    seedAt: (root) => join(resolvePendingDir(root), "SENTINEL-TAG.json"),
    body: '{ "note": "PENDING-SENTINEL" }\n',
    sentinel: "PENDING-SENTINEL",
  },
  {
    // One file per writing slice, so this artifact's path is the *prompt's*
    // own: a case damaging it damages the file that prompt opens, and a
    // prompt with no state file of its own (build's) has none to damage
    // (`spec/harness.md`, *Plan state as declared state*).
    key: "PLAN_STATE_PATH",
    at: (root, prompt) =>
      isPlanSlice(prompt) ? planStatePath(root, prompt) : undefined,
    body: '{ "note": "PLAN-STATE-SENTINEL" }\n',
    sentinel: "PLAN-STATE-SENTINEL",
    placeholder: "(no plan state yet)",
  },
];

/** An argument the package supplies to a prompt — shared, or a slice's own. */
type PromptArg = SharedPromptArg | PlanSlicePromptArg;

/**
 * Every path an artifact sits at across the whole roster — one for a shared
 * artifact, one per plan slice for a per-slice one. Deduplicated, since a
 * shared artifact answers the same path for every prompt.
 */
const pathsOf = (
  artifact: (typeof ARTIFACTS)[number],
  root: string,
): string[] => [
  ...new Set(
    PHASES.map((name) => (artifact.seedAt ?? artifact.at)(root, name)).filter(
      (at): at is string => at !== undefined,
    ),
  ),
];

/** A scratch state root carrying every artifact above, torn down at the end. */
async function seed(root: string): Promise<string> {
  oddRoots.push(root);
  for (const artifact of ARTIFACTS) {
    for (const at of pathsOf(artifact, root)) {
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, artifact.body, "utf8");
    }
  }
  return root;
}

/** Whether any inline-exec span in `raw` substitutes `key` into its command. */
function spanSubstitutes(raw: string, key: PromptArg): boolean {
  return [...raw.matchAll(SPAN)].some((m) => m[1]!.includes(`{{${key}}}`));
}

/**
 * Which prompts of a roster substitute each artifact's path — the detector
 * the coverage pins and the render loops all read, rather than one
 * re-deriving it beside the other (`.claude/rules/engineering.md`, *The fix
 * lands at the mechanism*).
 *
 * The roster is a parameter because the cases below judge different ones: the
 * odd-root loop renders every shipped prompt, while the guarded-span cases
 * render the plan slices alone, and a count taken over all of `PHASES` cannot
 * tell a plan slice that stopped reading an artifact from
 * `harness/prompts/build.md` never having read it.
 */
async function promptsReadingEachArtifact(
  roster: readonly HarnessPhase[] = PHASES,
): Promise<ReadonlyMap<PromptArg, HarnessPhase[]>> {
  const readers = new Map<PromptArg, HarnessPhase[]>(
    ARTIFACTS.map((a) => [a.key, []]),
  );
  for (const name of roster) {
    const raw = await readFile(promptPath(name), "utf8");
    for (const artifact of ARTIFACTS) {
      if (spanSubstitutes(raw, artifact.key))
        readers.get(artifact.key)!.push(name);
    }
  }
  return readers;
}

/**
 * A table's own coverage, per artifact rather than in aggregate: an entry
 * whose detector stops matching any span leaves every loop below silently,
 * and a total count cannot tell that from a table that shrank
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 *
 * `over` is the slice of the table the calling case actually renders, so a
 * case keyed on the guarded artifacts is not answered by an unguarded one
 * still being read.
 */
function expectEveryArtifactRead(
  readers: ReadonlyMap<PromptArg, HarnessPhase[]>,
  over: ReadonlyArray<(typeof ARTIFACTS)[number]> = ARTIFACTS,
): void {
  expect(over.length).toBeGreaterThan(0);
  expect(
    over.filter((a) => readers.get(a.key)!.length === 0).map((a) => a.key),
  ).toEqual([]);
}

/**
 * How many (prompt, artifact) pairs a loop over `roster` x `over` is supposed
 * to assert — the expected count the guarded cases close on, read off the same
 * detector the loop itself skips by.
 */
function pairsToAssert(
  readers: ReadonlyMap<PromptArg, HarnessPhase[]>,
  over: ReadonlyArray<(typeof ARTIFACTS)[number]>,
): number {
  return over.reduce((n, a) => n + readers.get(a.key)!.length, 0);
}

it("every artifact in the harness prompt odd-root table is read by at least one shipped prompt", async () => {
  expectEveryArtifactRead(await promptsReadingEachArtifact());
});

/**
 * Every shipped prompt rendered against a state root whose path is awkward in
 * a shell, asserting each span's artifact actually reached the text.
 *
 * The seam is the prompt author's quoting against the engine's substitution
 * (`spec/prompt.md`, *The render pipeline*): the engine hands a value over as
 * shell text and quotes nothing, so an unquoted `{{PATH}}` word-splits on a
 * space and loses a backslash before `sh` ever opens the file.
 */
async function everyPromptReadsItsArtifactsUnder(root: string): Promise<void> {
  await seed(root);

  const readers = await promptsReadingEachArtifact();
  expectEveryArtifactRead(readers);

  for (const name of PHASES) {
    const reads = ARTIFACTS.filter((a) => readers.get(a.key)!.includes(name));
    if (reads.length === 0) continue;
    const rendered = await render(name, root);
    for (const artifact of reads) {
      expect({
        name,
        key: artifact.key,
        read: rendered.includes(artifact.sentinel),
      }).toEqual({ name, key: artifact.key, read: true });
    }
  }
}

it("every package prompt's spans read their artifacts under a state root path carrying a space", async () => {
  const root = await mkTempDir("flume prompts space-");
  expect(root).toContain(" ");

  await everyPromptReadsItsArtifactsUnder(root);
}, SPAWN_BUDGET_MS);

it("every package prompt's spans read their artifacts under a state root path carrying a backslash", async () => {
  const base = await mkTempDir("flume-prompts-backslash-");
  // On win32 the separator *is* the backslash — every state root there is
  // this case, which is where the defect was measured. Elsewhere a backslash
  // is an ordinary filename byte, and the same byte reaches `sh`.
  const root = process.platform === "win32" ? base : join(base, "back\\slash");
  oddRoots.push(base);
  await mkdir(root, { recursive: true });
  expect(root).toContain("\\");

  await everyPromptReadsItsArtifactsUnder(root);
}, SPAWN_BUDGET_MS);

// ------------------------------------------------- guarded spans: the fork

/**
 * The two artifacts whose spans carry a legitimate absence — a first tick,
 * before any slice has written them. Read off the table rather than named
 * again, so an artifact that gains or loses its placeholder moves both the
 * refusal cases and the pins below with it.
 */
const GUARDED = ARTIFACTS.filter(
  (a): a is (typeof ARTIFACTS)[number] & { placeholder: string } =>
    a.placeholder !== undefined,
);

/**
 * The rest of the table: the artifacts whose spans have no absent case, so
 * absence is a failure the render is supposed to refuse on. Taken as the
 * complement rather than named, so an artifact that gains a placeholder
 * leaves this set — and reds the case keyed on it — instead of quietly
 * keeping a refusal nothing asserts any more.
 */
const UNGUARDED = ARTIFACTS.filter((a) => a.placeholder === undefined);

/** A scratch state root, torn down with the rest at the end of the file. */
async function scratchRoot(prefix: string): Promise<string> {
  const root = await mkTempDir(prefix);
  oddRoots.push(root);
  return root;
}

/**
 * A state root as a first tick finds it: nothing a guarded span reads has
 * been written. The unguarded artifacts are seeded even so — absence refuses
 * there (pinned below), and the refusal would pre-empt the render before any
 * guarded span had put a placeholder in it to assert.
 */
async function coldRoot(prefix: string): Promise<string> {
  const root = await scratchRoot(prefix);
  for (const artifact of ARTIFACTS) {
    if (artifact.placeholder !== undefined) continue;
    for (const at of pathsOf(artifact, root)) {
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, artifact.body, "utf8");
    }
  }
  return root;
}

/** One render's outcome, as a value both branches can be asserted against. */
async function outcomeOf(
  name: HarnessPhase,
  root: string,
): Promise<{ rendered: string } | { error: unknown }> {
  return render(name, root).then(
    (rendered) => ({ rendered }),
    (error: unknown) => ({ error }),
  );
}

/**
 * That a placeholder is the *whole* content of the block it stands in —
 * asserted as a line directly under an opening tag, so a placeholder
 * appearing anywhere else in the render cannot stand in for it.
 */
function placeholderIsBlockContent(
  rendered: string,
  placeholder: string,
  label: string,
): void {
  const lines = rendered.split("\n").map((l) => l.trimEnd());
  const at = lines.indexOf(placeholder);
  expect(at, `${label}: no line renders ${placeholder}`).toBeGreaterThan(0);
  expect(
    lines[at - 1],
    `${label}: the placeholder is not the block's content`,
  ).toMatch(/^<[a-z-]+>$/);
}

/**
 * What a case does to an artifact before the render opens it, named so the
 * assertions below read the same for every way of breaking one.
 */
interface Damage {
  /** The state, as the failure messages say it: "an absent PENDING_DIR". */
  readonly says: string;
  readonly apply: (at: string) => Promise<void>;
}

/**
 * The wrong kind in place — a directory where the span opens a file. A
 * permission-denied would read the same on posix and be a no-op on win32, so
 * it is not the case a portable suite can drive.
 */
const WRONG_KIND: Damage = {
  says: "an unreadable",
  apply: async (at) => {
    await rm(at, { recursive: true, force: true });
    await mkdir(at, { recursive: true });
  },
};

/** Nothing in place at all — the state a first tick leaves behind. */
const NOTHING: Damage = {
  says: "an absent",
  apply: async (at) => {
    await rm(at, { recursive: true, force: true });
    expect(existsSync(at), `${at} is absent`).toBe(false);
  },
};

/**
 * `.claude/rules/engineering.md`, *Loud or nothing*, over one span whose
 * artifact a case has broken.
 *
 * Driven through the real renderer over the shipped markdown
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*): the claim is what `sh` does with the bytes the prompt ships once the
 * real substituter has put a real path into them.
 *
 * Every plan slice is rendered, and each one's verdict is the one its own
 * spans entail: a slice that opens the artifact refuses on it, and a slice
 * that does not open it renders — the second half is what keeps the roster
 * honest rather than silently narrowing to the slices that happen to read.
 *
 * Which states are supposed to refuse is the caller's, since that is what
 * differs between a guarded span and an unguarded one; how a refusal is
 * recognised is here, once (`.claude/rules/engineering.md`, *The fix lands at
 * the mechanism*).
 */
async function eachSliceVerdictFollowsItsSpansOn(
  artifact: (typeof ARTIFACTS)[number],
  damage: Damage,
): Promise<void> {
  // Non-vacuity: a roster that collapsed to zero would pass the loop below over
  // nothing (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*).
  expect(PLAN_SLICES.length).toBeGreaterThan(0);

  const key = artifact.key;
  let refused = 0;
  for (const name of PLAN_SLICES) {
    const raw = await readFile(promptPath(name), "utf8");
    const root = await seed(await scratchRoot(`flume-prompts-${key}-`));
    // This prompt's own copy of the artifact, which for a per-slice one is the
    // only file its spans open — a sibling slice's stays readable, which is
    // what makes the verdict below this prompt's spans and not the root's.
    const path = artifact.at(root, name);
    expect(path, `${name}: ${key} names a path`).toBeDefined();
    await damage.apply(path!);

    const outcome = await outcomeOf(name, root);

    if (!spanSubstitutes(raw, key)) {
      expect(
        { name, opens: false, resolved: "rendered" in outcome },
        `${name}: opens no ${key} span, so nothing of its own can refuse on it`,
      ).toEqual({ name, opens: false, resolved: true });
      continue;
    }

    refused++;
    expect(
      outcome,
      `${name}: the render resolved over ${damage.says} ${key}`,
    ).not.toHaveProperty("rendered");
    const error = (outcome as { error: unknown }).error;
    expect(error).toBeInstanceOf(InlineExecRenderError);
    const failures = (error as InlineExecRenderError).failures;
    // This artifact's span is the one failure — its siblings all resolve.
    expect(failures.map((f) => f.cmd)).toEqual([expect.stringContaining(path!)]);
    // Loud, not merely non-zero: the reader's own complaint survived to the
    // failure record rather than being sent to `/dev/null`.
    expect(
      failures[0]!.stderr.trim(),
      `${name}: the refusal is silent`,
    ).not.toBe("");
  }

  // Non-vacuity: a prompt set that stopped opening this artifact anywhere
  // would take the `opens: false` branch every time and assert no refusal.
  expect(refused).toBeGreaterThan(0);
}

/**
 * Absence is legitimate on a guarded artifact, so its span cannot simply
 * refuse — it has to split the fork: absent takes the placeholder, a *failed
 * read* reaches the renderer. A trailing `|| echo` answered both with the
 * same bytes, and a plan slice re-derived the queue against prose saying it
 * could not see its own state.
 */
async function everySliceOverWrongKindAt(key: PromptArg): Promise<void> {
  const artifact = GUARDED.find((a) => a.key === key);
  expect(artifact, `${key} is a guarded artifact`).toBeDefined();
  await eachSliceVerdictFollowsItsSpansOn(artifact!, WRONG_KIND);
}

it("each plan slice prompt's verdict on a plan state directory in place follows whether its spans read that artifact", async () => {
  await everySliceOverWrongKindAt("PLAN_STATE_PATH");
}, SPAWN_BUDGET_MS);

/**
 * Every plan slice is shown the file it stamps. Plan state is one file per
 * writer (`spec/harness.md`, *Plan state as declared state*), and a slice
 * writes that file whole — so a slice whose prompt names the path without
 * opening it is asked to carry forward a value it was never handed, and the
 * fields it does not re-stamp this tick leave the artifact silently.
 *
 * Read off the same detector the odd-root and guarded-span loops skip by,
 * over the whole roster rather than the slices that happen to read: the
 * table's own coverage pin is satisfied by *one* reader, which cannot tell a
 * slice that never opened its state from one that stopped.
 */
it("every plan slice prompt opens a span on the plan state file it owns", async () => {
  // Non-vacuity: an empty roster would pass the filter below over nothing
  // (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
  expect(PLAN_SLICES.length).toBeGreaterThan(0);

  const blind: string[] = [];
  for (const name of PLAN_SLICES) {
    const raw = await readFile(promptPath(name), "utf8");
    if (!spanSubstitutes(raw, "PLAN_STATE_PATH")) blind.push(name);
  }
  expect(
    blind,
    `plan slices whose prompt reads no plan state: ${blind.join(", ")}`,
  ).toEqual([]);
});

/**
 * The inbox slice's half of that, driven rather than detected: its state is
 * the one that is a per-lane map rather than a cursor, so what it must carry
 * forward is every lane it is *not* stamping this tick.
 */
it("the inbox slice's prompt renders the plan state its own file holds", async () => {
  const root = await seed(await scratchRoot("flume-prompts-inbox-state-"));
  // The package's own writer over the slice's own path, never bytes by hand:
  // the claim is that what a slice stamped is what its next tick is shown, so
  // both ends of the seam are the real ones
  // (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
  // wrote*). Every sibling's state file is seeded too, so a render that
  // reached one of those reads back as a different string rather than as a
  // missing substring.
  writePlanState(root, INBOX_PHASE, {
    drainedRuns: {
      "inbox-own-lane": { run: "INBOX-OWN-STAMP", titles: ["a red title"] },
    },
  });
  const mine = await readFile(planStatePath(root, INBOX_PHASE), "utf8");
  // Non-vacuity: an empty stamp would be matched by an empty block
  // (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
  expect(mine).toContain("INBOX-OWN-STAMP");

  const rendered = await render(INBOX_PHASE, root);
  const block = /<plan-state>\n([\s\S]*?)\n<\/plan-state>/.exec(rendered)?.[1];
  expect(block?.trimEnd()).toBe(mine.trimEnd());
}, SPAWN_BUDGET_MS);

// --------------------------------------------- unguarded spans: no fork

/**
 * An unguarded span has no fork to split: the package's choice is that
 * absence here is not a tick to proceed with — a plan slice re-deriving the
 * queue without having read it would write over work it never saw.
 *
 * That choice is only real while a bare reader carries it. A guard, a
 * placeholder or a `|| echo` fallback on the span would let the render
 * resolve and hand the slice a prompt that reads as an empty queue — which
 * is what the example chain legitimately chooses (`tests/examples.test.ts`)
 * and the package does not.
 */
async function everySliceOverAbsentArtifactAt(
  key: PromptArg,
): Promise<void> {
  const artifact = UNGUARDED.find((a) => a.key === key);
  expect(artifact, `${key} is an unguarded artifact`).toBeDefined();
  await eachSliceVerdictFollowsItsSpansOn(artifact!, NOTHING);
}

it("each plan slice prompt's verdict on an absent queue follows whether its spans read that artifact", async () => {
  await everySliceOverAbsentArtifactAt("PENDING_DIR");
}, SPAWN_BUDGET_MS);

/**
 * The other end of that refusal, from a consumer's side: adoption seeds the
 * queue (`spec/harness.md`, *Adoption and upgrade*), so the first tick a
 * fresh repository can take renders instead of walling on the artifact above.
 *
 * The writer is the real `harnessInit` over a real temporary repository — no
 * fixture queue by the tester's hand, which is the whole claim: whatever
 * adoption seeds is what a slice's span reads, and the two move together.
 */
it("a state root flume-harness init just wrote renders every plan slice prompt's queue span", async () => {
  expect(PLAN_SLICES.length).toBeGreaterThan(0);
  const adopted = await scratchRoot("flume-prompts-adopted-");
  const result = await harnessInit({ repoRoot: adopted });
  const root = join(adopted, result.stateRoot);

  for (const name of PLAN_SLICES) {
    const raw = await readFile(promptPath(name), "utf8");
    // Non-vacuity: a slice that stopped opening the queue would render clean
    // below while proving nothing about what adoption wrote.
    expect(
      spanSubstitutes(raw, "PENDING_DIR"),
      `${name}: opens no PENDING_DIR span`,
    ).toBe(true);

    // The seeded directory arrived as the block's content — an empty queue
    // the slice can read, not a render that merely failed to throw. Seeded
    // empty by construction (`harness/init.ts` writes only the `.gitkeep`),
    // so the span's own empty reading is what has to land.
    const rendered = await render(name, root);
    expect(rendered, `${name}: the seeded queue did not reach the prompt`).toMatch(
      /^\(queue empty\)$/m,
    );
  }
}, SPAWN_BUDGET_MS);

/**
 * The other side of that fork, and the reason the guard is not a bare
 * refusal: a cold state root is a first tick, not a defect.
 */
it("every guarded artifact the cold-root case renders is substituted by at least one plan slice prompt", async () => {
  expectEveryArtifactRead(
    await promptsReadingEachArtifact(PLAN_SLICES),
    GUARDED,
  );
});

it("a cold state root renders every plan slice prompt's placeholder as its block's whole content", async () => {
  expect(PLAN_SLICES.length).toBeGreaterThan(0);
  const root = await coldRoot("flume-prompts-cold-root-");
  for (const artifact of GUARDED) {
    // Every path it sits at across the roster, since a per-slice artifact is
    // one file per plan slice and a cold root has written none of them.
    for (const at of pathsOf(artifact, root)) {
      expect({ at, exists: existsSync(at) }).toEqual({ at, exists: false });
    }
  }

  // The skip below and the count that closes the loop read one detector, so a
  // guarded artifact no plan slice substitutes reds here rather than dropping
  // out of both (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*).
  const readers = await promptsReadingEachArtifact(PLAN_SLICES);
  expectEveryArtifactRead(readers, GUARDED);

  let asserted = 0;
  for (const name of PLAN_SLICES) {
    const rendered = await render(name, root);
    for (const artifact of GUARDED) {
      if (!readers.get(artifact.key)!.includes(name)) continue;
      placeholderIsBlockContent(
        rendered,
        artifact.placeholder,
        `${name}/${artifact.key}`,
      );
      // Nothing was read, so nothing the artifact would have carried leaked.
      expect(rendered).not.toContain(artifact.sentinel);
      asserted++;
    }
  }

  // Every (slice, guarded artifact) pair the detector found was asserted, and
  // the coverage above makes that count non-zero.
  expect(asserted).toBe(pairsToAssert(readers, GUARDED));
}, SPAWN_BUDGET_MS);

// ------------------------------------------------ the questions directory

/**
 * The questions block of one rendered prompt: the lines between its tags,
 * trailing whitespace trimmed.
 *
 * Read as the whole block rather than searched for a substring: what the
 * slice is shown is exactly the open set, and a case asserting only that a
 * path appears somewhere would pass over a block that also claims nothing is
 * open (`.claude/rules/posture-sweep.md`, *A violation counts only when
 * verified on disk this tick*).
 */
function questionsBlock(rendered: string, label: string): string[] {
  const lines = rendered.split("\n").map((l) => l.trimEnd());
  const open = lines.indexOf("<open-questions-index>");
  expect(open, `${label}: no questions block in the render`).toBeGreaterThan(-1);
  const close = lines.indexOf("</open-questions-index>", open);
  expect(close, `${label}: the questions block does not close`).toBeGreaterThan(
    open,
  );
  return lines.slice(open + 1, close);
}

/**
 * Which plan slices carry the questions block, off the same placeholder the
 * renderer substitutes — the detector every case below skips and closes on,
 * so a slice that stopped carrying the block reds rather than dropping out of
 * the loop (`.claude/rules/engineering.md`, *A green verdict is proven
 * non-vacuous*).
 */
async function slicesCarryingQuestions(): Promise<PlanSlice[]> {
  const carrying: PlanSlice[] = [];
  for (const name of PLAN_SLICES) {
    const raw = await readFile(promptPath(name), "utf8");
    if (raw.includes("{{QUESTIONS_INDEX}}")) carrying.push(name);
  }
  expect(carrying.length, "no plan slice carries the questions block").toBe(
    PLAN_SLICES.length,
  );
  return carrying;
}

/**
 * Presence is the state, so the index is the listing
 * (`spec/harness.md`, *Records as one file each*). No slice greps a heading
 * out of a page, and two sessions opening two questions write two files that
 * never conflict — which is only true while the block is the directory.
 *
 * The real writer is `renderQuestions` over a real directory and the real
 * reader is the engine's renderer over the shipped markdown
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
it("a plan slice's questions span lists one file per open question", async () => {
  const root = await scratchRoot("flume-prompts-questions-");
  // The queue, because an absent one refuses the render before the questions
  // block is reached.
  for (const artifact of UNGUARDED) {
    for (const at of pathsOf(artifact, root)) {
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, artifact.body, "utf8");
    }
  }

  // Under the directory the package names, composed the way the listing
  // composes it — one constant, host-native on both sides — and written out
  // of name order, so the listing's own sort is what the block is judged on.
  const dir = join(root, QUESTIONS_DIR_REL);
  await mkdir(dir, { recursive: true });
  const names = [
    `which-fence-holds${QUESTION_EXT}`,
    `a-parked-fork${QUESTION_EXT}`,
    // Not a question: presence states an *open question*, and a directory
    // holder is not one.
    ".gitkeep",
  ];
  for (const name of names) {
    await writeFile(join(dir, name), `# ${name}\n`, "utf8");
  }
  const open = [
    join(dir, `a-parked-fork${QUESTION_EXT}`),
    join(dir, `which-fence-holds${QUESTION_EXT}`),
  ];

  const carrying = await slicesCarryingQuestions();
  let asserted = 0;
  for (const name of carrying) {
    const rendered = await render(name, root);
    expect(questionsBlock(rendered, name)).toEqual(open);
    asserted++;
  }
  expect(asserted).toBe(carrying.length);
}, SPAWN_BUDGET_MS);

/**
 * The other side of it: nothing open is a directory with no files in it, and
 * a consumer that has never opened one has no directory at all. Both are one
 * fact, and neither is a render that refuses — a first tick is not a defect.
 */
it("an absent questions directory renders the slices' none-open placeholder", async () => {
  const root = await coldRoot("flume-prompts-no-questions-");
  expect(existsSync(join(root, QUESTIONS_DIR_REL))).toBe(false);

  // The placeholder the package produces, never one spelled here: a rename of
  // it moves this case with it rather than stranding a literal.
  expect(renderQuestions(root)).toBe(NONE_OPEN);

  const carrying = await slicesCarryingQuestions();
  let asserted = 0;
  for (const name of carrying) {
    const rendered = await render(name, root);
    expect(questionsBlock(rendered, name)).toEqual([NONE_OPEN]);
    asserted++;
  }
  expect(asserted).toBe(carrying.length);
}, SPAWN_BUDGET_MS);

/**
 * The absence arm's other half: only a *proven* absence renders the
 * placeholder (`harness/dirListing.ts`). A plain file above the questions
 * directory is spelled `ENOENT` on win32 and `ENOTDIR` on posix
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*), so a listing keying its silent arm on the
 * errno tells a plan tick "(none open)" over questions it could not see on
 * exactly one host — and reds on neither
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * The parent is denied on purpose, which that same page admits for this one
 * reader: the descent is exercised by an obstructed *ancestor* and by
 * nothing else. A plain file denies structurally, so this runs on every host
 * rather than riding `chmod`, which denies nothing on win32.
 */
it("renderQuestions refuses when a plain file sits above the questions directory", async () => {
  const root = await scratchRoot("flume-prompts-obstructed-questions-");
  const dir = join(root, QUESTIONS_DIR_REL);
  const above = dirname(dir);
  const question = join(dir, `a-parked-fork${QUESTION_EXT}`);
  await mkdir(dir, { recursive: true });
  await writeFile(question, "# a parked fork\n", "utf8");

  // The reading the obstruction has to change: one question, open and
  // listed. Without it the refusal below could be any root at all.
  expect(renderQuestions(root)).toBe(question);

  await rm(above, { recursive: true, force: true });
  await writeFile(above, "obstruction\n", "utf8");

  let message: string | undefined;
  try {
    renderQuestions(root);
  } catch (error) {
    message = (error as Error).message;
  }
  // By name — the rung an operator has to go fix, not the leaf that was
  // asked for, and not the none-open line.
  expect(
    message,
    "the obstructed ancestor read as a questions directory with nothing in it",
  ).toBe(
    `[flume] questions dir is unreadable: ${above} is present but is not a directory`,
  );
});

/**
 * The migration leg the 0.17 line carried is spent
 * (`docs/MIGRATING-0.17.md`): the page that preceded the directory is no
 * longer a thing the render knows, so it states what the directory says and
 * nothing else. A consumer who never drained the page reads "nothing open"
 * from a state root that still holds it, which is the cost the retirement
 * names — and what keeps this render from carrying a cutover forever
 * (`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*).
 *
 * Spelled as a literal because nothing in the package addresses the page any
 * more, which is the property this case is here for.
 */
it("a state root carrying the legacy open-questions page renders the none-open line", async () => {
  const root = await coldRoot("flume-prompts-legacy-questions-");
  const page = join(root, "plan", "open-questions.md");
  await mkdir(dirname(page), { recursive: true });
  await writeFile(page, "# Open questions\n\n## A parked fork\n", "utf8");
  // The reading the case turns on: the page really is on disk, so the
  // none-open line below is the render ignoring it rather than a fixture that
  // wrote nothing.
  expect(existsSync(page)).toBe(true);
  expect(existsSync(join(root, QUESTIONS_DIR_REL))).toBe(false);

  // The placeholder the package produces, never one spelled here.
  expect(renderQuestions(root)).toBe(NONE_OPEN);

  const carrying = await slicesCarryingQuestions();
  let asserted = 0;
  for (const name of carrying) {
    expect(questionsBlock(await render(name, root), name)).toEqual([NONE_OPEN]);
    asserted++;
  }
  expect(asserted).toBe(carrying.length);
}, SPAWN_BUDGET_MS);

// ------------------------------------------------- the invocation boundary

/**
 * The turn boundary reaches every phase prompt from the one home that holds
 * it, asserted at both ends of the seam: each shipped prompt names the
 * placeholder, and the real renderer over the real `sharedPromptArgs` puts
 * the arg's bytes into the text.
 *
 * What the sentence *says* is not judged here — prose read against prose is
 * not this suite's (`.claude/rules/engineering.md`, *Narration is the
 * ladder's bottom rung*). What is judged is the mechanical half that prose
 * cannot hold: a phase added without the arg, or an arg this module stops
 * supplying, leaves a prompt silent about the boundary that kills its work.
 */
it("every phase prompt the package renders substitutes the shared turn-boundary arg", async () => {
  // Non-vacuity: a phase list that collapsed to zero would pass the loop
  // below over nothing (`.claude/rules/engineering.md`, *A green verdict is
  // proven non-vacuous*).
  expect(PHASES.length).toBeGreaterThan(0);

  // The producer's value, read from the producer — an empty one would make
  // every `carries` assertion below trivially true.
  for (const name of PHASES) {
    // The producer's value, read from the producer — an empty one would make
    // the `carries` assertion below trivially true.
    const boundary = args(name)["TURN_BOUNDARY"];
    expect(boundary, "the shared args supply no TURN_BOUNDARY").toBeDefined();
    expect(boundary!.trim()).not.toBe("");

    const raw = await readFile(promptPath(name), "utf8");
    const rendered = await render(name);
    expect({
      name,
      names: raw.includes("{{TURN_BOUNDARY}}"),
      carries: rendered.includes(boundary!),
    }).toEqual({ name, names: true, carries: true });
  }
}, SPAWN_BUDGET_MS);

/**
 * The put-down statement reaches every phase prompt from the one home that
 * holds it, at both ends of the seam like the boundary above — and, unlike
 * it, carrying a value that is the rendering phase's own: the thresholds are
 * shared, the act each phase puts down is not.
 *
 * What the sentence *says* is not judged here. What is judged is the
 * mechanical half: a phase added without the placeholder reads no thresholds
 * at all, and a phase rendering a sibling's act is told to close a tick it is
 * not running.
 */
it("every phase prompt the package renders substitutes its own put-down statement", async () => {
  expect(PHASES.length).toBeGreaterThan(0);

  const statements = new Set<string>();
  for (const name of PHASES) {
    const statement = args(name)["PUT_DOWN"];
    expect(statement, "the shared args supply no PUT_DOWN").toBeDefined();
    expect(statement!.trim()).not.toBe("");
    statements.add(statement!);

    const raw = await readFile(promptPath(name), "utf8");
    const rendered = await render(name);
    expect({
      name,
      names: raw.includes("{{PUT_DOWN}}"),
      carries: rendered.includes(statement!),
    }).toEqual({ name, names: true, carries: true });
  }

  // One per phase, never one value handed to all of them: a `Record` keyed by
  // phase whose arms had converged would pass every assertion above.
  expect(statements.size).toBe(PHASES.length);
}, SPAWN_BUDGET_MS);

/**
 * The entries a build tick is carrying reach every producer's prompt, from
 * the engine's own report of them (`TickContext.claimed`, `src/Phase.ts`;
 * `spec/pending.md`, *Claims — an entry in flight is left alone*).
 *
 * An agreement gate like the rest of this file: the real
 * `planSlicePromptArgs` over the real shipped markdown through the engine's
 * real renderer. What the block *says* is not judged — prose against prose is
 * not this suite's — but that a slice renders the tags it was handed, and
 * renders nothing at all when none are in flight, is the mechanical half
 * prose cannot hold.
 */
it("every plan slice prompt renders the claimed entries the tick reported", async () => {
  // Non-vacuity: a roster that collapsed to zero would pass the loop below
  // over nothing (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*).
  expect(PLAN_SLICES.length).toBeGreaterThan(0);

  for (const name of PLAN_SLICES) {
    const raw = await readFile(promptPath(name), "utf8");
    const rendered = await render(name, stateRoot, ["ONE-IN-FLIGHT", "TWO"]);
    expect({
      name,
      names: raw.includes("{{CLAIMED_ENTRIES}}"),
      one: rendered.includes("`ONE-IN-FLIGHT`"),
      two: rendered.includes("`TWO`"),
    }).toEqual({ name, names: true, one: true, two: true });
  }
}, SPAWN_BUDGET_MS);

/** Two entries in the queue, one of which a case hands over as claimed. */
const HELD_TAG = "HELD-BY-A-BUILD-TICK";
const FREE_TAG = "FREE-FOR-THE-TAKING";

/**
 * A state root whose queue carries both tags above — one file each, named by
 * the engine's own rule rather than by a `.json` spelled here
 * (`entryFileName`, `src/PendingSchema.ts`), since the listing's span keys
 * its mark off exactly that name.
 *
 * Two entries, because the claim is per entry: a listing holding only the
 * claimed one would pass a mark that rode every line.
 */
async function queueRoot(prefix: string): Promise<string> {
  const root = await scratchRoot(prefix);
  const dir = resolvePendingDir(root);
  await mkdir(dir, { recursive: true });
  for (const tag of [HELD_TAG, FREE_TAG]) {
    await writeFile(join(dir, entryFileName(tag)), `{ "tag": "${tag}" }\n`);
  }
  return root;
}

/**
 * Every header line the queue listing's span printed, sorted — the span is
 * the only thing in a plan slice's render that opens a line this way, and
 * sorted because the order is the shell's glob collation, not a claim.
 *
 * Read as lines rather than as a substring of the whole render: a mark
 * asserted over the entire artifact turns on whatever else it quotes, while
 * the property under test is which *line* carries it
 * (`.claude/rules/posture-sweep.md`, *Standing lenses*).
 */
const queueHeaders = (rendered: string): string[] =>
  rendered
    .split("\n")
    .filter((line) => line.startsWith("=== "))
    .sort();

it("a plan slice's queue listing marks an entry a build tick holds at that entry's own line", async () => {
  const root = await queueRoot("flume-prompts-in-flight-");
  expect(PLAN_SLICES.length).toBeGreaterThan(0);

  for (const name of PLAN_SLICES) {
    const rendered = await render(name, root, [HELD_TAG]);
    // Both lines named, so the assertion carries its own non-vacuity: a
    // listing that rendered nothing at all answers neither of them
    // (`.claude/rules/engineering.md`, *A green verdict is proven
    // non-vacuous*).
    expect({ name, headers: queueHeaders(rendered) }).toEqual({
      name,
      headers: [
        `=== ${entryFileName(FREE_TAG)}`,
        `=== ${entryFileName(HELD_TAG)} [in flight]`,
      ].sort(),
    });
  }
}, SPAWN_BUDGET_MS);

it("a plan slice tick with nothing in flight renders no in-flight mark and no claimed block", async () => {
  const root = await queueRoot("flume-prompts-quiet-queue-");
  expect(PLAN_SLICES.length).toBeGreaterThan(0);

  for (const name of PLAN_SLICES) {
    // The producer's own empty answer, so the assertion is about what the
    // renderer put in the file rather than about a value this case invented.
    expect(args(name, root, [])["CLAIMED_ENTRIES"]).toBe("");
    expect(args(name, root, [])["CLAIMED_TAGS"]).toBe("");
    const rendered = await render(name, root);
    expect({
      name,
      headers: queueHeaders(rendered),
      block: rendered.includes("<in-flight>"),
    }).toEqual({
      name,
      headers: [
        `=== ${entryFileName(FREE_TAG)}`,
        `=== ${entryFileName(HELD_TAG)}`,
      ].sort(),
      block: false,
    });
  }
}, SPAWN_BUDGET_MS);

/**
 * Every value a rendered shape leaves for the agent to fill, filled with one
 * that every field the shapes carry accepts — a full object name is a
 * cursor, a run identity, a covered path and a title alike — so the schema
 * judges the shape's keys and kinds rather than the placeholders' spelling.
 */
function filled(value: unknown): unknown {
  const FILL = "0123456789abcdef0123456789abcdef01234567";
  const isHole = (text: string) => /^<[^<>]+>$/.test(text);
  if (typeof value === "string") return isHole(value) ? FILL : value;
  if (Array.isArray(value)) return value.map(filled);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        isHole(key) ? "lane" : key,
        filled(inner),
      ]),
    );
  }
  return value;
}

/**
 * The shape each plan slice's prompt shows for its own state file is one the
 * slice-state gate's schema accepts (`spec/harness.md`, *Plan state as declared
 * state*).
 *
 * An agreement gate: the real `planSlicePromptArgs` through the engine's real
 * renderer over the shipped markdown, and every arm the block carries read
 * back through the real `PLAN_STATE_SCHEMAS`. A slice with no file of its own
 * yet has nothing on disk to copy the shape from, so the prompt is the whole
 * statement of it — and a rotation the prose called "closed" was written as
 * the bare string, which the schema refuses and the tick reverted over.
 */
it("every plan slice prompt renders its state file's shape as JSON its schema accepts", async () => {
  expect(PLAN_SLICES.length).toBeGreaterThan(0);

  for (const name of PLAN_SLICES) {
    const rendered = await render(name);
    const block = /<plan-state-shape>\n([\s\S]*?)\n<\/plan-state-shape>/.exec(
      rendered,
    )?.[1];
    const arms = (block ?? "")
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as unknown);

    // Non-vacuity: a block that rendered no arm would pass the parse below
    // over nothing (`.claude/rules/engineering.md`, *A green verdict is
    // proven non-vacuous*).
    expect({ name, arms: arms.length > 0 }).toEqual({ name, arms: true });
    for (const arm of arms) {
      const parsed = PLAN_STATE_SCHEMAS[name].safeParse(filled(arm));
      expect({ name, arm, ok: parsed.success }).toEqual({ name, arm, ok: true });
    }
  }
}, SPAWN_BUDGET_MS);

it("the sweep slice's prompt shows a closed rotation as an object, never a bare word", async () => {
  const rendered = await render("plan-sweep");
  expect(rendered).toContain('"rotation":{"kind":"closed"}');
  expect(rendered).toContain('"rotation":{"kind":"open","covered":[');
  // The bare word is what the schema refuses: the shape the block shows is
  // the one that survives the gate, and this one does not.
  expect(
    PLAN_STATE_SCHEMAS["plan-sweep"].safeParse({
      sweptThrough: "0123456789abcdef0123456789abcdef01234567",
      rotation: "closed",
    }).success,
  ).toBe(false);
}, SPAWN_BUDGET_MS);
