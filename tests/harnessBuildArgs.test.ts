/**
 * Build's per-tick prompt arguments (`spec/harness.md`, *The prompts and
 * their discipline*): the entry the tick was handed, the section its `per`
 * cites as this tick's tree holds it, and the one note the tick may write —
 * the placeholders the shipped `build.md` names and the shared args do not
 * supply.
 *
 * The rendering case is an agreement gate (`.claude/rules/engineering.md`, *A
 * seam gate reads what the real writer wrote*): the real writers are
 * `sharedPromptArgs` and `buildPromptArgs` over a real parsed declaration and
 * a real cite into this repository's own spec, and the real reader is the
 * engine's `renderPrompt` over the prompt the package ships. A hand-authored
 * argument map would re-author the prompt's placeholder vocabulary by the
 * tester's hand and let a prompt naming an arg nothing supplies ship green.
 *
 * The cited-section case is the other side of that seam: the text these args
 * quote is compared against what `resolveCite` — the resolution the `per`
 * gate drives over the queue — returns for the same cite, so the gate that
 * admitted the cite and the render that quotes it cannot disagree.
 *
 * The refusal cases hand-author their cite, which is the sanctioned shape: no
 * plan tick writes the cite a refusal exists to catch.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  buildPromptArgs,
  entryExtension,
  notePath,
  parseDeclaration,
  promptPath,
  resolveCite,
  sharedPromptArgs,
  type AtRefReader,
  type BuildTickContext,
  type Declaration,
  type SectionResolver,
} from "../harness/index.ts";
import { PerSchema } from "../harness/entryExtension.ts";
import { computeStateRootRel } from "../src/Dispatcher.ts";
import type { Phase } from "../src/Phase.ts";
import type { PendingEntry } from "../src/PendingSchema.ts";
import { renderPrompt } from "../src/Prompt.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The engine's own placeholder grammar, as the renderer spells it. */
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** The section every case below cites, in a spec page the tick's tree holds. */
const SECTION = "The prompts and their discipline";

const SPEC = [
  "# A spec page",
  "",
  `## ${SECTION}`,
  "",
  "Every prompt the package renders names the engine's own declaration.",
  "",
  "### A subsection under it",
  "",
  "Still the cited section.",
  "",
  "## The next section",
  "",
  "Not the cited section.",
  "",
].join("\n");

/**
 * A spec with no heading at all — the shape a declared resolver exists for.
 * A section found in this one was found by the declared resolver and by
 * nothing else.
 */
const TYPED_SPEC = JSON.stringify({
  sections: { prompts: "the section, keyed rather than headed" },
});

const byKey: SectionResolver = (cite, text) =>
  (JSON.parse(text) as { sections: Record<string, string> }).sections[
    cite.section
  ];

/** The tick's repo root, and the worktree the dispatcher would provision. */
let repoRoot: string;
let cwd: string;

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "flume-build-args-"));
  cwd = join(repoRoot, ".flume", "worktrees", "HARNESS-BUILD-PROMPT-ARGS");
  await mkdir(join(cwd, "spec"), { recursive: true });
  await writeFile(join(cwd, "spec", "harness.md"), SPEC);
  await writeFile(join(cwd, "spec", "contract.json"), TYPED_SPEC);
});

afterAll(async () => {
  if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
});

/**
 * A declaration, parsed rather than cast: the args under test read
 * `specLocus` and `resolver`, and a shape the schema would refuse is not a
 * declaration any consumer could have handed the factory.
 */
function declare(over: Record<string, unknown> = {}): Declaration {
  return parseDeclaration({
    specLocus: ["spec/**"],
    fence: { build: ["harness/**"] },
    runner: () => ({ run: async () => [], runAtBase: async () => [], lanes: [] }),
    slices: { enabled: [] },
    ...over,
  });
}

/** One queued entry: the engine core plus every package extension field. */
function entry(
  over: { tag?: string; per?: { path: string; section: string } } = {},
): PendingEntry {
  return {
    tag: over.tag ?? "HARNESS-BUILD-PROMPT-ARGS",
    gate: { kind: "open" },
    dependsOnForks: [],
    files: {
      new: [],
      edit: [{ path: "harness/prompts.ts", description: "the work" }],
      retire: [],
    },
    summary: "one line of what",
    per: over.per ?? { path: "spec/harness.md", section: SECTION },
    acceptance: "what turns green",
    tests: [],
    pins: [],
  };
}

/**
 * The tick, as the dispatcher builds it for a fanout build phase — including
 * `stateRootRel`, which the dispatcher computes from the two roots it holds
 * and reports on every context it hands a hook. Built with the engine's own
 * `computeStateRootRel` here for the same reason the dispatcher calls it:
 * nothing else in a tick's context can spell that offset.
 */
const tick = (assignedEntry: PendingEntry): BuildTickContext => ({
  cwd,
  flumeDir: join(repoRoot, ".flume"),
  stateRootRel: computeStateRootRel(repoRoot, join(repoRoot, ".flume")),
  assignedEntry,
});

