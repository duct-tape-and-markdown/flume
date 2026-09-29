import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { expect, it } from "vitest";

import {
  DEFAULT_ABORT_THRESHOLD,
  DEFAULT_QUARANTINE_SCOPE,
  DEFAULT_TICK_BUDGET,
  FAILURE_STAGES,
} from "../src/loopSupervisor.ts";
import type { FailureStage } from "../src/loopSupervisor.ts";
import { DEFAULT_KILL_GRACE_MS } from "../src/processTree.ts";
import { DEFAULT_LOG_VERDICTS } from "../src/tickVerdict.ts";
import { expectNoChainVocabulary } from "./helpers/chainVocabulary.ts";
import {
  commentProse,
  docCommentBlocks,
} from "./helpers/commentCitations.ts";
import {
  expectNoFindings,
  modulesUnder,
  parseScopeless,
  relPath,
  REPO_ROOT,
} from "./helpers/repoProgram.ts";

// Declarations ship (tsconfig.build.json), so a doc comment on a chain-facing
// option is the hover text every consumer reads — engine surface, injected into
// no prompt and caught by no other pin. Vocabulary from *this* repo's chain
// there ships one implementation's conventions with the engine's authority
// (.claude/rules/engine-boundary.md § Capability vs convention): the option
// describes only what the engine's mechanics consume.

const srcPath = (module: string): string =>
  fileURLToPath(new URL(`../src/${module}`, import.meta.url));

const srcText = (module: string): string =>
  readFileSync(srcPath(module), "utf8");

/**
 * The doc comment block immediately preceding whatever `decl` (a regex
 * source) matches. The body pattern cannot cross a comment terminator, so
 * the match is the adjacent block, never an earlier one swallowed by a lazy
 * span.
 */
const docCommentBefore = (
  source: string,
  decl: string,
  label: string,
): string => {
  const body = source.match(
    new RegExp(String.raw`/\*\*((?:[^*]|\*(?!/))*)\*/\s*${decl}`),
  )?.[1];
  if (body === undefined) {
    throw new Error(`no doc comment precedes ${label}`);
  }
  return body;
};

/**
 * The manifest's `exports` map, which is the sole author of what the package
 * resolves: one key per subpath a consumer may import, each naming the
 * declaration it resolves to.
 */
const exportsMap = (): Readonly<Record<string, { readonly types?: string }>> => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as {
    readonly exports?: Readonly<Record<string, { readonly types?: string }>>;
  };
  if (manifest.exports === undefined) {
    throw new Error("package.json declares no exports map");
  }
  return manifest.exports;
};

/**
 * Every span a block backticks. A header names a subpath by writing it as the
 * manifest spells it, so the spans are read whole rather than searched for as
 * substrings: `.` inside `./harness` is the map's other key, not this one.
 */
const backtickedSpans = (doc: string): ReadonlySet<string> =>
  new Set([...doc.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ""));

/** The doc comment block immediately preceding `field`'s declaration. */
const docCommentFor = (source: string, field: string): string =>
  docCommentBefore(source, String.raw`${field}\??:`, `\`${field}\``);

/**
 * Register the vocabulary scan over one shipped surface. The scan is one
 * sequence — find the block, prove it is the block, assert the absence — so
 * it has one home and each subject is a call site rather than a copy
 * (`.claude/rules/engineering.md` § A module is one job). Subjects are named
 * one per call, never gathered into a list a rename could empty: an empty
 * list registers no test at all, which is the vacuous green the anchors below
 * exist to catch.
 *
 * `decl` is the declaration the block precedes, as a regex source, so a type
 * alias is a subject on the same footing as a field. `anchors` are spans only
 * *this* block states, asserted before the absence — a block renamed or
 * absorbed elsewhere fails loudly instead of passing an absence over nothing.
 */
