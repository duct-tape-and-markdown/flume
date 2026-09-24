/**
 * The citations the pin resolves against a page's own structure
 * (`tests/helpers/pageAnchors.ts`): a markdown link's `#fragment` against the
 * headings of the page it names, a `§ N` on a `docs/` page against that
 * page's own numbering, and the section half of a `` (`<page>.md`, *Section*) ``
 * pair an interface page writes against the titles that page still opens. Each
 * way, a section rewritten out from under a citation reds rather than silently
 * landing a reader somewhere the claim no longer is.
 *
 * Each repo verdict is the arm; the cases above it are that arm's own
 * detection, proven on a fixture written to be caught. A scan whose matcher
 * stopped matching reports a clean tree and a dead citation the same way, so
 * the readers and the slugger are pinned on inputs where the answer is known
 * before the tree is judged.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, expect, it } from "vitest";

import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { externalVocabulary } from "./helpers/externalVocabulary.ts";
import { packageSurface } from "./helpers/exportGraph.ts";
import { formatCitation } from "./helpers/commentCitations.ts";
import {
  anchorSlug,
  type AnchorScan,
  formatAnchor,
  formatSectionRef,
  formatSpan,
  headingSlugs,
  INTERFACE_PAGES,
  markdownLinks,
  pagesUnder,
  scanPageAnchors,
  scanPageIdentifiers,
  scanPageSections,
  scanSectionRefs,
  sectionNumbers,
  sectionRefs,
  type IdentifierScan,
  type PageDomain,
  type PageSectionScan,
  type SectionScan,
} from "./helpers/pageAnchors.ts";
import {
  REPO_ROOT,
  expectNoFindings,
  filesUnder,
  relPath,
} from "./helpers/repoProgram.ts";

/**
 * The pages whose links are judged: every tree the sweep domain names that
 * holds markdown (`.claude/rules/posture-sweep.md`, *The pages are the
 * authority as they read this tick*), plus the consumer-facing roots and the
 * chain's own protocol page.
 *
 * `spec/` and `.claude/` are out, and deliberately: their prose is held by
 * its authors (`.claude/rules/engineering.md`, *Narration is the ladder's
 * bottom rung*). They still *answer* — a link out of a judged page into a
 * spec section resolves against that section's headings — because the domain
 * bounds which pages are read for links, never which pages hold the headings.
 */
const ANCHOR_DOMAIN: PageDomain = {
  trees: ["docs", "examples", "harness"],
  files: ["README.md", "CHANGELOG.md", ".flume/PROTOCOL.md"],
};

/**
 * Every tree the sweep domain names, whether or not it holds markdown today
 * (`.claude/rules/posture-sweep.md`, *The pages are the authority as they
 * read this tick*). The pages they hold are asserted covered by what the
 * domain above reads, so a page added under a tree that carries none today
 * reds here rather than going unread — the domain is a declaration, and this
 * is what keeps it from being a hand-kept list.
 */
const SWEEP_TREES: readonly string[] = [
  "bin",
  "docs",
  "examples",
  "harness",
  "scripts",
  "src",
  "tests",
];

/** A fixture tree: two pages, one live anchor into each, one dead. */
const FIXTURE: Record<string, string> = {
  "docs/guide.md": [
    "# Guide",
    "",
    "See [the unit](target.md#the-checkout-is-the-unit) and",
    "[the section that went](target.md#a-job-is-a-state-root).",
    "",
    "Also [a heading of its own](#guide), [off tree](https://example.test/x#frag),",
    "and [a sibling page](target.md) with no fragment at all.",
    "",
    "[ref]: target.md#runtime-ignores",
    "",
  ].join("\n"),
  "docs/target.md": [
    "# The runtime ignore set",
    "",
    "## Runtime ignores",
    "",
    "```",
    "# a-job-is-a-state-root",
    "```",
    "",
    "## The checkout is the unit",
    "",
  ].join("\n"),
};