/** Build's args for one entry, over the tick's own tree. */
const argsFor = (
  assignedEntry: PendingEntry,
  declaration: Declaration = declare(),
): Record<string, string> =>
  buildPromptArgs({ declaration, ctx: tick(assignedEntry) });

/** The tick's tree as the `per` gate's reader sees a commit: bytes, or absent. */
const asRead: AtRefReader = async (path) => {
  try {
    return await readFile(join(cwd, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

it("build's per-tick args carry the assigned entry as JSON and its tag", () => {
  const assigned = entry();

  const args = argsFor(assigned);

  // Non-vacuity: the entry carries the whole extension, so the round-trip
  // below is over a real queue entry and not a bare tag.
  expect(Object.keys(assigned).length).toBeGreaterThan(5);
  expect(JSON.parse(args.ENTRY_JSON!)).toEqual(assigned);
  // Indented, because the prompt puts it in a block a reader reads, and the
  // tag is in it verbatim — it is what the commit message and the note are
  // keyed by.
  expect(args.ENTRY_JSON).toContain(`"tag": "${assigned.tag}"`);
  expect(args.ENTRY_JSON!.split("\n").length).toBeGreaterThan(1);
});

it("build's per-tick args render the cited section's text through the declaration's resolver", async () => {
  const assigned = entry();
  const cite = PerSchema.parse(assigned.per);

  const args = argsFor(assigned);

  // The section itself, bounded the way the resolver bounds one: a deeper
  // heading is inside it, one of the same depth ends it.
  expect(args.PER_SECTION_TEXT!.startsWith(`## ${SECTION}`)).toBe(true);
  expect(args.PER_SECTION_TEXT).toContain("### A subsection under it");
  expect(args.PER_SECTION_TEXT).not.toContain("## The next section");
  expect(args.PER_PATH).toBe(cite.path);
  expect(args.PER_SECTION).toBe(cite.section);

  // And it is the resolution the `per` gate drove over the queue that carried
  // this entry, byte for byte — one resolver, not two.
  const gateSide = await resolveCite(cite, declare(), asRead);
  expect(gateSide.ok).toBe(true);
  expect(gateSide.ok === true && gateSide.text).toBe(args.PER_SECTION_TEXT);

  // A declared resolver changes which section is found without changing what
  // the prompt is handed: the typed spec carries no heading, so the package's
  // own resolver refuses exactly what the declared one renders.
  const keyed = entry({ per: { path: "spec/contract.json", section: "prompts" } });
  expect(argsFor(keyed, declare({ resolver: byKey })).PER_SECTION_TEXT).toBe(
    "the section, keyed rather than headed",
  );
  expect(() => argsFor(keyed)).toThrow(/no heading "prompts"/);
});

it("build's per-tick args refuse an assigned entry whose cite names no section in the tick's tree", () => {
  // Vacuity guard: the cite one character away resolves, so each refusal
  // below is the drift's doing and not an unreadable tree.
  expect(() => argsFor(entry())).not.toThrow();

  const drifted = entry({ per: { path: "spec/harness.md", section: `${SECTION}s` } });
  expect(() => argsFor(drifted)).toThrow(/does not resolve/);
  // Naming the entry to repair, the file, and the section that moved.
  expect(() => argsFor(drifted)).toThrow(/HARNESS-BUILD-PROMPT-ARGS/);
  expect(() => argsFor(drifted)).toThrow(/no heading "The prompts and their disciplines" in spec\/harness\.md/);

  // A path the tree does not hold is the same refusal, naming the path.
  expect(() =>
    argsFor(entry({ per: { path: "spec/retired.md", section: SECTION } })),
  ).toThrow(/spec\/retired\.md/);

  // And a path no cite may point at is refused before the tree is read.
  expect(() =>
    argsFor(entry({ per: { path: "harness/prompts.ts", section: SECTION } })),
  ).toThrow(/outside the declared spec locus/);
});

it("build's per-tick args name the entry's note path from the tick context alone", () => {
  const assigned = entry();

  // The declaration and the tick, and nothing else: no repo root is passed,
  // because the offset the note path needs is a fact the engine reports on
  // the context rather than one a hook recomputes.
  const args = buildPromptArgs({ declaration: declare(), ctx: tick(assigned) });

  // Non-vacuity: the context under test actually carries a state root, so the
  // path below was read from a populated field and not from an absent one.
  expect(tick(assigned).stateRootRel).toBe(".flume");
  // The path the records gate keys a build tick's one note by, composed from
  // the same `notePath` and the same repo-relative state root the gate reads.
  expect(args.NOTE_PATH).toBe(notePath(".flume", assigned.tag));

  // Repo-relative, never absolute: the agent writes it inside its own
  // worktree, and a path resolved from the state root would land in the
  // trunk checkout instead.
  expect(isAbsolute(args.NOTE_PATH!)).toBe(false);
  expect(args.NOTE_PATH!.startsWith(cwd)).toBe(false);
});

it("buildPromptArgs renders NOTE_PATH slash-joined from a backslash-separated state root", () => {
  const assigned = entry();

  // A nested state root, as a job namespace produces one. The engine reports
  // the offset `relative()` computed, which is the **host's** dialect — so on
  // win32 a root more than one segment deep arrives backslash-separated.
  // Spelled rather than computed: a posix run cannot produce that shape, and
  // it is the shape the note path still has to be composed from.
  const nested = String.raw`jobs\alpha\.flume`;
  const asGit = "jobs/alpha/.flume";
  // The two spellings are one root.
  expect(nested.split("\\").join("/")).toBe(asGit);

  const args = buildPromptArgs({
    declaration: declare(),
    ctx: { ...tick(assigned), flumeDir: join(repoRoot, ...asGit.split("/")), stateRootRel: nested },
  });

  // The path the agent writes, the records gate keys and the park predicate
  // reads back — git's alphabet, never the host's.
  expect(args.NOTE_PATH).toBe(notePath(asGit, assigned.tag));
  expect(args.NOTE_PATH).not.toContain("\\");

  // Vacuity guard: the same call over a single-segment root — the shape every
  // host spells alike — renders the path it always did, so the assertion
  // above is the dialect's doing and not a rewritten note layout.
  expect(argsFor(assigned).NOTE_PATH).toBe(notePath(".flume", assigned.tag));
});

it("build's per-tick args refuse a state root outside the repo rather than naming a note path no commit holds", () => {
  const assigned = entry();

  // Vacuity guard: the same call over the tick's real state root renders a
  // path, so the refusal below is the relocation's doing.
  expect(argsFor(assigned).NOTE_PATH).toBe(notePath(".flume", assigned.tag));

  // The shape the dispatcher reports for a relocated state root: the key is
  // there, its value is absent, and there is no path in any commit to name.
  const relocated = join(`${repoRoot}-relocated`, ".flume");
  expect(computeStateRootRel(repoRoot, relocated)).toBeUndefined();
  expect(() =>
    buildPromptArgs({
      declaration: declare(),
      ctx: { ...tick(assigned), flumeDir: relocated, stateRootRel: undefined },
    }),
  ).toThrow(/outside/);
});

it("a build tick with no assigned entry refuses rather than rendering an empty entry block", () => {
  expect(() =>
    buildPromptArgs({
      declaration: declare(),
      ctx: { cwd, flumeDir: join(repoRoot, ".flume"), stateRootRel: ".flume" },
    }),
  ).toThrow(/no assigned entry/);
});

it("the package's build prompt renders over a real tick with no placeholder left", async () => {
  // This repository's own cite, read from this tick's own tree — the whole
  // acceptance: shared args plus build's, through the engine's real renderer,
  // over the markdown the package ships.
  const declaration = declare({ specLocus: ["spec/**", ".claude/rules/**"] });
  const flumeDir = join(REPO_ROOT, ".flume");
  const assigned = entry({ per: { path: "spec/harness.md", section: SECTION } });
  const promptFile = promptPath("build");

  const raw = await readFile(promptFile, "utf8");
  const named = [...raw.matchAll(PLACEHOLDER)].map((match) => match[1]!);
  // Non-vacuity: the prompt names placeholders at all, so "none unresolved"
  // below is a substitution and not an empty file.
  expect(named.length).toBeGreaterThan(0);

  const rendered = await renderPrompt({
    phase: buildPhase(promptFile),
    promptFile,
    // The repo itself, so the prompt's `git log` span resolves against a real
    // history and the cite resolves against the real spec.
    cwd: REPO_ROOT,
    flumeDir,
    args: {
      ...sharedPromptArgs({
        declaration,
        extension: entryExtension(),
        stateRoot: flumeDir,
      }),
      ...buildPromptArgs({
        declaration,
        ctx: {
          cwd: REPO_ROOT,
          flumeDir,
          stateRootRel: computeStateRootRel(REPO_ROOT, flumeDir),
          assignedEntry: assigned,
        },
      }),
    },
  });

  expect([...rendered.matchAll(PLACEHOLDER)].map((m) => m[0])).toEqual([]);
  expect(rendered).toContain(`"tag": "${assigned.tag}"`);
  expect(rendered).toContain(`section="${SECTION}"`);
  expect(rendered).toContain(notePath(".flume", assigned.tag));
  // The real section's own words, from the file the cite names.
  expect(rendered).toContain("Every prompt the package renders");
});

/** A phase the renderer can read, carrying the prompt under test. */
function buildPhase(promptFile: string): Phase {
  return {
    name: "build",
    description: "build under test",
    promptPath: promptFile,
    concurrency: "fanout",
    writablePaths: ["harness/**"],
    gates: [],
    handoff: () => [],
  };
}
