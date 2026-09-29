import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import {
  DEFAULT_ABORT_THRESHOLD,
  DEFAULT_QUARANTINE_SCOPE,
  FAILURE_STAGES,
} from "../src/loopSupervisor.ts";
import type { FailureStage } from "../src/loopSupervisor.ts";
import { DEFAULT_KILL_GRACE_MS } from "../src/processTree.ts";
import { expectNoChainVocabulary } from "./helpers/chainVocabulary.ts";

// Declarations ship (tsconfig.build.json), so a doc comment on a chain-facing
// option is the hover text every consumer reads — engine surface, injected into
// no prompt and caught by no other pin. Vocabulary from *this* repo's chain
// there ships one implementation's conventions with the engine's authority
// (.claude/rules/engine-boundary.md § Capability vs convention): the option
// describes only what the engine's mechanics consume.

const srcText = (module: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../src/${module}`, import.meta.url)),
    "utf8",
  );

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
 * reach: eight comments spelled the roster out by hand, and the member added
 * for a prompt that refused to render reached none of them — two of the eight
 * being the shipped `Chain.supervisorPolicy` hover a chain author reads
 * before turning quarantine off (`.claude/rules/engineering.md` § Derived
 * state is computed, never restated beside its source).
 *
 * A comment that lists the stages is read against the real constant, so the
 * next member reds here rather than stranding a hand-kept roster. A comment
 * that deliberately names a subset — the lift set's, whose three holds each
 * judge a tree — says so at the site, and saying so names the member it
 * leaves out, which is what this scan reads.
 */

/** The `src/` modules whose comments the roster scan reads. */
const srcModules = (): readonly string[] =>
  readdirSync(fileURLToPath(new URL("../src", import.meta.url)))
    .filter((name) => name.endsWith(".ts"))
    .sort();

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
 * Every comment in `source`, flattened to one line each: a block comment with
 * its leading `*` gutter stripped, and a run of adjacent `//` lines read as
 * the one comment a reader reads it as. Backticks are dropped so a
 * backticked stage name reads as the word it is.
 */
const commentsIn = (
  source: string,
): readonly { readonly text: string; readonly line: number }[] => {
  const found: { text: string; line: number }[] = [];
  const at = (index: number): number =>
    source.slice(0, index).split("\n").length;
  for (const m of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    found.push({ text: m[0], line: at(m.index) });
  }
  for (const m of source.matchAll(/(?:^[ \t]*\/\/[^\n]*\n?)+/gm)) {
    found.push({ text: m[0], line: at(m.index) });
  }
  return found.map(({ text, line }) => ({
    line,
    text: text.replace(/`/g, "").replace(/\n[ \t]*\*?[ \t]?/g, " "),
  }));
};

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

it("no comment in src/ names two failure stages in a list without naming every FAILURE_STAGES member", () => {
  // Vacuity guards: the roster is populated, and the scan is over the real
  // modules — a scan that read no module, or judged against an empty roster,
  // passes over nothing (`.claude/rules/engineering.md` § A green verdict is
  // proven non-vacuous).
  expect(FAILURE_STAGES.length).toBeGreaterThan(1);
  const modules = srcModules();
  expect(modules.length).toBeGreaterThan(0);

  const stale: string[] = [];
  let rosters = 0;
  for (const module of modules) {
    const source = srcText(module);
    for (const { text, line } of commentsIn(source)) {
      const lists = rosterListsIn(text);
      if (lists.length === 0) continue;
      rosters += lists.length;
      const missing = FAILURE_STAGES.filter(
        (stage) => !stagesNamedIn(text).includes(stage),
      );
      if (missing.length > 0) {
        stale.push(
          `src/${module}:${line} lists "${lists[0]}" and never names ${missing.join(", ")}`,
        );
      }
    }
  }

  // The scan found the rosters it exists to judge before the verdict over
  // them is read: an empty scan is the false green here, not a clean tree.
  expect(rosters, "the scan found no stage roster in any src/ comment").toBeGreaterThan(
    FAILURE_STAGES.length,
  );
  expect(stale, stale.join("\n")).toEqual([]);
});