/**
 * The pages whose `§ N` references are judged: `docs/`, which is where the
 * rule scopes this arm (`.claude/rules/engineering.md`, *Narration is the
 * ladder's bottom rung*). It is the scope rather than a coverage ceiling —
 * every other tree the domain above reads numbers no section of its own, so a
 * `§` written there takes the prose arm and a wider domain would read the
 * same verdict off it.
 */
const SECTION_DOMAIN: PageDomain = { trees: ["docs"] };

/**
 * A second fixture tree, beside the anchor one and read by its own domain: a
 * page numbering sections both ways with references live and dead, and a page
 * numbering none that cites the first.
 */
const SECTION_FIXTURE: Record<string, string> = {
  "notes/upgrade.md": [
    "# Migrating to 9.9.0",
    "",
    "## 0. Before anything else",
    "",
    "§ 0 is due whether or not you take the bump, and §§ 1–2 are the rest.",
    "",
    "## 1. A field moves",
    "",
    "**1.1 The read that keeps compiling.** See § 1.1 for it, and § 4 for the",
    "section that went.",
    "",
    "## 2. Operators",
    "",
    "```",
    "grep -n 'seedDir' chain.ts   # § 2",
    "# 0.9 — a sample heading, opening no section",
    "```",
    "",
  ].join("\n"),
  "notes/index.md": [
    "# The series",
    "",
    "`upgrade.md` § 1 is the one break, and nothing on this page numbers a",
    "section of its own.",
    "",
  ].join("\n"),
};

/**
 * A third fixture tree, read by the identifier arm: one page carrying live
 * names, a retired one, spellings the subject rule refuses, a fenced sample,
 * a wrap, and an unclosed fence ahead of a live citation.
 */
const IDENTIFIER_FIXTURE: Record<string, string> = {
  "pages/authoring.md": [
    "# The authoring page",
    "",
    "`renderPrompt` reads a `writablePaths`, while `bundleFreshnessGate` is",
    "named by nothing the package ships. A flag (`--max`), an ordinary word",
    "(`the`), an acronym (`JSON`), a member (`Chain.writablePaths`) and a page",
    "(`spec/loop.md`) are each no citation this arm resolves.",
    "",
    "```ts",
    "// `alsoGone` is a sample, and a sample's names are code.",
    "```",
    "",
    "A paragraph may open a fence it never closes (`), and the stray one",
    "pairs with nothing.",
    "",
    "The `liveName` a paragraph behind it states is judged all the same.",
    "",
    "A wrapped `worktrees",
    "Base` is the wrap it is.",
    "",
  ].join("\n"),
};

/** What that fixture's package hands out. */
const FIXTURE_SURFACE: ReadonlySet<string> = new Set([
  "renderPrompt",
  "Chain",
  "writablePaths",
  "worktreesBase",
  "liveName",
]);

/**
 * A fourth fixture tree, read by the section-cite arm: a page citing another
 * page's sections every way the grammar spells one, and the page that answers
 * them.
 */
const CITE_FIXTURE: Record<string, string> = {
  "cites/interface.md": [
    "# The interface page",
    "",
    "A heading cite (`cites/target.md`, *Runtime ignores*) and a quoted one",
    "(`cites/target.md`, \"The checkout is the unit\") are the one grammar.",
    "",
    "A bolded lead (`cites/target.md`, *Verbatim copying is the detector*), and",
    "a cite the wrapping broke (`cites/target.md`, *The checkout is",
    "the unit*).",
    "",
    "A cite the wrapping broke at the comma, so the emphasis opens its own",
    "line (`cites/target.md`,",
    "*Runtime ignores*) — a `*` no comment margin is behind.",
    "",
    "An abbreviation (`cites/target.md`, *Runtime*), and a page the tree does",
    "not hold (`cites/gone.md`, *Runtime ignores*).",
    "",
    "```ts",
    "// (`cites/target.md`, *A sample names no section*) is code.",
    "```",
    "",
    "A parenthetical this paragraph never closed (`cites/target.md`,",
    "",
    "*Runtime ignores*) pairs with nothing.",
    "",
  ].join("\n"),
  "cites/target.md": [
    "# The runtime ignore set",
    "",
    "## Runtime ignores",
    "",
    "- **Verbatim copying is the detector.** A block appearing unchanged.",
    "",
    "## The checkout is the unit",
    "",
  ].join("\n"),
};

