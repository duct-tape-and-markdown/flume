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
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import { parseDeclaration, type Declaration } from "../harness/declaration.ts";
import { PHASES, PLAN_SLICES } from "../harness/declaration.ts";
import { entryExtension } from "../harness/entryExtension.ts";
import { harnessInit } from "../harness/init.ts";
import { planStatePath } from "../harness/planState.ts";
import {
  PROMPT_NAMES,
  promptPath,
  questionsPath,
  sharedPromptArgs,
  type PromptName,
  type SharedPromptArg,
} from "../harness/prompts.ts";
import { resolvePendingPath } from "../src/paths.ts";
import type { Phase } from "../src/Phase.ts";
import {
  InlineExecRenderError,
  NO_COMMIT_MODES,
  renderPrompt,
} from "../src/Prompt.ts";

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
  stateRoot = await mkdtemp(join(tmpdir(), "flume-prompts-"));
  await mkdir(join(stateRoot, "plan"), { recursive: true });
  await writeFile(
    join(stateRoot, "plan", "pending.json"),
    '{ "entries": [] }\n',
  );
  await writeFile(
    join(stateRoot, "plan", "open-questions.md"),
    "# Open questions\n",
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

function args(root: string = stateRoot): Record<string, string> {
  return sharedPromptArgs({
    declaration,
    extension: entryExtension(),
    stateRoot: root,
  });
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
  name: PromptName,
  root: string = stateRoot,
): Promise<string> {
  const promptFile = promptPath(name);
  const raw = await readFile(promptFile, "utf8");
  const shared = args(root);
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
});

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
});

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
});

// ---------------------------------------------------------------- odd roots

/**
 * The artifacts the slice prompts' spans read, each addressed through the
 * module that owns its path rather than through a layout spelled here: the
 * queue's is the engine's, the plan state's is `planState.ts`'s, the
 * questions file's is `prompts.ts`'s. A sentinel rides each body so a case
 * asserts the bytes *arrived*, not merely that the render did not throw — a
 * span whose guard mis-fired would render its placeholder over a readable
 * artifact and look identical from the outside.
 *
 * `placeholder` is what the span renders when the artifact is legitimately
 * absent; an artifact carrying none refuses on absence instead, which the
 * unguarded-span cases below pin.
 */
const ARTIFACTS: ReadonlyArray<{
  readonly key: SharedPromptArg;
  readonly at: (root: string) => string;
  readonly body: string;
  readonly sentinel: string;
  readonly placeholder?: string;
}> = [
  {
    key: "PENDING_PATH",
    at: (root) => resolvePendingPath(root),
    body: '{ "entries": [], "note": "PENDING-SENTINEL" }\n',
    sentinel: "PENDING-SENTINEL",
  },
  {
    key: "PLAN_STATE_PATH",
    at: planStatePath,
    body: '{ "note": "PLAN-STATE-SENTINEL" }\n',
    sentinel: "PLAN-STATE-SENTINEL",
    placeholder: "(no plan state yet)",
  },
  {
    key: "QUESTIONS_PATH",
    // The span greps for `## ` headings, so the sentinel has to be one.
    at: questionsPath,
    body: "## QUESTIONS-SENTINEL\n",
    sentinel: "QUESTIONS-SENTINEL",
    placeholder: "(none open)",
  },
];

/** A scratch state root carrying every artifact above, torn down at the end. */
async function seed(root: string): Promise<string> {
  oddRoots.push(root);
  for (const artifact of ARTIFACTS) {
    const at = artifact.at(root);
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, artifact.body, "utf8");
  }
  return root;
}

/** Whether any inline-exec span in `raw` substitutes `key` into its command. */
function spanSubstitutes(raw: string, key: SharedPromptArg): boolean {
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
 * tell a plan slice that stopped reading an artifact from `build.md` never
 * having read it.
 */
async function promptsReadingEachArtifact(
  roster: readonly PromptName[] = PHASES,
): Promise<ReadonlyMap<SharedPromptArg, PromptName[]>> {
  const readers = new Map<SharedPromptArg, PromptName[]>(
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
  readers: ReadonlyMap<SharedPromptArg, PromptName[]>,
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
  readers: ReadonlyMap<SharedPromptArg, PromptName[]>,
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
  const root = await mkdtemp(join(tmpdir(), "flume prompts space-"));
  expect(root).toContain(" ");

  await everyPromptReadsItsArtifactsUnder(root);
});

it("every package prompt's spans read their artifacts under a state root path carrying a backslash", async () => {
  const base = await mkdtemp(join(tmpdir(), "flume-prompts-backslash-"));
  // On win32 the separator *is* the backslash — every state root there is
  // this case, which is where the defect was measured. Elsewhere a backslash
  // is an ordinary filename byte, and the same byte reaches `sh`.
  const root = process.platform === "win32" ? base : join(base, "back\\slash");
  oddRoots.push(base);
  await mkdir(root, { recursive: true });
  expect(root).toContain("\\");

  await everyPromptReadsItsArtifactsUnder(root);
});

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
  const root = await mkdtemp(join(tmpdir(), prefix));
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
    const at = artifact.at(root);
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, artifact.body, "utf8");
  }
  return root;
}