const itNamesNoChainVocabulary = (subject: {
  readonly label: string;
  readonly module: string;
  readonly decl: string;
  readonly anchors: readonly string[];
}): void => {
  it(`the shipped \`${subject.label}\` doc comment names no term in the shared chain-vocabulary list`, () => {
    const doc = docCommentBefore(
      srcText(subject.module),
      subject.decl,
      `\`${subject.label}\``,
    );

    // Vacuity guard: the block is the one it claims to be, judged by anchors
    // this subject actually declares, before any absence is asserted over it.
    expect(subject.anchors.length).toBeGreaterThan(0);
    for (const anchor of subject.anchors) {
      expect(
        doc,
        `\`${subject.label}\` doc no longer states ${anchor}`,
      ).toContain(anchor);
    }

    expectNoChainVocabulary(doc, `\`${subject.label}\` doc`);
  });
};

itNamesNoChainVocabulary({
  label: "forkResolver",
  module: "Dispatcher.ts",
  decl: String.raw`forkResolver\??:`,
  anchors: ["dependsOnForks"],
});

itNamesNoChainVocabulary({
  label: "entryChannelPaths",
  module: "Phase.ts",
  decl: String.raw`entryChannelPaths\??:`,
  anchors: ["entry-scoped fanout tick"],
});

/**
 * `Concurrency` ships from `src/index.ts`, so its block is the hover text
 * every consumer reads about what each mode does. Naming which of *our*
 * phases takes which mode there hands one chain's roster the engine's
 * authority, and the modes are machinery any roster may spend
 * (`.claude/rules/engine-boundary.md` § Capability vs convention).
 */
itNamesNoChainVocabulary({
  label: "Concurrency",
  module: "Phase.ts",
  decl: String.raw`export type Concurrency\s*=`,
  anchors: ['"singleton"', '"fanout"', "cherry-picked"],
});

/**
 * `GatePhase` ships from `src/index.ts`, so its lead-in block is the first
 * hover text a chain author reads about gate placement — one rung above
 * `docs/CHAIN-AUTHORING.md`, which states the same thing. A singleton tick
 * cherry-picks its span onto the trunk and runs `afterMerge` there like a
 * wave of one (`spec/worktrees.md`, "Singleton runs in a worktree"), so a
 * lead-in scoping the placement to fanout denies a placement the engine
 * offers, and the author declines it before reaching the page.
 *
 * The subject is the lead-in block itself, not a rendered artifact that
 * happens to contain it: every sentence in the block is about when a
 * placement runs, so fanout vocabulary there can only be the scoping this
 * pin forbids. The per-member blocks below it are free to name fanout —
 * that is where what a failure costs a wave belongs.
 */
it("the `GatePhase` lead-in comment does not scope `afterMerge` to a fanout phase", () => {
  const leadIn = docCommentBefore(
    srcText("Gate.ts"),
    String.raw`export type GatePhase\s*=`,
    "`GatePhase`",
  );

  // Vacuity guard: the block still states both placements and where the
  // merged one runs before the absence is asserted over it — an absence over
  // a vanished subject is a false green.
  expect(leadIn).toContain("`afterCommit`");
  expect(leadIn).toContain("`afterMerge`");
  expect(leadIn).toContain("trunk");

  expect(leadIn).not.toMatch(/\bfan-?out\b|\bwave\b/i);
});

/**
 * `DEFAULT_ABORT_THRESHOLD` (`src/loopSupervisor.ts`) is the one home for the
 * abort backstop's default; the chain-facing option's hover text points at
 * that home rather than keeping a second copy of the number
 * (`.claude/rules/engineering.md` § Derived state is computed, never restated
 * beside its source). Read against the real constant, so bumping the default
 * can never leave a stale literal passing this pin.
 */
it("the shipped `abortThreshold` doc comment restates no DEFAULT_ABORT_THRESHOLD literal", () => {
  const doc = docCommentFor(srcText("Phase.ts"), "abortThreshold");

  // Vacuity guard: this is the block it claims to be before the absence is
  // asserted over it — an absence over a vanished subject is a false green.
  expect(doc).toContain("consecutive ticks");
  expect(doc).toContain("aborts the run");

  expect(doc).not.toContain(String(DEFAULT_ABORT_THRESHOLD));
});

/**
 * The single source line matching `pattern`, asserted unique before it is
 * read. A literal scan over a whole module — or a whole rendered page — turns
 * on whatever else that text happens to spell rather than on the default the
 * case is about (`.claude/rules/posture-sweep.md`, *A negative assertion over
 * a whole rendered artifact*), so each absence below reads exactly the line
 * that states the number.
 */