let fixtureRoot = "";
let fixtureSections: SectionScan;
let fixtureIdentifiers: IdentifierScan;
let fixtureCites: PageSectionScan;
let repoScan: AnchorScan;
let repoSections: SectionScan;

beforeAll(async () => {
  repoScan = scanPageAnchors({ root: REPO_ROOT, domain: ANCHOR_DOMAIN });
  repoSections = scanSectionRefs({ root: REPO_ROOT, domain: SECTION_DOMAIN });
  fixtureRoot = await mkTempDir("flume-anchors-");
  for (const [rel, body] of Object.entries({
    ...FIXTURE,
    ...SECTION_FIXTURE,
    ...IDENTIFIER_FIXTURE,
    ...CITE_FIXTURE,
  })) {
    const path = join(fixtureRoot, ...rel.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  fixtureSections = scanSectionRefs({ root: fixtureRoot, domain: { trees: ["notes"] } });
  fixtureIdentifiers = scanPageIdentifiers({
    root: fixtureRoot,
    domain: { trees: ["pages"] },
    surface: FIXTURE_SURFACE,
  });
  fixtureCites = scanPageSections({ root: fixtureRoot, domain: { trees: ["cites"] } });
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

it("one reader hands back a markdown link's destination and its fragment", () => {
  expect(
    markdownLinks(
      "see [`docs/MIGRATING-9.9.md`](docs/MIGRATING-9.9.md#section-3) and\n" +
        "[home](https://example.test/x), while `docs/MIGRATING-9.7.md` is only named.\n\n" +
        "[ref]: docs/MIGRATING-9.8.md#other\n",
    ),
  ).toEqual([
    { destination: "docs/MIGRATING-9.9.md", fragment: "section-3", line: 1 },
    { destination: "https://example.test/x", fragment: "", line: 2 },
    { destination: "docs/MIGRATING-9.8.md", fragment: "other", line: 4 },
  ]);

  // A bare anchor names no page: the destination is empty, the fragment is not.
  expect(markdownLinks("[up](#the-stamp)")).toEqual([
    { destination: "", fragment: "the-stamp", line: 1 },
  ]);
});

it("a heading anchors on its rendered text, and a repeat takes a numbered suffix", () => {
  expect(
    [
      "## `flume-harness init`",
      "### 7. Capability gating (`requiresCapability`)",
      "## **Loud** or nothing — really",
      "## A [linked](https://example.test/x) heading",
    ].map((heading) => anchorSlug(heading.replace(/^#+ /, ""))),
  ).toEqual([
    "flume-harness-init",
    "7-capability-gating-requirescapability",
    "loud-or-nothing--really",
    "a-linked-heading",
  ]);

  // Fenced `# ` lines mint no anchor, and a repeat heading is numbered from
  // the second occurrence on — both read off the shared heading walk.
  expect(
    headingSlugs(["# Notes", "", "```", "# Notes", "```", "", "# Notes", "", "# Notes"].join("\n")),
  ).toEqual(["notes", "notes-1", "notes-2"]);
});

it("a link into a page whose heading has gone reds the arm", () => {
  const scan = scanPageAnchors({ root: fixtureRoot, domain: { trees: ["docs"] } });

  // Non-vacuity: the fixture's live anchors are judged, not skipped past.
  expect(scan.pages).toEqual(["docs/guide.md", "docs/target.md"]);
  expect(scan.resolved.map((site) => site.fragment)).toEqual([
    "the-checkout-is-the-unit",
    "guide",
    "runtime-ignores",
  ]);

  // A fenced `# ` line in the target is not an anchor, so the link naming one
  // is the finding — reported at the line a reader has to edit.
  expect(scan.findings.map(formatAnchor)).toEqual([
    "docs/guide.md:4 docs/target.md#a-job-is-a-state-root",
  ]);
});

it("an anchor domain that resolves to no page refuses rather than reporting green", async () => {
  const empty = join(fixtureRoot, "hollow");
  await mkdir(empty, { recursive: true });

  expect(() => pagesUnder(fixtureRoot, { trees: ["hollow"] })).toThrow(/no page under hollow/);
  expect(() => pagesUnder(fixtureRoot, { trees: ["absent"] })).toThrow(/no page under absent/);
  expect(() => pagesUnder(fixtureRoot, { trees: ["docs"], files: ["docs/gone.md"] })).toThrow(
    /no page at docs\/gone\.md/,
  );
});

it("the anchor domain reads every markdown page the sweep domain holds", () => {
  const held = SWEEP_TREES.flatMap((tree) =>
    filesUnder({ root: join(REPO_ROOT, tree), suffix: ".md" }),
  ).map((path) => relPath(REPO_ROOT, path));

  // Non-vacuity: a walk that found no page would report full coverage.
  expect(held.length).toBeGreaterThan(0);

  const read = new Set(repoScan.pages);
  expectNoFindings(held.filter((page) => !read.has(page)));
});

it("every markdown link's #fragment resolves against the cited page's own headings", () => {
  // Non-vacuity: green over a tree whose links went unread is the failure
  // this arm exists to make impossible.
  expect(repoScan.pages.length).toBeGreaterThan(0);
  expect(repoScan.scanned.length).toBeGreaterThan(0);

  expectNoFindings(repoScan.findings.map(formatAnchor));
});

it("a `§` run names every section it introduces, and a page numbers them two ways", () => {
  // A range and a list are each one run: both endpoints, every member.
  expect(
    sectionRefs(
      "§§ 1–5 are the upgrade, § 2.2, § 2.3 the two to read\n" +
        "first, and §§ 5, 8, and 9 what a typecheck names.",
    ).map((ref) => `${ref.line}:${ref.number}`),
  ).toEqual(["1:1", "1:5", "1:2.2", "1:2.3", "2:5", "2:8", "2:9"]);

  // A heading and a bolded lead each open a section, with or without the
  // trailing `.`; an unnumbered heading and a fenced `# ` line open none.
  expect(
    sectionNumbers(
      [
        "# Migrating to 0.15.0",
        "## 1. A field moves",
        "### 1.4 The gate that opens the queue",
        "**5.6 A handoff reading quarantinedTags.**",
        "## Which sections apply to you",
        "```",
        "# 0.14 — two readings",
        "```",
      ].join("\n"),
    ),
  ).toEqual(["1", "1.4", "5.6"]);
});

it("a `§ N` on a docs page resolves against that page's own numbered headings", () => {
  const scan = fixtureSections;

  // Non-vacuity: the fixture's live references are judged, not skipped past —
  // the fenced one among them, since a cheat-sheet cite is followed like any
  // other even though a fenced `# ` line opens no section.
  expect(scan.numbered).toEqual(["notes/upgrade.md"]);
  expect(scan.resolved.map((site) => `${site.line}:${site.number}`)).toEqual([
    "5:0",
    "5:1",
    "5:2",
    "9:1.1",
    "15:2",
  ]);

  // The one naming no section of its page is the finding, at the line a reader
  // has to edit.
  expect(scan.findings.map(formatSectionRef)).toEqual(["notes/upgrade.md:9 § 4"]);

  // Non-vacuity: green over a tree whose references went unread is the failure
  // this arm exists to make impossible.
  expect(repoSections.numbered.length).toBeGreaterThan(0);
  expect(repoSections.scanned.length).toBeGreaterThan(0);

  expectNoFindings(repoSections.findings.map(formatSectionRef));
});

it("a docs page with no numbered headings leaves its `§ N` as prose", () => {
  const scan = fixtureSections;

  // The page numbering nothing is read, and its reference is reported prose
  // rather than judged against a numbering it does not have.
  expect(scan.pages).toContain("notes/index.md");
  expect(scan.numbered).not.toContain("notes/index.md");
  expect(scan.prose.map(formatSectionRef)).toEqual(["notes/index.md:3 § 1"]);
  expect(scan.scanned.map((site) => site.page)).not.toContain("notes/index.md");

  // Non-vacuity: the arm is exercised on the tree, and no page it silenced is
  // one whose own numbering could have answered.
  expect(repoSections.prose.length).toBeGreaterThan(0);
  const numbered = new Set(repoSections.numbered);
  expectNoFindings(
    repoSections.prose.filter((site) => numbered.has(site.page)).map(formatSectionRef),
  );
});

/**
 * The exclusions, and what carries them: `externalVocabulary`
 * (`tests/helpers/externalVocabulary.ts`) holds the list's own terms. An
 * interface page reaches two owners the package's surface cannot answer — a
 * name the toolchain or the host owns, and a declaration of `examples/`,
 * which is a chain this repo ships as source and not as surface.
 */
const EXTERNAL_VOCABULARY = externalVocabulary();

it("an interface page naming a backticked identifier the package's surface does not hold reds the page scan", () => {
  const scan = fixtureIdentifiers;

  // Non-vacuity: the page was read, and the spans the subject rule refuses
  // were seen and dropped rather than never collected. A reader that stopped
  // pairing would report the same clean verdict over zero citations.
  expect(scan.pages).toEqual(["pages/authoring.md"]);
  expect(scan.backticked.map((site) => site.text)).toContain("--max");
  expect(scan.backticked.map((site) => site.text)).toContain("JSON");

  // The judged set: what names one declaration, and nothing else. A fenced
  // sample's span is code the page is showing, so the name inside the sample
  // is not in it; and the paragraph is the pairing unit, so the stray
  // backtick two paragraphs down pairs with nothing rather than swallowing
  // every span behind it — which is what a page-wide pairing would do.
  expect(scan.scanned.map((site) => site.text)).toEqual([
    "renderPrompt",
    "writablePaths",
    "bundleFreshnessGate",
    "liveName",
  ]);
  expect(scan.resolved.map((site) => site.text)).toEqual([
    "renderPrompt",
    "writablePaths",
    "liveName",
  ]);

  // The retired name is the finding, at the line a reader has to edit.
  expect(scan.findings.map(formatSpan)).toEqual([
    "pages/authoring.md:3 bundleFreshnessGate",
  ]);

  // And the wrap is reported rather than judged: markdown puts a space in the
  // token, so the citation falls out of the judged set whatever it named.
  expect(scan.scanned.map((site) => site.text)).not.toContain("worktreesBase");
  expect(scan.wraps.findings.map(formatSpan)).toEqual([
    "pages/authoring.md:17 worktrees Base",
  ]);
});

it("every backticked identifier docs/CHAIN-AUTHORING.md, docs/CLI.md and README.md carry names a symbol the package's surface holds", () => {
  const surface = packageSurface({
    root: REPO_ROOT,
    buildConfig: "tsconfig.build.json",
    programConfig: "tsconfig.json",
  });

  // Non-vacuity on the resolving side: a surface built from the `exports`
  // map's entry list alone would hold two module symbols and red almost every
  // correct span, and an emit that resolved nothing would hold none at all.
  expect(surface.entryModules).toEqual(["src/index.ts", "harness/index.ts"]);
  expect(surface.names.size).toBeGreaterThan(500);

  const scan = scanPageIdentifiers({
    root: REPO_ROOT,
    domain: INTERFACE_PAGES,
    surface: surface.names,
  });

  // Non-vacuity on the judged side: all three pages were read and the judged
  // set is populated before the emptiness assertion.
  expect(scan.pages).toEqual([
    "docs/CHAIN-AUTHORING.md",
    "docs/CLI.md",
    "README.md",
  ]);
  expect(scan.scanned.length).toBeGreaterThan(300);
  expect(scan.resolved.length).toBeGreaterThan(0);

  // Each exclusion is non-vacuous in the other direction: a name the pages
  // stopped citing is a hole widened for nothing. Read over the union of
  // every judged set, since one list serves every reader of it.
  const excluded = [...EXTERNAL_VOCABULARY.keys()];
  const unresolved = new Set(scan.findings.map((site) => site.text));
  expect(excluded.filter((name) => unresolved.has(name)).length).toBeGreaterThan(
    0,
  );

  // A wrap names nothing the scan can resolve, so one carrying a citation is
  // a defect at the page rather than a resolution arm the scan is missing.
  expectNoFindings(scan.wraps.findings.map(formatSpan));

  expectNoFindings(
    scan.findings
      .filter((site) => !excluded.includes(site.text))
      .map(formatSpan),
  );
});

// --- an interface page's own prose, the fourth place a cite sits ----------

it("a section cite on an interface page naming a heading its cited page does not hold is a page finding", () => {
  const scan = fixtureCites;

  // Non-vacuity: both pages were read and every cite the fixture states was
  // drawn, before a verdict is read off any of them. The paragraph is the
  // pairing unit, so the fenced sample's cite is code the page is showing and
  // the parenthetical a blank line broke pairs with nothing — a page-wide read
  // would draw both and this roll is what says it did not.
  expect(scan.pages).toEqual(["cites/interface.md", "cites/target.md"]);
  expect(
    scan.scanned.map((site) => `${formatCitation(site)} -> ${site.page}`),
  ).toEqual([
    "cites/interface.md:3 Runtime ignores -> cites/target.md",
    "cites/interface.md:4 The checkout is the unit -> cites/target.md",
    "cites/interface.md:6 Verbatim copying is the detector -> cites/target.md",
    "cites/interface.md:7 The checkout is the unit -> cites/target.md",
    "cites/interface.md:11 Runtime ignores -> cites/target.md",
    "cites/interface.md:14 Runtime -> cites/target.md",
    "cites/interface.md:15 Runtime ignores -> cites/gone.md",
  ]);

  // A heading answers a cite, a bolded bullet lead answers one, and a phrase
  // the page's own wrapping broke closes to the heading it names.
  expect(scan.resolved.map(formatCitation)).toEqual([
    "cites/interface.md:3 Runtime ignores",
    "cites/interface.md:4 The checkout is the unit",
    "cites/interface.md:6 Verbatim copying is the detector",
    "cites/interface.md:7 The checkout is the unit",
    "cites/interface.md:11 Runtime ignores",
  ]);

  // The verdict, on the terms a comment's cite is held to: no prefix arm, so
  // an abbreviation is a rewrite; and a page the tree does not hold titles
  // nothing. Each cited at the line a reader has to edit.
  expect(scan.findings.map(formatCitation)).toEqual([
    "cites/interface.md:14 Runtime",
    "cites/interface.md:15 Runtime ignores",
  ]);
});

it("every section docs/CHAIN-AUTHORING.md, docs/CLI.md and README.md cite is a section its page still carries", () => {
  const scan = scanPageSections({ root: REPO_ROOT, domain: INTERFACE_PAGES });

  // Non-vacuity: all three pages were read and their cites drawn, before the
  // emptiness below is read off them. A walk that reached one page, or a
  // reader that stopped drawing the shape, would report the same clean tree.
  expect(scan.pages).toEqual([
    "docs/CHAIN-AUTHORING.md",
    "docs/CLI.md",
    "README.md",
  ]);
  expect(new Set(scan.scanned.map((site) => site.module)).size).toBe(3);
  expect(scan.scanned.length).toBeGreaterThan(20);

  // Judged in the direction that matters: a cite resolves against the headings
  // and bolded leads its page still opens, the page's own backticks folded out
  // and a cite the page's wrapping broke closed first.
  const resolved = new Set(
    scan.resolved.map((site) => `${site.page} :: ${site.text}`),
  );
  for (const cite of [
    "spec/loop.md :: Graceful stop — the stop flag",
    "spec/worktrees.md :: Singleton runs in a worktree",
    ".claude/rules/engine-boundary.md :: Surface, not prescription",
    // Broken at the comma, so the emphasis opens a line of its own.
    "spec/jobs.md :: The checkout is the unit of isolation",
  ]) {
    expect(`${cite} -> ${resolved.has(cite)}`).toBe(`${cite} -> true`);
  }

  expectNoFindings(
    scan.findings.map((site) => `${formatCitation(site)} -> ${site.page}`),
  );
});