/** One render's outcome, as a value both branches can be asserted against. */
async function outcomeOf(
  name: PromptName,
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
  /** The state, as the failure messages say it: "an absent PENDING_PATH". */
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
 * (`engineering.md`, *A seam gate reads what the real writer wrote*): the
 * claim is what `sh` does with the bytes the prompt ships once the real
 * substituter has put a real path into them.
 *
 * Every plan slice is rendered, and each one's verdict is the one its own
 * spans entail: a slice that opens the artifact refuses on it, and a slice
 * that does not open it renders — the second half is what keeps the roster
 * honest rather than silently narrowing to the slices that happen to read.
 *
 * Which states are supposed to refuse is the caller's, since that is what
 * differs between a guarded span and an unguarded one; how a refusal is
 * recognised is here, once (`engineering.md`, *The fix lands at the
 * mechanism*).
 */
async function eachSliceVerdictFollowsItsSpansOn(
  artifact: (typeof ARTIFACTS)[number],
  damage: Damage,
): Promise<void> {
  // Non-vacuity: a roster that collapsed to zero would pass the loop below
  // over nothing (`engineering.md`, *A green verdict is proven non-vacuous*).
  expect(PLAN_SLICES.length).toBeGreaterThan(0);

  const key = artifact.key;
  let refused = 0;
  for (const name of PLAN_SLICES) {
    const raw = await readFile(promptPath(name), "utf8");
    const root = await seed(await scratchRoot(`flume-prompts-${key}-`));
    const path = artifact.at(root);
    await damage.apply(path);

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
    expect(failures.map((f) => f.cmd)).toEqual([expect.stringContaining(path)]);
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
async function everySliceOverWrongKindAt(key: SharedPromptArg): Promise<void> {
  const artifact = GUARDED.find((a) => a.key === key);
  expect(artifact, `${key} is a guarded artifact`).toBeDefined();
  await eachSliceVerdictFollowsItsSpansOn(artifact!, WRONG_KIND);
}

it("each plan slice prompt's verdict on a plan state directory in place follows whether its spans read that artifact", async () => {
  await everySliceOverWrongKindAt("PLAN_STATE_PATH");
});

it("each plan slice prompt's verdict on an open-questions directory in place follows whether its spans read that artifact", async () => {
  await everySliceOverWrongKindAt("QUESTIONS_PATH");
});

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
  key: SharedPromptArg,
): Promise<void> {
  const artifact = UNGUARDED.find((a) => a.key === key);
  expect(artifact, `${key} is an unguarded artifact`).toBeDefined();
  await eachSliceVerdictFollowsItsSpansOn(artifact!, NOTHING);
}

it("each plan slice prompt's verdict on an absent queue follows whether its spans read that artifact", async () => {
  await everySliceOverAbsentArtifactAt("PENDING_PATH");
});

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
      spanSubstitutes(raw, "PENDING_PATH"),
      `${name}: opens no PENDING_PATH span`,
    ).toBe(true);

    // The seeded bytes arrived as the block's content — an empty queue the
    // slice can read, not a render that merely failed to throw.
    const rendered = await render(name, root);
    expect(rendered, `${name}: the seeded queue did not reach the prompt`).toMatch(
      /^\[\]$/m,
    );
  }
});

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
    expect(existsSync(artifact.at(root))).toBe(false);
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
});

/**
 * The third case the questions span has to tell apart, and the reason its
 * guard cannot stop at `test -e`: `grep` exits 1 on a file it read and found
 * no headings in, and 2 on a file it could not read at all. Exit 1 is the
 * empty index — a questions file with a preamble and nothing open — and
 * stays legitimate; only the reader's real failure refuses.
 */
it("a questions file carrying no headings renders the plan slices' none-open placeholder", async () => {
  const questions = GUARDED.find((a) => a.key === "QUESTIONS_PATH");
  expect(questions, "the questions artifact is guarded").toBeDefined();

  const root = await seed(await scratchRoot("flume-prompts-no-headings-"));
  // A real file, readable, with no `## ` heading anywhere in it.
  await writeFile(
    questions!.at(root),
    "# Open questions\n\nNothing is open.\n",
    "utf8",
  );

  // Same detector, same closing count: a plan slice set that stopped indexing
  // the questions file reds the coverage rather than skipping past it.
  const readers = await promptsReadingEachArtifact(PLAN_SLICES);
  expectEveryArtifactRead(readers, [questions!]);

  let asserted = 0;
  for (const name of PLAN_SLICES) {
    if (!readers.get("QUESTIONS_PATH")!.includes(name)) continue;
    const rendered = await render(name, root);
    placeholderIsBlockContent(
      rendered,
      questions!.placeholder,
      `${name}/QUESTIONS_PATH`,
    );
    asserted++;
  }

  // Every plan slice the detector found indexing the file was asserted, and
  // the coverage above makes that count non-zero.
  expect(asserted).toBe(pairsToAssert(readers, [questions!]));
});

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
  const boundary = args()["TURN_BOUNDARY"];
  expect(boundary, "the shared args supply no TURN_BOUNDARY").toBeDefined();
  expect(boundary!.trim()).not.toBe("");

  for (const name of PHASES) {
    const raw = await readFile(promptPath(name), "utf8");
    const rendered = await render(name);
    expect({
      name,
      names: raw.includes("{{TURN_BOUNDARY}}"),
      carries: rendered.includes(boundary!),
    }).toEqual({ name, names: true, carries: true });
  }
});