function soleLineMatching(text: string, pattern: RegExp, what: string): string {
  const hits = text.split("\n").filter((line) => pattern.test(line));
  expect(hits, `${what}: expected exactly one line`).toHaveLength(1);
  return hits[0] as string;
}

/**
 * `DEFAULT_TICK_BUDGET` (`src/loopSupervisor.ts`) is the one home for the
 * `flume loop` cap. The verb's own `--max` default reads it and the top-level
 * usage table interpolates it, so bumping the constant moves the behavior and
 * every page stating it together (`.claude/rules/engineering.md` § Derived
 * state is computed, never restated beside its source). Read against the real
 * constant: a literal that happens to equal today's value still reds this
 * pin the moment the default moves, and a verb spelling its own number makes
 * the constant decide nothing.
 */
it("the loop verb and the top-level help page restate no DEFAULT_TICK_BUDGET literal", () => {
  const cap = String(DEFAULT_TICK_BUDGET);

  const verbDefault = soleLineMatching(
    srcText("cliLoop.ts"),
    /let max =/,
    "the `loop` verb's `--max` default",
  );
  // Vacuity guard: this is the initializer it claims to be, and it names the
  // home, before the absence is asserted over it — an absence over a line
  // that no longer sets the default is a false green.
  expect(verbDefault).toContain("DEFAULT_TICK_BUDGET");
  expect(verbDefault).not.toContain(cap);

  const topRow = soleLineMatching(
    srcText("cliHelp.ts"),
    /^ {2}loop \[--max N\]/,
    "`HELP_TOP`'s `loop` row",
  );
  // Same guard: the row still states a default cap at all.
  expect(topRow).toContain("default cap");
  expect(topRow).toContain("DEFAULT_TICK_BUDGET");
  expect(topRow).not.toContain(cap);
});

/**
 * `DEFAULT_LOG_VERDICTS` (`src/tickVerdict.ts`) is the one home for how much
 * of the verdict history `flume log` prints without `-n`; both pages that
 * state it interpolate that constant rather than spelling the count again
 * (`.claude/rules/engineering.md` § Derived state is computed, never restated
 * beside its source). Every page is judged, not one: the count is stated in
 * the top-level command table and again on the verb's own page, and a pin
 * over either alone leaves the other free to go stale.
 */
it("no help page in src/cliHelp.ts spells the flume log default count as a literal", () => {
  const count = String(DEFAULT_LOG_VERDICTS);
  const rows = srcText("cliHelp.ts")
    .split("\n")
    .filter((line) => /tick verdicts \(default/.test(line));

  // Vacuity guard: both stating sites are in hand — the top-level table's
  // `log` row and the `flume log` page's own opening. A pin over one row, or
  // over none, passes while the other drifts.
  expect(rows).toHaveLength(2);

  for (const row of rows) {
    expect(row).toContain("DEFAULT_LOG_VERDICTS");
    expect(row).not.toContain(count);
  }
});

/**
 * `DEFAULT_QUARANTINE_SCOPE` (`src/loopSupervisor.ts`) is the one home for the
 * run-scoped quarantine's default; the chain-facing option's hover text
 * describes what each union member does and marks neither as the engine's
 * choice (`.claude/rules/engineering.md` § Derived state is computed, never
 * restated beside its source). The member the block must still describe is
 * read off the real constant, so flipping the default can never leave a stale
 * marker passing this pin.
 */
it("the shipped `quarantineScope` doc comment marks no union member as the engine default", () => {
  const doc = docCommentFor(srcText("Phase.ts"), "quarantineScope");

  // Vacuity guard: the block still describes the member that carried the
  // marker before the absence is asserted over it — an absence over a vanished
  // subject is a false green.
  expect(doc).toContain(`\`"${DEFAULT_QUARANTINE_SCOPE}"\``);
  expect(doc).toContain("quarantine");

  expect(doc).not.toMatch(/defaults?/i);
});

/**
 * `DEFAULT_KILL_GRACE_MS` (`src/processTree.ts`) is the one home for the
 * teardown escalation's default; the chain-facing option's hover text
 * describes the window without restating the number
 * (`.claude/rules/engineering.md` § Derived state is computed, never restated
 * beside its source). Read against the real constant, so bumping the default
 * can never leave a stale literal passing this pin.
 */
it("the shipped `killGraceMs` doc comment restates no DEFAULT_KILL_GRACE_MS literal", () => {
  const doc = docCommentFor(srcText("Phase.ts"), "killGraceMs");

  // Vacuity guard: this is the block it claims to be before the absence is
  // asserted over it — an absence over a vanished subject is a false green.
  expect(doc).toContain("SIGKILL");
  expect(doc).toContain("agent tree");

  expect(doc).not.toContain(String(DEFAULT_KILL_GRACE_MS));
});

/**
 * Foreign glob dialects, named as classes rather than one literal apiece —
 * pinning a single spelling lets its siblings ship green.
 *
 * `matchesAny` (`src/paths.ts`) is the one home for the dialect the write
 * guard enforces, and every special but `*` and `**` is escaped there. A
 * chain-facing glob option whose hover text names some *other* dialect
 * promises syntax the matcher reads as literal text — `?`, `{a,b}`, `[abc]`
 * — so an author trusting it declares a fence narrower than the one they
 * wrote, and the commit reverts on a path they believed they had covered.
 */
const FOREIGN_GLOB_DIALECTS: readonly RegExp[] = [
  /\b(mini|micro|pico|node)-?match\b/i,
  /\bfn-?match\b/i,
  /\bglob-?star\b/i,
  /\bext-?glob\b/i,
  /\b(bash|sh|shell|posix|gitignore)[-\s]?(style\s+)?glob/i,
  /\bglob\(\d\)/,
  /\bbrace expansion\b/i,
  /\bcharacter class(es)?\b/i,
];

/**
 * Every chain-facing glob option, judged by the one scan. The dialect is a
 * property of `matchesAny`, not of any single option that feeds it, so the
 * scan generalizes over the options rather than pinning the first one that
 * shipped a wrong spelling (`.claude/rules/engineering.md` § The fix lands at
 * the mechanism). `PartitionOptions` reaches the shipped declarations through
 * `partitionByFileOverlap`'s signature (`src/index.ts`), so its block is
 * hover text on the same footing as the `Chain` fields.
 *
 * Each subject carries anchors only *its* block states, so a block that was
 * renamed or absorbed elsewhere fails loudly here instead of passing an
 * absence asserted over nothing.
 */
const GLOB_OPTIONS: readonly {
  readonly label: string;
  readonly module: string;
  readonly field: string;
  readonly anchors: readonly string[];
}[] = [
  {
    label: "writablePaths",
    module: "Phase.ts",
    field: "writablePaths",
    anchors: ["permitted to modify", "relative to the repo root"],
  },
  {
    label: "entryChannelPaths",
    module: "Phase.ts",
    field: "entryChannelPaths",
    anchors: ["entry-scoped fanout tick", "outer ceiling"],
  },
  {
    label: "supervisorPolicy.partitionIgnore",
    module: "Phase.ts",
    field: "partitionIgnore",
    anchors: ["collision set", "never a permission"],
  },
  {
    label: "PartitionOptions.ignore",
    module: "partition.ts",
    field: "ignore",
    anchors: ["collision set", "dropped before placement"],
  },
];

it("the shipped chain-facing glob options' doc comments name no glob dialect the engine's matcher does not implement", () => {
  // Vacuity guard: the subject list and the dialect list are both populated
  // before any absence is asserted — a scan over zero options, or one judged
  // by zero patterns, is a false green.
  expect(GLOB_OPTIONS.length).toBeGreaterThan(0);
  expect(FOREIGN_GLOB_DIALECTS.length).toBeGreaterThan(0);

  for (const { label, module, field, anchors } of GLOB_OPTIONS) {
    const doc = docCommentFor(srcText(module), field);

    // Vacuity guard: each block is the one it claims to be before the
    // absence is asserted over it — an absence over a vanished subject is a
    // false green.
    for (const anchor of anchors) {
      expect(doc, `\`${label}\` doc no longer states ${anchor}`).toContain(
        anchor,
      );
    }

    for (const dialect of FOREIGN_GLOB_DIALECTS) {
      expect(doc, `\`${label}\` doc names ${dialect}`).not.toMatch(dialect);
    }
  }
});

/**
 * The entry module's own header is the hover text a chain author reads when
 * deciding whether a symbol absent from that module is public surface, and it
 * is the one comment the declaration emit carries verbatim into
 * dist/src/index.d.ts. What the package resolves is the `exports` map's to
 * say, so the header is read against the manifest rather than against an
 * entry list someone remembered: a subpath added to the map reds this pin
 * instead of shipping beside a header that names the old set.
 */
it("the src/ entry module's header names every subpath the package's exports map declares", () => {
  const map = exportsMap();
  const header = docCommentBefore(
    srcText("index.ts"),
    String.raw`export type \{`,
    "the entry module header",
  );
  const named = backtickedSpans(header);

  // Vacuity guard: the map declares more than one subpath — over a one-key
  // map "every subpath" is a claim about the only entry the header cannot
  // omit — and the root key resolves to the module whose header was read, so
  // the block judged below is the one this pin is about.
  const subpaths = Object.keys(map);
  expect(subpaths.length).toBeGreaterThan(1);
  expect(map["."]?.types).toContain("/src/index.d.ts");
  expect(named.size).toBeGreaterThan(0);

  for (const subpath of subpaths) {
    expect(named, `the entry header names no ${subpath} subpath`).toContain(
      subpath,
    );
  }
});

/**
 * `FAILURE_STAGES` (`src/loopSupervisor.ts`) is the one home for the stages a
 * per-entry failure record can come from, and the supervisor's fold is
 * exhaustive over it by type — so a member added there is a compile error
 * until its verdict list is named. Prose is the rung the compiler does not
 * reach: comments across the engine spelled the roster out by hand, and the
 * member added for a prompt that refused to render reached none of them —
 * among them the shipped `Chain.supervisorPolicy` hover a chain author reads
 * before turning quarantine off (`.claude/rules/engineering.md` § Derived
 * state is computed, never restated beside its source).
 *
 * A comment that lists the stages is read against the real constant, so the
 * next member reds here rather than stranding a hand-kept roster. A comment
 * that deliberately names a subset — the lift set's, whose three holds each
 * judge a tree — says so at the site, and saying so names the member it
 * leaves out, which is what this scan reads.
 *
 * The suite is read beside the engine, because a roster restated in a test
 * goes stale the same way and reads as authoritative the same way. Two were
 * standing when this domain widened: one in a test file, a wave after the
 * same drift had been fixed by hand in a sibling with nothing left behind to
 * catch the next, and one in the engine that the scan's own extractor had
 * been blind to — a roster written across a line break of a `//` run, which
 * a match over the file text read as two lists with a comment marker between
 * them.
 */

/**
 * The trees the scan walks, each whole. `harness/` states no roster, and the
 * vacuity pin below holds every tree walked to a roster of its own, so a
 * tree holding none would red for the scan's reach rather than for prose
 * gone stale.
 */
const ROSTER_TREES: readonly string[] = ["src", "tests"];

/**
 * How a stage's name is spelled in prose: `provision` also appears as the
 * gerund the worktree leg is named by, and every member may carry the
 * `-stage`/` stage` suffix the summary line writes, or the bare hyphen an
 * elided one leaves (`a provision-, render-, merge- or gate-stage wall`).
 */
const stageWord = (stage: FailureStage): string =>
  stage === "provision" ? String.raw`provision(?:ing)?` : stage;
const stageToken = (): string =>
  `(?:${FAILURE_STAGES.map(stageWord).join("|")})(?:[-\\s]stages?|-(?=[,\\s]))?`;

/**
 * A run of stage names joined as a list — `provision, render, merge or gate`,
 * `merge/gate`, `render and gate`. The separator alphabet carries only
 * punctuation and the two connectives, never bare whitespace: `after-merge
 * gate` is two words that happen to be adjacent, not a list.
 */
const LIST_SEPARATOR = String.raw`(?:\s*[,/]\s*(?:or\s+|and\s+)?|\s+(?:or|and)\s+)`;

/**
 * The words that make a list of stage names a *failure-stage* roster rather
 * than two nouns in a sentence about what a tick cost. Read over the text
 * immediately around the run, so a run's own neighbourhood decides it.
 */
const ROSTER_CONTEXT = /stages?|failures?|quarantin|abort/i;
const CONTEXT_WINDOW = 120;

/** The list continues past the run into something that is not a stage. */
const LIST_CONTINUES = new RegExp(String.raw`^${LIST_SEPARATOR}\w`);

/**
 * Every comment one module states, as this scan reads prose: furniture off,
 * a run of adjacent lines folded into the one comment a reader reads, and
 * backticks dropped so a backticked stage name reads as the word it is.
 *
 * The runs come off the parser's trivia (`commentProse`,
 * `tests/helpers/commentCitations.ts`) rather than off a match over the file
 * text, so a comment opener inside a string literal opens nothing: matched out
 * of the text, the `src/**` a phase's writable paths are declared with opened
 * a block that ran to the next comment terminator, and every line of code
 * between was judged as prose.
 */
const commentsIn = (
  path: string,
): readonly { readonly text: string; readonly line: number }[] =>
  commentProse(parseScopeless(path)).map(({ line, text }) => ({
    line,
    text: text.replace(/`/g, ""),
  }));

/** The roster members `text` names anywhere. */
const stagesNamedIn = (text: string): readonly FailureStage[] =>
  FAILURE_STAGES.filter((stage) =>
    new RegExp(String.raw`\b${stageWord(stage)}`, "i").test(text),
  );

/**
 * Every stage list in `text` that reads as a roster: two or more distinct
 * members, no non-member continuing the list on either side (`the
 * merge/gate/revert stage` is the wave's pipeline, not the supervisor's
 * roster), and roster vocabulary in the surrounding prose.
 */
const rosterListsIn = (text: string): readonly string[] => {
  const run = new RegExp(
    `${stageToken()}(?:${LIST_SEPARATOR}${stageToken()})+`,
    "gi",
  );
  const lists: string[] = [];
  for (const m of text.matchAll(run)) {
    const [hit] = m;
    if (stagesNamedIn(hit).length < 2) continue;
    const before = text.slice(Math.max(0, m.index - CONTEXT_WINDOW), m.index);
    const after = text.slice(m.index + hit.length, m.index + hit.length + CONTEXT_WINDOW);
    if (LIST_CONTINUES.test(after)) continue;
    if (/\w\s*[,/]\s*$/.test(before) || /\w\s+(?:or|and)\s+$/.test(before)) {
      continue;
    }
    if (!ROSTER_CONTEXT.test(before) && !ROSTER_CONTEXT.test(after)) continue;
    lists.push(hit);
  }
  return lists;
};

it("no comment in src/ or tests/ names two failure stages in a list without naming every FAILURE_STAGES member", () => {
  // Vacuity guard: the roster the scan judges against is populated, and the
  // scan walks more than one tree — a scan over an empty roster, or over the
  // one tree the roster lives in, passes over what it exists to reach
  // (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
  expect(FAILURE_STAGES.length).toBeGreaterThan(1);
  expect(ROSTER_TREES.length).toBeGreaterThan(1);

  const stale: string[] = [];
  for (const tree of ROSTER_TREES) {
    let rosters = 0;
    for (const path of modulesUnder(REPO_ROOT, { trees: [tree] })) {
      const module = relPath(REPO_ROOT, path);
      for (const { text, line } of commentsIn(path)) {
        const lists = rosterListsIn(text);
        if (lists.length === 0) continue;
        rosters += lists.length;
        const missing = FAILURE_STAGES.filter(
          (stage) => !stagesNamedIn(text).includes(stage),
        );
        if (missing.length > 0) {
          stale.push(
            `${module}:${line} lists "${lists[0]}" and never names ${missing.join(", ")}`,
          );
        }
      }
    }

    // Each tree contributed a roster of its own before the verdict over it is
    // read: a tree walked and found empty is the false green here, and a
    // count summed across the trees would let `src/` alone answer for both.
    expect(
      rosters,
      `the scan found no stage roster in any ${tree}/ comment`,
    ).toBeGreaterThan(0);
  }

  expect(stale, stale.join("\n")).toEqual([]);
});

/**
 * The trees whose doc comments the declaration emit carries, so every block
 * in them is hover text a chain author reads (`tsconfig.build.json`). Both,
 * because the package resolves both — the root subpath and `./harness` — and
 * a scan over the engine alone would let the opinion's blocks ship malformed.
 */
const SHIPPED_TREES: readonly string[] = ["src", "harness"];

/** What a doc comment opens with, and so what its body must not open with. */
const DOC_OPENER = "/**";

/**
 * A second opener at the head of a block's own body — the shape a stray line
 * above the real opener leaves. The parser closes at the first terminator, so
 * the two blocks the author wrote are one, and the emit carries the inner
 * opener into the hover text as the body's first word.
 *
 * Read at the head rather than anywhere in the body: a block *about* doc
 * comments may state the opener as prose, and that is a sentence, not a
 * malformation.
 */
const opensWithSecondOpener = (block: string): boolean =>
  block.slice(DOC_OPENER.length).replace(/^[\s*]+/, "").startsWith(DOC_OPENER);

it("no doc comment the package ships opens with a second doc-comment opener", () => {
  // Vacuity guard: more than one tree is walked, so neither answers for the
  // other (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*).
  expect(SHIPPED_TREES.length).toBeGreaterThan(1);

  const findings: string[] = [];
  for (const tree of SHIPPED_TREES) {
    let blocks = 0;
    for (const path of modulesUnder(REPO_ROOT, { trees: [tree] })) {
      for (const { line, text } of docCommentBlocks(parseScopeless(path))) {
        blocks += 1;
        if (opensWithSecondOpener(text))
          findings.push(`${relPath(REPO_ROOT, path)}:${line}`);
      }
    }

    // Each tree contributed blocks of its own before the verdict over it is
    // read: a tree walked and found empty is the false green here.
    expect(
      blocks,
      `the scan found no doc comment in any ${tree}/ module`,
    ).toBeGreaterThan(0);
  }

  expectNoFindings(findings);
});

/**
 * The string-literal members of a union type alias, off the declaration
 * itself. The roster a doc comment states is judged against what the type
 * declares, never against a list the test keeps: a member added to the union
 * reds the pin rather than shipping beside a block that never named it
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
const unionMembers = (module: string, name: string): readonly string[] => {
  for (const statement of parseScopeless(srcPath(module)).statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    if (statement.name.text !== name) continue;
    if (!ts.isUnionTypeNode(statement.type))
      throw new Error(`\`${name}\` is not a union of literals`);
    return statement.type.types.map((member) => {
      if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal))
        throw new Error(`\`${name}\` has a member that is not a string literal`);
      return member.literal.text;
    });
  }
  throw new Error(`no \`${name}\` type alias in src/${module}`);
};

/**
 * A bullet's own head: the member it is about, backticked, at the start of a
 * comment line. A wrapped continuation sits in the description column and
 * opens with a word, so only a line the author bulleted answers here.
 */
const BULLET_HEAD = /^\s*\*?\s+-\s+`([^`]+)`/gm;

/**
 * `MergeOutcome` ships from `src/index.ts`, so its block is the hover text a
 * chain author reads to learn what an outcome on a span means. The block
 * states one bullet per member and nothing else distinguishes them, so a
 * member whose bullet ran into the prose of the one above it is a variant the
 * author never sees as a variant at all.
 */
it("MergeOutcome's doc names one bullet per member of the union", () => {
  const members = unionMembers("tickVerdict.ts", "MergeOutcome");
  const doc = docCommentBefore(
    srcText("tickVerdict.ts"),
    String.raw`export type MergeOutcome\s*=`,
    "`MergeOutcome`",
  );

  // Vacuity guard: the union has members to bullet, and the block read is the
  // roster's — an equality over two empty lists is the false green here.
  expect(members.length).toBeGreaterThan(1);
  expect(doc).toContain("fared once the wave tried to");

  const bulleted = [...doc.matchAll(BULLET_HEAD)].map((match) => match[1]);
  expect(bulleted).toEqual([...members]);
});
