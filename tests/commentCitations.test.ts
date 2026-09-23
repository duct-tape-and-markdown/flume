/**
 * `.claude/rules/engineering.md` *Narration is the ladder's bottom rung* is
 * the ladder's bottom rung for its own property, and this file is the rung
 * above it for the carve-out that page names: a backticked identifier in a
 * `src/`, `harness/` or `tests/` comment is a reference, not a sentence, so a
 * deleted symbol may not leave its citations standing.
 *
 * The repo pin asserts an absence, so it comes after its detector shown
 * working: a scan of a tree whose dangling citations are known by
 * construction, and of each spelling the subject rule admits or refuses.
 * Without those, "no dangling citations" is a claim no failing run has ever
 * backed, and it stays green however narrow the subject rule drifts.
 *
 * The scanner is the same one in both, reading a real tsconfig and resolving
 * through a real program, so the fixture cannot drift into testing a second
 * implementation of the verdict.
 *
 * A TSDoc link tag is the one citation judged against a single module rather
 * than against the three trees, so the fixture cites one name from both
 * sides of that line: the module that declares it, and the module next door
 * that never imported it.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  type CitationScan,
  type CitationSite,
  type PageCitationScan,
  formatCitation,
  scanCommentCitations,
  scanPageCitations,
} from "./helpers/commentCitations.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import {
  NO_FINDINGS,
  expectNoFindings,
  modulesUnder,
  renderFindings,
  type ScanDomain,
} from "./helpers/repoProgram.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// --- the detector, over a tree whose citations are known by construction ---

/**
 * A miniature two-module tree carrying one citation per resolution arm — a
 * declaration next door, a discriminant held only as a string literal, a
 * dotted path whose head is a keyword, a module of the tree by basename, a
 * lib global the tree never uses, a file at a repo-relative path — beside
 * citations of each shape that resolve to nothing.
 *
 * It carries each spelling the subject rule admits, and each it refuses,
 * against both verdicts: a camel hump, a dot, a leading capital, a slash, a
 * single lowercase word, a word in capitals alone, a path placeholder.
 *
 * It also carries the two shapes a text search gets wrong in opposite
 * directions: a backticked name inside a string literal that *looks* like a
 * comment (scanned, it would be a phantom finding), and a real comment
 * sitting past a division pair that a raw token scan reads as a regular
 * expression (unscanned, its finding would be lost).
 *
 * The last comments are the wraps: a path citation broken across the line
 * with a resolving citation behind it — the wrap costs both if the reader
 * pairs backticks one line at a time — then an identifier citation broken the
 * same way, and a span of prose that carries a space of its own, so the
 * break-closed reading is shown discriminating rather than reporting every
 * wrap it meets.
 *
 * Then the page names no backtick fences, in both verdicts and beside
 * the two placeholder spellings the path arm refuses — the same shapes the
 * fenced citations above carry, so the two arms are shown agreeing rather
 * than the unfenced one getting a rule of its own. One of those is wrapped
 * too, broken at a directory boundary whose tail a root-level page of the
 * same basename answers: the reading that judges the tail resolves, so only
 * a scan that reports the wrap can tell the two pages apart.
 *
 * Last is the page name a fence carries with no directory ahead of it, in
 * both verdicts and spelled with a hyphen no identifier segment admits —
 * the shape that reaches the filename arm on its extension alone — beside
 * the leading dot that arm refuses, which is how prose spells a member
 * access whose receiver it elided.
 *
 * Last of all are the titles, which the scan reads off the parse rather than
 * out of any comment: a page the tree holds, a page it does not, one whose
 * fence has to come off before the name is there to read, and the placeholder
 * the page-name arm refuses in a comment too. Each carries a backticked
 * identifier beside it, because the title arm must judge the page and leave
 * the identifier alone — a title is a literal, so an identifier written in one
 * is a token of the tree by having been written, and judging it would answer
 * the citation out of the citation.
 *
 * Last of all is the page name a literal of this tree spells and no file of
 * it holds, fenced and bare, beside a module path spelled by that same
 * literal: the page names are answered by the working tree alone, and the
 * module path is the arm that still reads the token set.
 *
 * Then the link tags, whose reach is one module's: the fixture cites a
 * declaration of the citing module, an import, a lib global, a member of
 * one, and each of the tag's other two spellings — `linkcode` and
 * `linkplain`, the second carrying a link text; then a declaration of the
 * module next door that this one never imported, a name nothing declares,
 * and a tag naming nothing at all. The name next door is backticked beside
 * its tag, because the backticked arm answers it and this one must not.
 * Last is a tag the wrapping broke, which is one reference all the same.
 *
 * Then the pairs, which name a home the token set cannot answer: a
 * declaration in the file the pair names, a declaration of the other module
 * cited at the wrong door, and a lib global no module of the tree declares at
 * all. Each of the three resolves against the trees at large, so the two that
 * red are the home arm displacing that reading rather than a name the fixture
 * never declared. Beside them the two spellings no pair is drawn from — a
 * path a sentence merely follows a name with, and a parenthetical the path
 * opens without closing — on those same two names, so the refusal is visible
 * as a refusal. Last of the pairs is the one the path closes tight and the
 * pair rule still declines, because that path names a page: the same two
 * names again, over a page the tree holds and one it does not. Last of all
 * is the spelling the pair admits and the standalone rule refuses — a name in
 * capitals, with and without the underscore an identifier segment refuses —
 * in both verdicts and beside the same spelling standing alone in prose,
 * which claims no home and stays a word.
 *
 * Written one array entry per line, so the line numbers the assertions cite
 * are counted rather than guessed.
 */
const FIXTURE_FILES: Readonly<Record<string, string>> = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
    },
    include: ["lib/**/*"],
  }),
  "docs/guide.md": "# a page a comment cites without fencing it\n",
  "docs/paired.md": "# the page a comment closes a name's parenthetical with\n",
  "docs/sections.md": [
    "# The page whose sections a comment cites",
    "",
    "> **Reading the fixture's own banner.** A bolded lead opening a quoted",
    "> line is a title too, stated where a page states its reading",
    "> conventions rather than as a bullet or a heading.",
    "",
    "## Loud or nothing",
    "",
    "A heading is a title, cited whole.",
    "",
    "## Derived state is computed, never restated beside its source",
    "",
    "- **Verbatim copying is the detector.** A bolded bullet lead is a title",
    "  too, and the sentence punctuation its own emphasis covers is the",
    "  prose's rather than the title's.",
    "",
    "```",
    "# A fenced heading mints no title",
    "",
    "- **A fenced lead mints none either.** a sample",
    "```",
    "",
  ].join("\n"),
  "guide.md": "# the root-level page a broken cite's tail answers instead\n",
  "release-notes.md": "# the root-level page a fenced cite names by hyphen\n",
  "lib/dataShapes.ts": [
    `/** Cites \`WeakMap\`, a lib global no statement in this tree uses. */`,
    `export interface Shipped {`,
    `  readonly maxDepth: number;`,
    `}`,
    ``,
    `/**`,
    ` * A declaration the module next door never imports, cited by a link tag`,
    ` * from the module that declares it: {@link unsharedHelper}.`,
    ` */`,
    `export const unsharedHelper = (): number => 1;`,
    ``,
    `/** The capitals spelling, declared here so a pair can name this door. */`,
    `export const MAX_DEPTH_LIMIT = 8;`,
    ``,
  ].join("\n"),
  "lib/surface.ts": [
    `import type { Shipped } from "./dataShapes.js";`,
    ``,
    `/** The kinds this tree holds as literals rather than as declarations. */`,
    `export const KINDS = ["blockedBy"] as const;`,
    ``,
    `export class Holder {`,
    `  constructor(private readonly opts: Shipped) {}`,
    ``,
    `  /**`,
    `   * Resolves: \`Shipped.maxDepth\` next door, \`blockedBy\` through the`,
    `   * literal above, \`this.opts.maxDepth\` past its keyword head, and`,
    `   * \`dataShapes.ts\` as a module of this tree. Dangles: \`vanishedHelper\`.`,
    `   * Judged by neither verdict: \`handoff\`, \`--dry-run\`.`,
    `   */`,
    `  read(): number {`,
    `    return this.opts.maxDepth;`,
    `  }`,
    `}`,
    ``,
    `// A string literal is not a comment, whatever it holds:`,
    `export const NOTE = "// \`vanishedInString\` names nothing either";`,
    ``,
    `export const ratio = (a: number, b: number): number => a / b / 2;`,
    ``,
    `// \`vanishedPastDivision\` sits behind the two slashes above, which a`,
    `// scan without the parse reads as one regular expression.`,
    `export const TAIL = 1;`,
    ``,
    `// The spellings admitted with no camel hump anywhere in them. Resolve:`,
    `// \`Holder\` on its leading capital, \`surface.ts\` on its dot. Dangle:`,
    `// \`Vanished\`, \`vanished.helper\`. Refused: \`VANISHED\`.`,
    `export const WIDE = 2;`,
    ``,
    `// The path spelling, answered by the working tree rather than the`,
    `// program: \`lib/dataShapes.ts\` names a file of this tree and`,
    `// \`tsconfig.json\` one at its root. Dangles: \`lib/vanished.ts\`.`,
    `// Refused: \`<configDir>/chain.ts\` and \`lib/*.ts\` carry a placeholder,`,
    `// \`refs/heads/main\` has no extension, \`./dataShapes.js\` is a specifier.`,
    `export const PATHS = 3;`,
    ``,
    `// A wrap leaves the span open at the line's end, and markdown joins it`,
    `// with a space: \`lib/`,
    `// dataShapes.ts\` names no file. Pairing resumes from the wrap's close,`,
    `// so \`Shipped\` behind it is read rather than taking the wrap's own`,
    `// backtick as its opening.`,
    `export const WRAPPED = 4;`,
    ``,
    `// A wrap breaks an identifier the same way, and closing the break is what`,
    `// reads it: \`Shipped.`,
    `// maxDepth\` is the member it meant, which markdown's space hides. A wrap`,
    `// carrying prose closes to no subject at all: \`not`,
    `// a citation\` keeps a space of its own whatever the break does.`,
    `export const BROKEN = 5;`,
    ``,
    `// The page name read without a fence, judged by the path arm all the`,
    `// same: (docs/guide.md) names a file this tree holds, and`,
    `// docs/vanished.md one it does not. Refused the way a fenced`,
    `// placeholder is: <area>/notes.md and docs/*.md name no one file.`,
    `export const PAGES = 6;`,
    ``,
    `// A page name the break splits is reported as the wrap, not judged as the`,
    `// tail: this comment cites docs/`,
    `// guide.md, a page whose tail a root-level page of that name answers.`,
    `export const SPLIT = 7;`,
    ``,
    `// A page name a fence carries with no directory ahead of it, judged by`,
    `// the arm every path ends on: \`release-notes.md\` names a file at this`,
    `// tree's root and \`vanished-notes.md\` names none, both spelled with a`,
    `// hyphen no identifier segment admits. Refused with the \`.\` a path`,
    `// segment refuses: \`.opts.maxDepth\` is a member access whose receiver`,
    `// the prose elided, not a dotfile.`,
    `export const FENCED_PAGES = 8;`,
    ``,
    `// The titles below are cited off the parse, not out of this comment.`,
    `declare const describe: (title: string, body: () => void) => void;`,
    `declare const it: (title: string, body: () => void) => void;`,
    ``,
    `describe("a title citing docs/guide.md, a page this tree holds", () => {`,
    `  it("a title citing docs/vanished.md beside \`vanishedInTitle\`", () => {});`,
    `  it("a title whose fenced \`release-notes.md\` is a page, \`Vanished\` not", () => {});`,
    `  it("a title citing <area>/notes.md, which names no one file", () => {});`,
    `});`,
    ``,
    `// The page-name arm is answered by the working tree and by nothing else:`,
    `// \`docs/retired.md\` and docs/withdrawn.md name no page here, whatever the`,
    `// array below spells. The identifier alphabet is untouched, so`,
    `// \`lib/retired.ts\` still resolves through that same literal.`,
    `export const RETIRED = ["docs/retired.md", "docs/withdrawn.md", "lib/retired.ts"];`,
    ``,
    `// A pair names the home, and the home is what answers it: \`Shipped\``,
    `// (\`lib/dataShapes.ts\`) is declared in the file the pair names. \`Holder\``,
    `// (\`lib/dataShapes.ts\`) is a declaration of this module cited at the wrong`,
    `// door, and \`WeakMap\` (\`lib/dataShapes.ts\`) is a global no module of this`,
    `// tree declares at all.`,
    `export const PAIRED = 9;`,
    ``,
    `// A path a sentence merely follows a name with is context: \`Holder\` is`,
    `// spelled by this module, and the file beside it (\`lib/dataShapes.ts\`) is`,
    `// where the pair above cites it, not where it lives. Nor does a pair open a`,
    `// parenthetical it does not close: \`WeakMap\` (\`lib/dataShapes.ts\`, with an`,
    `// aside behind it) claims no home either.`,
    `export const CONTEXT = 10;`,
    ``,
    `// A page is no home: \`Holder\` (\`docs/paired.md\`) closes the parenthetical`,
    `// tight, and still claims nothing — no declaration lives in a page, so the`,
    `// name keeps the trees at large and the page keeps the working tree.`,
    `// \`WeakMap\` (\`docs/absent.md\`) is that shape over a page this tree does`,
    `// not hold, which reds as the page it is rather than as a home.`,
    `export const PAGED = 11;`,
    ``,
    `// A section cite names a page and a section of it, at every altitude`,
    `// the page states one: a heading (\`docs/sections.md\`, *Loud or`,
    `// nothing*), a bolded bullet lead (docs/sections.md, *Verbatim`,
    `// copying is the detector*), and a bolded lead opening a blockquote`,
    `// line (\`docs/sections.md\`, *Reading the fixture's own banner*), the`,
    `// page half backticked or bare. A page this tree does not hold titles`,
    `// nothing, so a cite into one reds where the page name already does:`,
    `// (\`docs/absent.md\`, *Loud or nothing*).`,
    `export const SECTIONS = 12;`,
    ``,
    `// An abbreviation is a rewrite rather than a match, though the page`,
    `// opens a heading with those very words:`,
    `// (\`docs/sections.md\`, *Derived state is computed*).`,
    `export const ABBREVIATED = 13;`,
    ``,
    `// The section half is a phrase, so a comment line breaks it wherever`,
    `// the wrapping falls and the renderer puts the space back:`,
    `// (\`docs/sections.md\`, *Derived state is computed, never restated`,
    `// beside its source*) closes to the heading it names, where a broken`,
    `// token closes to nothing.`,
    `export const WRAPPED_SECTION = 14;`,
    ``,
    `// A fenced sample of that page mints no title, the way its fenced \`# \``,
    `// line mints no heading: (\`docs/sections.md\`, *A fenced lead mints`,
    `// none either*).`,
    `export const FENCED_SECTION = 15;`,
    ``,
    `// Nothing else is a cite: (\`docs/sections.md\`, *Loud or nothing* and`,
    `// an aside) leaves the parenthetical open past the italics, and`,
    `// (\`docs/sections.md\`) claims no section at all.`,
    `export const UNCITED = 16;`,
    ``,
    `// A link tag is judged on its syntax, so no subject rule is read over`,
    `// one: {@link Holder} is declared here, {@link Shipped} is imported from`,
    `// next door, {@link WeakMap} is a lib global, {@link Shipped.maxDepth} is`,
    `// a member of one, and {@linkcode ratio} and {@linkplain Holder | with`,
    `// a link text} are the tag's other two spellings.`,
    `export const LINKED = 17;`,
    ``,
    `// A reference the citing module cannot reach is one nothing follows:`,
    `// {@link unsharedHelper} is declared next door and imported nowhere`,
    `// here, which the backticked \`unsharedHelper\` beside it still resolves.`,
    `// {@link vanishedLink} names nothing anywhere, and {@link |only a label}`,
    `// names nothing at all.`,
    `export const UNLINKED = 18;`,
    ``,
    `// A tag the wrapping broke is one reference all the same, because the`,
    `// rendering closes the break before the target is read: {@link`,
    `// Holder} resolves where the unbroken spelling does.`,
    `export const WRAPPED_LINK = 19;`,
    ``,
    `// A pair carries a name in capitals the way it carries any other, because`,
    `// the home is what answers it: \`MAX_DEPTH_LIMIT\` (\`lib/dataShapes.ts\`) is`,
    `// declared in the file the pair names, and \`KINDS\` (\`lib/dataShapes.ts\`)`,
    `// is spelled by this module rather than that one. The underscore an`,
    `// identifier segment refuses is one of those spellings: \`VANISHED_NAME\``,
    `// (\`lib/dataShapes.ts\`) is declared nowhere at all. The same name at its`,
    `// own door resolves: \`KINDS\` (\`lib/surface.ts\`) is where this module`,
    `// spells it.`,
    `export const CAPS_PAIRED = 20;`,
    ``,
    `// Standing alone in prose the same spelling claims no home and is read as`,
    `// the word it is: \`SHOUTED\` is declared nowhere, and judging it would put`,
    `// a finding here.`,
    `export const CAPS_ALONE = 21;`,
    ``,
  ].join("\n"),
  "docs/carried.md": "# the page a tree outside the tsconfig cites\n",
  "tools/render.mjs": [
    `// A tree no tsconfig of this fixture reaches, so the program tier reads`,
    `// it as holding nothing. Fenced: \`docs/carried.md\` names a file this`,
    `// tree holds and \`docs/mislaid.md\` names none. Unfenced the same way:`,
    `// docs/carried.md again, and docs/strayed.md never.`,
    `export const RENDER = 1;`,
    ``,
    `// Judged by nothing here, because this arm carries the page rule alone:`,
    `// \`vanishedInTools\` is an identifier no declaration of this fixture`,
    `// holds, and <area>/notes.md carries a placeholder the charset refuses.`,
    `export const NARROW = 2;`,
    ``,
    `// A page name the break splits is reported as the wrap, never judged as`,
    `// the tail: this comment cites docs/`,
    `// carried.md, whose tail no page of this tree answers.`,
    `export const SPLIT_HERE = 3;`,
    ``,
  ].join("\n"),
  "cfg/chain.ts": [
    `// The named-file arm, reached without descending its directory:`,
    `// \`docs/carried.md\` resolves and docs/forsaken.md does not.`,
    `export const CHAIN = 1;`,
    ``,
  ].join("\n"),
  "cfg/worktrees/copy.ts": [
    `// A whole copy of the repo the named-file arm must not descend into:`,
    `// docs/undescended.md would be a finding if it did.`,
    `export const COPY = 1;`,
    ``,
  ].join("\n"),
};

/**
 * What the page-name arm adds to the three trees the program reaches: the
 * rest of the sweep domain (`.claude/rules/posture-sweep.md`, *The pages are
 * the authority as they read this tick*), plus the chain this repo runs every
 * tick.
 *
 * `bin/` and `scripts/` sit in no tsconfig this repo has, and `.flume/` also
 * holds the worktree checkouts a tick runs in (`spec/worktrees.md`) — whole
 * copies of this repo a tree walk would descend into and judge again — so the
 * chain is named as a file rather than swept as a tree.
 *
 * The two domains are exclusive by construction, and `SWEEP_DOMAIN` below is
 * what keeps them from drifting apart: a tree in neither is a tree whose page
 * names nothing judges.
 */
const PAGE_ARM_DOMAIN: ScanDomain = {
  trees: ["bin", "examples", "scripts"],
  files: [".flume/chain.ts"],
};

/**
 * Every tree the sweep domain names, as the posture page reads it this tick.
 * The union of the two scans' modules is asserted to cover it, so a tree
 * added to the sweep and to neither scan reds here rather than going unjudged.
 */
const SWEEP_DOMAIN: readonly string[] = [
  "src/",
  "harness/",
  "tests/",
  "bin/",
  "examples/",
  "scripts/",
];

let fixtureRoot = "";
/** The one scan of that tree — every case below reads the same verdict. */
let fixtureScan: CitationScan;
/** The one scan of this repo — both pins below read the same verdict. */
let repoScan: CitationScan;
/** The one page-arm scan of that fixture's trees no tsconfig reaches. */
let fixturePageScan: PageCitationScan;
/** The one page-arm scan of this repo's widened domain. */
let repoPageScan: PageCitationScan;

beforeAll(async () => {
  fixtureRoot = await mkTempDir("flume-citation-scan-");
  for (const [rel, body] of Object.entries(FIXTURE_FILES)) {
    const path = join(fixtureRoot, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  fixtureScan = scanCommentCitations({
    root: fixtureRoot,
    programConfig: "tsconfig.json",
    trees: ["lib/"],
  });
  repoScan = scanCommentCitations({
    root: REPO_ROOT,
    programConfig: "tsconfig.json",
    trees: ["src/", "harness/", "tests/"],
  });
  fixturePageScan = scanPageCitations({
    root: fixtureRoot,
    domain: { trees: ["tools"], files: ["cfg/chain.ts"] },
  });
  repoPageScan = scanPageCitations({
    root: REPO_ROOT,
    domain: PAGE_ARM_DOMAIN,
  });
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

it("the citation scan flags a backticked identifier no src/ or harness/ declaration holds", () => {
  const scan = fixtureScan;

  // Vacuity guard: both modules were read and the judged set is the one the
  // fixture authored, before any verdict is read off it. A scan that reached
  // one module, or judged nothing, would report its finding for the wrong
  // reason.
  expect([...scan.modules].sort()).toEqual([
    "lib/dataShapes.ts",
    "lib/surface.ts",
  ]);
  // Read as the vocabulary rather than the roll: the pair cases at the foot
  // of the fixture cite several of these names a second time, at a home, and
  // which sites carry which name is what `findings` below states by line.
  expect([...new Set(scan.scanned.map((s) => s.text))].sort()).toEqual([
    "Holder",
    "KINDS",
    "MAX_DEPTH_LIMIT",
    "Shipped",
    "Shipped.maxDepth",
    "VANISHED_NAME",
    "Vanished",
    "WeakMap",
    "blockedBy",
    "dataShapes.ts",
    "docs/absent.md",
    "docs/guide.md",
    "docs/paired.md",
    "docs/retired.md",
    "docs/sections.md",
    "docs/vanished.md",
    "docs/withdrawn.md",
    "lib/dataShapes.ts",
    "lib/retired.ts",
    "lib/surface.ts",
    "lib/vanished.ts",
    "release-notes.md",
    "surface.ts",
    "this.opts.maxDepth",
    "tsconfig.json",
    "unsharedHelper",
    "vanished-notes.md",
    "vanished.helper",
    "vanishedHelper",
    "vanishedPastDivision",
  ]);

  expect(scan.findings.map(formatCitation)).toEqual([
    "lib/surface.ts:12 vanishedHelper",
    "lib/surface.ts:25 vanishedPastDivision",
    "lib/surface.ts:31 Vanished",
    "lib/surface.ts:31 vanished.helper",
    "lib/surface.ts:36 lib/vanished.ts",
    "lib/surface.ts:57 docs/vanished.md",
    "lib/surface.ts:68 vanished-notes.md",
    "lib/surface.ts:85 docs/retired.md",
    "lib/surface.ts:85 docs/withdrawn.md",
    "lib/surface.ts:91 Holder",
    "lib/surface.ts:93 WeakMap",
    "lib/surface.ts:107 docs/absent.md",
    "lib/surface.ts:118 docs/absent.md",
    "lib/surface.ts:164 KINDS",
    "lib/surface.ts:166 VANISHED_NAME",
  ]);

  // Every resolution arm fired, so the two findings above are a
  // discrimination rather than a scan that flagged what it could not classify.
  expect([...new Set(scan.resolved.map((s) => s.text))].sort()).toEqual([
    "Holder",
    "KINDS",
    "MAX_DEPTH_LIMIT",
    "Shipped",
    "Shipped.maxDepth",
    "WeakMap",
    "blockedBy",
    "dataShapes.ts",
    "docs/guide.md",
    "docs/paired.md",
    "docs/sections.md",
    "lib/dataShapes.ts",
    "lib/retired.ts",
    "lib/surface.ts",
    "release-notes.md",
    "surface.ts",
    "this.opts.maxDepth",
    "tsconfig.json",
    "unsharedHelper",
  ]);

  // A backtick inside a string literal is no citation: the reader takes
  // comments off the parse, so this name is not even a span it saw.
  const spans = scan.backticked.map((s) => s.text);
  expect(spans).not.toContain("vanishedInString");

  // The subject filter discriminates rather than the scan missing it: the
  // flag was read as a span and no segment of it is an identifier.
  expect(spans).toContain("--dry-run");
});

// --- the spellings the subject rule turns on -----------------------------

it("the citation scan resolves a link tag against the module whose comment carries it", () => {
  const scan = fixtureScan;

  // Vacuity guard: the tags were read, both modules of the fixture carry
  // one, and the judged set is the one the fixture authored — before any
  // verdict is read off it. A tag reader that stopped matching would report
  // a clean tree over zero references.
  expect(scan.links.scanned.map(formatCitation)).toEqual([
    "lib/dataShapes.ts:8 unsharedHelper",
    "lib/surface.ts:144 Holder",
    "lib/surface.ts:144 Shipped",
    "lib/surface.ts:145 WeakMap",
    "lib/surface.ts:145 Shipped.maxDepth",
    "lib/surface.ts:146 ratio",
    "lib/surface.ts:146 Holder",
    "lib/surface.ts:151 unsharedHelper",
    "lib/surface.ts:153 vanishedLink",
    "lib/surface.ts:153 ",
    "lib/surface.ts:158 Holder",
  ]);

  expect(scan.links.findings.map(formatCitation)).toEqual([
    "lib/surface.ts:151 unsharedHelper",
    "lib/surface.ts:153 vanishedLink",
    "lib/surface.ts:153 ",
  ]);

  // The whole of the arm's claim, in one name: `unsharedHelper` is a
  // reference the module that declares it follows and the module next door
  // does not, and the two verdicts over it differ by nothing but which
  // comment carried the tag.
  const answered = new Set(
    scan.links.scanned
      .filter((site) => !scan.links.findings.includes(site))
      .map(formatCitation),
  );
  expect(answered.has("lib/dataShapes.ts:8 unsharedHelper")).toBe(true);

  // And the backticked arm reads that same name the other way, from the same
  // comment: the two are a discrimination rather than one rule spelled twice.
  expect(scan.resolved.map((s) => s.text)).toContain("unsharedHelper");
});

it("the citation scan judges a dotted citation whose segments carry no internal capital", () => {
  // Vacuity guard: both spans were read off the fixture, and no segment of
  // either — `surface`, `ts`, `vanished`, `helper` — carries a capital at
  // all, so the dot is the only thing that can have admitted them.
  const dotted = fixtureScan.backticked.filter((site) =>
    ["surface.ts", "vanished.helper"].includes(site.text),
  );
  expect(dotted.map(formatCitation)).toEqual([
    "lib/surface.ts:30 surface.ts",
    "lib/surface.ts:31 vanished.helper",
  ]);

  // Judged, and judged in both directions: the module of this tree resolves
  // and the pair naming nothing dangles.
  expect(fixtureScan.resolved.map((s) => s.text)).toContain("surface.ts");
  expect(fixtureScan.findings.map(formatCitation)).toContain(
    "lib/surface.ts:31 vanished.helper",
  );
});

it("the citation scan judges a leading-capital citation whose name carries no internal capital", () => {
  // Vacuity guard: both spans were read, and neither `Holder` nor `Vanished`
  // has a hump after its first letter — the leading capital is the whole
  // claim.
  const leading = fixtureScan.backticked.filter((site) =>
    ["Holder", "Vanished"].includes(site.text),
  );
  expect(leading.map(formatCitation)).toEqual([
    "lib/surface.ts:30 Holder",
    "lib/surface.ts:31 Vanished",
    "lib/surface.ts:91 Holder",
    "lib/surface.ts:97 Holder",
    "lib/surface.ts:104 Holder",
  ]);

  expect(fixtureScan.resolved.map((s) => s.text)).toContain("Holder");
  expect(fixtureScan.findings.map(formatCitation)).toContain(
    "lib/surface.ts:31 Vanished",
  );
});

it("the citation scan judges neither a single lowercase word nor an all-caps word", () => {
  // Vacuity guard: each was read as a span, so the refusal below is the
  // subject rule discriminating and not the reader missing the comment.
  const spans = fixtureScan.backticked.map((s) => s.text);
  expect(spans).toContain("handoff");
  expect(spans).toContain("VANISHED");

  // Neither names anything the tree declares, so admitting either would show
  // up as a dangling finding rather than passing quietly.
  const judged = fixtureScan.scanned.map((s) => s.text);
  expect(judged).not.toContain("handoff");
  expect(judged).not.toContain("VANISHED");
});

// --- the path arm, answered by the working tree --------------------------

it("the citation scan resolves a repo-relative path citation against the working tree", () => {
  // Vacuity guard: both spans were read and both were judged, so the verdict
  // below is the resolution arm and not a span the subject rule skipped.
  const paths = fixtureScan.scanned.filter((site) =>
    ["lib/dataShapes.ts", "tsconfig.json"].includes(site.text),
  );
  expect(paths.map(formatCitation)).toEqual([
    "lib/surface.ts:35 lib/dataShapes.ts",
    "lib/surface.ts:36 tsconfig.json",
    "lib/surface.ts:91 lib/dataShapes.ts",
    "lib/surface.ts:92 lib/dataShapes.ts",
    "lib/surface.ts:93 lib/dataShapes.ts",
    "lib/surface.ts:98 lib/dataShapes.ts",
    "lib/surface.ts:100 lib/dataShapes.ts",
    "lib/surface.ts:163 lib/dataShapes.ts",
    "lib/surface.ts:164 lib/dataShapes.ts",
    "lib/surface.ts:167 lib/dataShapes.ts",
  ]);

  // Neither is a token of the program: `lib/dataShapes.ts` names the module
  // by a path no declaration spells, and `tsconfig.json` is not in the
  // program at all — the tree on disk is the only thing that can answer them.
  expect(fixtureScan.resolved.map(formatCitation)).toContain(
    "lib/surface.ts:35 lib/dataShapes.ts",
  );
  expect(fixtureScan.resolved.map(formatCitation)).toContain(
    "lib/surface.ts:36 tsconfig.json",
  );
});

it("the citation scan flags a repo-relative path citation naming no file on disk", () => {
  // Vacuity guard: the span was read, and its sibling one directory over
  // resolves, so the finding is the path arm discriminating rather than a
  // scan that could not reach `lib/` at all.
  expect(fixtureScan.backticked.map((s) => s.text)).toContain(
    "lib/vanished.ts",
  );
  expect(fixtureScan.resolved.map((s) => s.text)).toContain(
    "lib/dataShapes.ts",
  );

  expect(fixtureScan.findings.map(formatCitation)).toContain(
    "lib/surface.ts:36 lib/vanished.ts",
  );
});

it("the citation scan judges no backticked span carrying a path placeholder", () => {
  // Vacuity guard: each was read as a span, so the refusal below is the
  // subject rule discriminating and not the reader missing the comment.
  const spans = fixtureScan.backticked.map((s) => s.text);
  expect(spans).toContain("<configDir>/chain.ts");
  expect(spans).toContain("lib/*.ts");

  // A placeholder names no one file, so the working tree cannot answer it:
  // judging either would be a standing dangling finding nothing can repair.
  const judged = fixtureScan.scanned.map((s) => s.text);
  expect(judged).not.toContain("<configDir>/chain.ts");
  expect(judged).not.toContain("lib/*.ts");
});

it("the citation scan judges neither an extensionless path nor a relative specifier", () => {
  // Vacuity guard: both were read as spans before the refusal is read.
  const spans = fixtureScan.backticked.map((s) => s.text);
  expect(spans).toContain("refs/heads/main");
  expect(spans).toContain("./dataShapes.js");

  // Both are paths in an alphabet the working tree does not answer: a git
  // ref, and a specifier read from the importer rather than from the root.
  const judged = fixtureScan.scanned.map((s) => s.text);
  expect(judged).not.toContain("refs/heads/main");
  expect(judged).not.toContain("./dataShapes.js");
});

it("the citation scan judges a backticked page name whose spelling carries a hyphen", () => {
  // Vacuity guard: both spans were read off the fixture, and neither carries
  // the slash that routes a span to the path arm — the extension is the whole
  // claim, on a spelling the identifier charset refuses outright.
  const pages = fixtureScan.backticked.filter((site) =>
    ["release-notes.md", "vanished-notes.md"].includes(site.text),
  );
  expect(pages.map(formatCitation)).toEqual([
    "lib/surface.ts:67 release-notes.md",
    "lib/surface.ts:68 vanished-notes.md",
  ]);
  expect(pages.filter((site) => site.text.includes("/"))).toEqual([]);

  // Judged, and judged in both directions by the arm the slashed paths go
  // through: the page at this tree's root resolves against the working tree
  // and the one no tree holds dangles. Unjudged, renaming either would leave
  // every comment citing it standing.
  expect(fixtureScan.resolved.map(formatCitation)).toContain(
    "lib/surface.ts:67 release-notes.md",
  );
  expect(fixtureScan.findings.map(formatCitation)).toContain(
    "lib/surface.ts:68 vanished-notes.md",
  );
});

it("the citation scan judges no backticked member access spelled with a leading dot", () => {
  // Vacuity guard: both were read as spans, so the refusal below is the
  // subject rule discriminating and not the reader missing the comment.
  const spans = fixtureScan.backticked.map((s) => s.text);
  expect(spans).toContain(".opts.maxDepth");
  expect(spans).toContain(".");

  // A leading dot spells two things at once — a root-level dotfile and a
  // receiver the prose elided — and `.opts.maxDepth` ends in a named
  // extension the filename arm would otherwise admit. Judging it would be a
  // standing dangling finding no rename can repair.
  const judged = fixtureScan.scanned.map((s) => s.text);
  expect(judged).not.toContain(".opts.maxDepth");
  expect(judged).not.toContain(".");
});

// --- the wrap, which no subject spelling can survive ---------------------

it("the citation scan reports a backticked span its comment line leaves open", () => {
  // Vacuity guard: every other comment in the fixture closes its spans on the
  // line that opened them, so the four reports below are the wraps the
  // fixture authored rather than a parity artifact of some earlier comment.
  expect(fixtureScan.wraps.scanned.map(formatCitation)).toEqual([
    "lib/surface.ts:42 lib/ dataShapes.ts",
    "lib/surface.ts:49 Shipped. maxDepth",
    "lib/surface.ts:51 not a citation",
    "lib/surface.ts:62 docs/ guide.md",
  ]);

  // Reported because nothing else can reach it: neither half is a span of its
  // own, and the joined text carries the space markdown puts at the break,
  // which no path segment admits. Renaming the file it names would otherwise
  // leave the citation standing.
  expect(fixtureScan.backticked.filter((s) => s.line === 42)).toEqual([]);
  expect(fixtureScan.scanned.map((s) => s.text)).not.toContain(
    "lib/ dataShapes.ts",
  );

  // And the wrap costs only itself: pairing resumes from its close, so the
  // citation behind it is read in its own right instead of pairing with the
  // wrap's backtick and taking every span after it out of step.
  expect(fixtureScan.resolved.map(formatCitation)).toContain(
    "lib/surface.ts:44 Shipped",
  );
});

it("the citation scan reports a wrapped span that names a subject once its break is closed", () => {
  // Vacuity guard: all four wraps were read and closed, in both alphabets,
  // in both fencings and in prose, before any subset of them is judged.
  // Closing the break removes the break alone — the prose span keeps the
  // space it spelled itself, which is why it closes to no subject.
  expect(fixtureScan.wraps.scanned.map((s) => s.closed)).toEqual([
    "lib/dataShapes.ts",
    "Shipped.maxDepth",
    "nota citation",
    "docs/guide.md",
  ]);

  // The three that close to a name are reported as broken citations, and the
  // one that closes to prose is not: the wrap is read by the subject rule the
  // judged set is held to, in either alphabet, rather than by the slash.
  expect(fixtureScan.wraps.findings.map(formatCitation)).toEqual([
    "lib/surface.ts:42 lib/ dataShapes.ts",
    "lib/surface.ts:49 Shipped. maxDepth",
    "lib/surface.ts:62 docs/ guide.md",
  ]);

  // Reported because nothing else can reach the identifier wrap either: the
  // member it names resolves when spelled on one line, and carries markdown's
  // space when the author wraps it, so no resolution arm answers it.
  expect(fixtureScan.resolved.map((s) => s.text)).toContain("Shipped.maxDepth");
  expect(fixtureScan.scanned.map((s) => s.text)).not.toContain(
    "Shipped. maxDepth",
  );
});

// --- the page name no backtick fences -----------------------------------

it("the citation scan judges an unbackticked *.md page name in a comment", () => {
  // Vacuity guard: the fixture fences neither name anywhere, so the
  // backticked arm cannot be what reached them, and both were collected with
  // the brackets prose put around the first one already off.
  expect(fixtureScan.backticked.map((s) => s.text)).not.toContain(
    "docs/guide.md",
  );
  expect(fixtureScan.bare.map(formatCitation)).toEqual([
    "lib/surface.ts:56 docs/guide.md",
    "lib/surface.ts:57 docs/vanished.md",
    "lib/surface.ts:58 <area>/notes.md",
    "lib/surface.ts:58 docs/*.md",
    "lib/surface.ts:85 docs/withdrawn.md",
    "lib/surface.ts:113 docs/sections.md",
  ]);

  // Judged, and judged in both directions by the arm the fenced paths go
  // through: the page this tree holds resolves against the working tree and
  // the one it does not dangles.
  expect(fixtureScan.resolved.map(formatCitation)).toContain(
    "lib/surface.ts:56 docs/guide.md",
  );
  expect(fixtureScan.findings.map(formatCitation)).toContain(
    "lib/surface.ts:57 docs/vanished.md",
  );
});

it("the citation scan judges no unbackticked *.md name carrying a path placeholder", () => {
  // Vacuity guard: each was collected as a page name, so the refusal below
  // is the subject rule discriminating and not the reader missing the token.
  const collected = fixtureScan.bare.map((s) => s.text);
  expect(collected).toContain("<area>/notes.md");
  expect(collected).toContain("docs/*.md");

  // A placeholder names no one file, so no working tree can answer it:
  // judging either would be a standing dangling finding nothing can repair.
  // The same verdict the fenced placeholders get, off the same charset.
  const judged = fixtureScan.scanned.map((s) => s.text);
  expect(judged).not.toContain("<area>/notes.md");
  expect(judged).not.toContain("docs/*.md");
});

it("the citation scan reports an unfenced page name broken across a comment line", () => {
  // Vacuity guard: no backtick fences either half of this comment, so the
  // report below is the bare arm's own reading and not the backticked wrap
  // arm reaching it. And the page it cites resolves when a comment spells it
  // on one line, so what the wrap costs is the citation, not the answer.
  expect(
    fixtureScan.backticked.filter((s) => s.line >= 61 && s.line <= 63),
  ).toEqual([]);
  expect(fixtureScan.resolved.map((s) => s.text)).toContain("docs/guide.md");

  // Reported through the set the fenced wraps are reported into, read both
  // ways that break reads: as markdown joins it, and as the author spelled it
  // before the wrap — which is a subject, so it is a citation the break took.
  expect(fixtureScan.wraps.scanned.map(formatCitation)).toContain(
    "lib/surface.ts:62 docs/ guide.md",
  );
  expect(fixtureScan.wraps.scanned.find((s) => s.line === 62)?.closed).toBe(
    "docs/guide.md",
  );
  expect(fixtureScan.wraps.findings.map(formatCitation)).toContain(
    "lib/surface.ts:62 docs/ guide.md",
  );
});

it("the citation scan judges no tail an unfenced page name's line break left behind", () => {
  // Vacuity guard: the fixture holds a page at the root under the tail's own
  // basename, and the bare arm is collecting page names in this tree, so
  // judging the tail would *resolve* — quietly, under a cite no author
  // wrote — rather than dangle where a reader would meet it.
  expect(existsSync(join(fixtureRoot, "guide.md"))).toBe(true);
  expect(fixtureScan.bare.length).toBeGreaterThan(0);

  // Collected by neither arm, so judged by nothing: the wrap is the whole
  // report, and the page the author never named answers nothing.
  expect(fixtureScan.bare.map(formatCitation)).not.toContain(
    "lib/surface.ts:63 guide.md",
  );
  expect(fixtureScan.scanned.map((s) => s.text)).not.toContain("guide.md");
  expect(fixtureScan.resolved.map((s) => s.text)).not.toContain("guide.md");
});

// --- the pair, which names the home the token must sit in ----------------

it("a comment pairing an identifier with a repo-relative path reds when the declaration is not in that file", () => {
  // Vacuity guard: every pair the fixture authored was drawn, all naming the
  // one home, so the split verdict below is the declaration set
  // discriminating rather than a scan that drew no pair at all.
  expect(
    fixtureScan.pairs.map((site) => `${formatCitation(site)} -> ${site.home}`),
  ).toEqual([
    "lib/surface.ts:90 Shipped -> lib/dataShapes.ts",
    "lib/surface.ts:91 Holder -> lib/dataShapes.ts",
    "lib/surface.ts:93 WeakMap -> lib/dataShapes.ts",
    "lib/surface.ts:163 MAX_DEPTH_LIMIT -> lib/dataShapes.ts",
    "lib/surface.ts:164 KINDS -> lib/dataShapes.ts",
    "lib/surface.ts:166 VANISHED_NAME -> lib/dataShapes.ts",
    "lib/surface.ts:168 KINDS -> lib/surface.ts",
  ]);

  // And each of the three resolves where a comment cites it unpaired — the
  // reading the home arm has to displace. Without this the two findings below
  // would be names the fixture never declared anywhere.
  const resolved = fixtureScan.resolved.map(formatCitation);
  expect(resolved).toContain("lib/surface.ts:44 Shipped");
  expect(resolved).toContain("lib/surface.ts:97 Holder");
  expect(resolved).toContain("lib/surface.ts:100 WeakMap");

  // The verdict: the pair naming the declaration's own file resolves, and the
  // two naming a file the declaration does not sit in red — one a declaration
  // of the citing module, one a lib global declared outside the tree
  // altogether. Answered by the token set, a split that moved either symbol
  // out of the file its pair names would leave the citation standing.
  expect(resolved).toContain("lib/surface.ts:90 Shipped");
  const findings = fixtureScan.findings.map(formatCitation);
  expect(findings).toContain("lib/surface.ts:91 Holder");
  expect(findings).toContain("lib/surface.ts:93 WeakMap");
});

it("a repo-relative path a comment names on its own is read as context, never as a pair", () => {
  // Vacuity guard: both names were read as spans and the path each sits
  // beside was judged, so the verdict is the pair rule declining to draw
  // rather than a reader that never saw the citations. And the pair arm is
  // live on these same two names a few lines up, where it reds both.
  const judged = fixtureScan.scanned.map(formatCitation);
  expect(judged).toContain("lib/surface.ts:97 Holder");
  expect(judged).toContain("lib/surface.ts:98 lib/dataShapes.ts");
  expect(judged).toContain("lib/surface.ts:100 WeakMap");
  expect(judged).toContain("lib/surface.ts:100 lib/dataShapes.ts");
  expect(fixtureScan.findings.map(formatCitation)).toContain(
    "lib/surface.ts:91 Holder",
  );

  // Neither spelling is a pair: a path a sentence follows a name with is
  // context, and a parenthetical the path opens without closing is a citation
  // standing beside a name. Drawn from either, both names would red at a home
  // no declaration of them sits in — instead both resolve against the trees.
  expect(fixtureScan.pairs.map((site) => site.line)).not.toContain(97);
  expect(fixtureScan.pairs.map((site) => site.line)).not.toContain(100);
  const resolved = fixtureScan.resolved.map(formatCitation);
  expect(resolved).toContain("lib/surface.ts:97 Holder");
  expect(resolved).toContain("lib/surface.ts:100 WeakMap");
});

it("an identifier a comment pairs with a .md page resolves repo-wide rather than inside that page", () => {
  // Vacuity guard: both spans of both parentheticals were judged, and the
  // pair arm is live on these same two names a few lines up, where it reds
  // both at a home. So the verdict below is the page-home refusal rather
  // than a reader that never saw the citations or a pair arm gone quiet.
  const judged = fixtureScan.scanned.map(formatCitation);
  expect(judged).toContain("lib/surface.ts:104 Holder");
  expect(judged).toContain("lib/surface.ts:104 docs/paired.md");
  expect(judged).toContain("lib/surface.ts:107 WeakMap");
  expect(judged).toContain("lib/surface.ts:107 docs/absent.md");
  const pairedFindings = fixtureScan.findings.map(formatCitation);
  expect(pairedFindings).toContain("lib/surface.ts:91 Holder");
  expect(pairedFindings).toContain("lib/surface.ts:93 WeakMap");

  // No pair is drawn from either, though the path closes the parenthetical
  // tight: a page declares nothing, so a home read out of one would red every
  // name cited at it.
  expect(fixtureScan.pairs.map((site) => site.line)).not.toContain(104);
  expect(fixtureScan.pairs.map((site) => site.line)).not.toContain(107);

  // So both spans keep the arms they already have: the names resolve against
  // the trees at large — `WeakMap` is declared in no module of this tree at
  // all, which is what the home arm reds it for — and the pages are answered
  // by the working tree, one holding and one not.
  const resolved = fixtureScan.resolved.map(formatCitation);
  expect(resolved).toContain("lib/surface.ts:104 Holder");
  expect(resolved).toContain("lib/surface.ts:107 WeakMap");
  expect(resolved).toContain("lib/surface.ts:104 docs/paired.md");
  expect(pairedFindings).toContain("lib/surface.ts:107 docs/absent.md");
});

it("a comment pairing an all-caps name with a repo-relative path reds when that file holds no such declaration", () => {
  // Vacuity guard: all three capitals pairs were drawn, so the split verdict
  // below is the declaration set discriminating rather than a subject rule
  // that let the spelling fall out of the pair arm.
  const caps = fixtureScan.pairs.filter((site) => site.line >= 163);
  expect(caps.map((site) => `${formatCitation(site)} -> ${site.home}`)).toEqual(
    [
      "lib/surface.ts:163 MAX_DEPTH_LIMIT -> lib/dataShapes.ts",
      "lib/surface.ts:164 KINDS -> lib/dataShapes.ts",
      "lib/surface.ts:166 VANISHED_NAME -> lib/dataShapes.ts",
      "lib/surface.ts:168 KINDS -> lib/surface.ts",
    ],
  );

  // And `KINDS` resolves where the fixture does declare it, which is the
  // reading the wrong door has to displace. Without it the finding below
  // would be a name the fixture never declared anywhere. The capitals fence
  // leaves the name uncitable standing alone, so its own door is where the
  // resolving reading is shown.
  expect(fixtureScan.resolved.map(formatCitation)).toContain(
    "lib/surface.ts:168 KINDS",
  );

  // The verdict: the capitals name declared in the file its pair names
  // resolves, and the two the file does not declare red — one spelled by the
  // citing module, one by nothing at all. The underscore rides along, because
  // a pair reads the whole span as the name it is.
  const resolved = fixtureScan.resolved.map(formatCitation);
  expect(resolved).toContain("lib/surface.ts:163 MAX_DEPTH_LIMIT");
  const findings = fixtureScan.findings.map(formatCitation);
  expect(findings).toContain("lib/surface.ts:164 KINDS");
  expect(findings).toContain("lib/surface.ts:166 VANISHED_NAME");
});

it("a backticked word in capitals alone is judged as prose rather than as a citation subject", () => {
  // Vacuity guard: both spans were read, so the refusal below is the subject
  // rule discriminating and not a reader that missed the comments. And the
  // pair arm is drawing on this fixture, so the absence of one at the second
  // span is the gap rule declining rather than the arm gone quiet.
  const spans = fixtureScan.backticked.map(formatCitation);
  expect(spans).toContain("lib/surface.ts:31 VANISHED");
  expect(spans).toContain("lib/surface.ts:173 SHOUTED");
  expect(fixtureScan.findings.map(formatCitation)).toContain(
    "lib/surface.ts:91 Holder",
  );

  // Neither claims a home, so neither is judged: the capitals fence is lifted
  // by the pair and by nothing else. Admitting either would show up as a
  // dangling finding, because the fixture declares neither name.
  expect(fixtureScan.pairs.map((site) => site.line)).not.toContain(173);
  const judged = fixtureScan.scanned.map((s) => s.text);
  expect(judged).not.toContain("VANISHED");
  expect(judged).not.toContain("SHOUTED");
});

// --- the section, which the named page's own titles answer ---------------

it("a comment's (`<page>.md`, *Section*) pair resolves its section half against the page's headings, bolded bullet leads and a bolded lead opening a blockquote line", () => {
  // Vacuity guard: every cite the fixture authored was drawn, and no other,
  // before a verdict is read off any of them — both fencings of the page
  // half, each of the three altitudes the page states a title at, and the
  // wrap the renderer closes. The two spellings below the last of these are
  // the refusals: a parenthetical the italics do not close, and one carrying
  // no section at all, neither of which appears here.
  expect(
    fixtureScan.sections.scanned.map(
      (site) => `${formatCitation(site)} -> ${site.page}`,
    ),
  ).toEqual([
    "lib/surface.ts:112 Loud or nothing -> docs/sections.md",
    "lib/surface.ts:113 Verbatim copying is the detector -> docs/sections.md",
    "lib/surface.ts:115 Reading the fixture's own banner -> docs/sections.md",
    "lib/surface.ts:118 Loud or nothing -> docs/absent.md",
    "lib/surface.ts:123 Derived state is computed -> docs/sections.md",
    "lib/surface.ts:128 Derived state is computed, never restated beside its source -> docs/sections.md",
    "lib/surface.ts:134 A fenced lead mints none either -> docs/sections.md",
  ]);

  // The verdict: a heading answers a cite, a bolded bullet lead answers one
  // too — the page half bare there, so the fence is the author's and not the
  // rule's — a bolded lead opening a blockquote line answers one the same
  // way, and a phrase the comment line broke is closed the way markdown
  // closes it rather than lost the way a broken token is.
  const findings = fixtureScan.sections.findings.map(formatCitation);
  expect(findings).not.toContain("lib/surface.ts:112 Loud or nothing");
  expect(findings).not.toContain(
    "lib/surface.ts:113 Verbatim copying is the detector",
  );
  expect(findings).not.toContain(
    "lib/surface.ts:115 Reading the fixture's own banner",
  );
  expect(findings).not.toContain(
    "lib/surface.ts:128 Derived state is computed, never restated beside its source",
  );

  // And the named page is what answers. The same section spelled at a page
  // this tree does not hold reds, so the arm reads the page the cite names
  // rather than whichever page of the tree happens to carry the title.
  expect(findings).toContain("lib/surface.ts:118 Loud or nothing");

  // A title only a fenced sample of that page carries is no title, on the
  // rule that makes a fenced `# ` line no heading.
  expect(findings).toContain(
    "lib/surface.ts:134 A fenced lead mints none either",
  );
});

it("an abbreviated section half is reported unresolved rather than matched as a prefix", () => {
  // Vacuity guard: the cite was drawn, the page does open a heading with
  // those very words, and the cite spelling that heading whole resolves a
  // few lines down. So the finding below is the exactness rule and not a
  // page that lost the section or a reader that never saw the cite.
  const drawn = fixtureScan.sections.scanned.map(formatCitation);
  expect(drawn).toContain("lib/surface.ts:123 Derived state is computed");
  const findings = fixtureScan.sections.findings.map(formatCitation);
  expect(findings).not.toContain(
    "lib/surface.ts:128 Derived state is computed, never restated beside its source",
  );

  // The verdict: a prefix of a title is a title the page does not carry, so
  // the abbreviation is a rewrite the citing comment has to follow.
  expect(findings).toContain("lib/surface.ts:123 Derived state is computed");
});

// --- the title, which carries the page-name arm alone --------------------

it("the citation scan judges an unbackticked *.md page name a describe or it title carries", () => {
  // Vacuity guard: all four titles were read off the parse — the describe and
  // its three nested its — before any verdict is read off them. A collector
  // that reached none of them would report a clean tree over zero titles.
  expect(fixtureScan.titled.map(formatCitation)).toEqual([
    "lib/surface.ts:78 a title citing docs/guide.md, a page this tree holds",
    "lib/surface.ts:79 a title citing docs/vanished.md beside `vanishedInTitle`",
    "lib/surface.ts:80 a title whose fenced `release-notes.md` is a page, `Vanished` not",
    "lib/surface.ts:81 a title citing <area>/notes.md, which names no one file",
  ]);

  // The page names those titles carry, by the arm that reads them unfenced in
  // a comment: the placeholder in the fourth title is refused on the same
  // charset, so it is judged by nothing and can never be a standing finding.
  expect(fixtureScan.titles.scanned.map(formatCitation)).toEqual([
    "lib/surface.ts:78 docs/guide.md",
    "lib/surface.ts:79 docs/vanished.md",
    "lib/surface.ts:80 release-notes.md",
  ]);

  // Judged in both directions against the working tree and nothing else: the
  // page this tree holds resolves and the one it does not dangles. Unjudged,
  // renaming the page would leave every title citing it standing.
  expect(fixtureScan.titles.findings.map(formatCitation)).toEqual([
    "lib/surface.ts:79 docs/vanished.md",
  ]);
});

it("the citation scan judges a title's page name and not a backticked identifier beside it", () => {
  // Vacuity guard: the two titles were read whole, backticks and all, so the
  // verdict below is the title arm discriminating and not a reader that never
  // saw the names. And the identifier arm is live on this same fixture — it
  // flags `vanishedHelper` out of a comment — so leaving these alone is a
  // scope, not an omission.
  const titles = fixtureScan.titled.map((site) => site.text);
  expect(titles.some((text) => text.includes("`vanishedInTitle`"))).toBe(true);
  expect(titles.some((text) => text.includes("`Vanished`"))).toBe(true);
  expect(fixtureScan.findings.map((s) => s.text)).toContain("vanishedHelper");

  // The fence comes off — a title reaches no fenced arm, so a backtick there
  // is decoration the way a paren is — and what is under it is judged only
  // when it is a page. `Vanished` and `vanishedInTitle` name nothing this tree
  // holds, so admitting either would show up as a finding rather than quietly.
  const judged = fixtureScan.titles.scanned.map((s) => s.text);
  expect(judged).toContain("release-notes.md");
  expect(judged).not.toContain("Vanished");
  expect(judged).not.toContain("vanishedInTitle");
  expect(fixtureScan.titles.findings.map((s) => s.text)).toEqual([
    "docs/vanished.md",
  ]);
});

it("a comment's page name is answered by the working tree, never by a string literal a judged tree carries", () => {
  // Vacuity guard: both page names were collected, one fenced and one bare,
  // and both are judged — so the verdict below is the page-name arm declining
  // a token rather than a reader that never saw either citation.
  const judged = fixtureScan.scanned.map((s) => s.text);
  expect(fixtureScan.backticked.map((s) => s.text)).toContain(
    "docs/retired.md",
  );
  expect(fixtureScan.bare.map((s) => s.text)).toContain("docs/withdrawn.md");
  expect(judged).toContain("docs/retired.md");
  expect(judged).toContain("docs/withdrawn.md");

  // And the literal spelling both is a token of this tree, which is the arm
  // that must not answer here: every other citation shape resolves through
  // it, so without this the emptiness below would be a tree that happens to
  // spell neither name.
  expect(fixtureScan.resolved.map((s) => s.text)).toContain("lib/retired.ts");
  expect(existsSync(join(fixtureRoot, "lib", "retired.ts"))).toBe(false);

  // The verdict: no file of this tree holds either page, so both dangle
  // however the array below them spells them. Answered by the token set, a
  // page the repo renamed away would leave every comment citing it standing.
  const findings = fixtureScan.findings.map((s) => s.text);
  expect(findings).toContain("docs/retired.md");
  expect(findings).toContain("docs/withdrawn.md");

  // The widened set over this repo, which is where the arm earns its keep:
  // page names are cited in quantity and in both fencings, so the emptiness
  // the pin below asserts is read over a populated set rather than over the
  // handful a narrowed collector would leave.
  const pages = repoScan.scanned.filter((site) => site.text.endsWith(".md"));
  const fenced = new Set<CitationSite>(repoScan.backticked);
  expect(pages.length).toBeGreaterThan(1000);
  expect(pages.filter((site) => fenced.has(site)).length).toBeGreaterThan(400);
  expect(pages.filter((site) => !fenced.has(site)).length).toBeGreaterThan(400);
});

// --- the page-name arm, over the trees no program reaches ----------------

it("the page-name scan judges a page a comment cites in a tree no tsconfig reaches", () => {
  // Vacuity guard: the walk reached the tree's module and the named file, and
  // stopped at the named file rather than descending its directory — a walk
  // that descended would carry the module one level under it, and the page
  // name that module cites would join the verdict below.
  expect([...fixturePageScan.modules].sort()).toEqual([
    "cfg/chain.ts",
    "tools/render.mjs",
  ]);

  // Both fencings were collected, so the verdict below is read over a
  // populated set in each alphabet rather than over the one an author happened
  // to reach for.
  expect(fixturePageScan.backticked.map(formatCitation)).toEqual([
    "cfg/chain.ts:2 docs/carried.md",
    "tools/render.mjs:2 docs/carried.md",
    "tools/render.mjs:3 docs/mislaid.md",
  ]);
  expect(fixturePageScan.bare.map(formatCitation)).toEqual([
    "cfg/chain.ts:2 docs/forsaken.md",
    "tools/render.mjs:4 docs/carried.md",
    "tools/render.mjs:4 docs/strayed.md",
  ]);

  // Judged in both directions and against the working tree alone: the page
  // this fixture holds resolves, and the three it does not dangle — in a tree
  // and in a named file the program-backed scan reads neither of.
  expect(fixturePageScan.resolved.map((site) => site.text)).toEqual([
    "docs/carried.md",
    "docs/carried.md",
    "docs/carried.md",
  ]);
  expect(fixturePageScan.findings.map(formatCitation)).toEqual([
    "cfg/chain.ts:2 docs/forsaken.md",
    "tools/render.mjs:3 docs/mislaid.md",
    "tools/render.mjs:4 docs/strayed.md",
  ]);
});

it("the page-name scan judges neither an identifier nor a placeholder a comment in those trees carries", () => {
  // Vacuity guard: the module carrying both was read, and the page names
  // beside them in that same comment run are judged — so the refusal below is
  // this arm's scope and not a reader that never saw the file.
  expect(fixturePageScan.modules).toContain("tools/render.mjs");
  expect(fixturePageScan.scanned.map((site) => site.text)).toContain(
    "docs/mislaid.md",
  );

  // An identifier has no token set to answer it here — this arm reads no
  // program — and a placeholder names no one file, so admitting either would
  // show up as a standing finding rather than passing quietly.
  const judged = fixturePageScan.scanned.map((site) => site.text);
  expect(judged).not.toContain("vanishedInTools");
  expect(judged).not.toContain("<area>/notes.md");
  const findings = fixturePageScan.findings.map((site) => site.text);
  expect(findings).not.toContain("vanishedInTools");
  expect(findings).not.toContain("<area>/notes.md");
});

it("the page-name scan reports a page name a comment line broke rather than judging its tail", () => {
  // Vacuity guard: the wrap was read, and read as the author spelled it before
  // markdown put a space in it — so the verdict below is the wrap arm and not
  // a reader that missed the break.
  expect(
    fixturePageScan.wraps.scanned.map((site) => `${formatCitation(site)} | ${site.closed}`),
  ).toEqual(["tools/render.mjs:13 docs/ carried.md | docs/carried.md"]);

  // The break is a defect at the comment: the space it inserts is no character
  // a page name admits, so the citation falls out of the judged set whatever
  // it named. Reported, so it cannot do that quietly.
  expect(fixturePageScan.wraps.findings.map(formatCitation)).toEqual([
    "tools/render.mjs:13 docs/ carried.md",
  ]);

  // And the tail is not a citation of its own — judged, a root-level page of
  // that basename would answer a name the author never wrote.
  expect(fixturePageScan.scanned.map((site) => site.line)).not.toContain(14);
});

it("the page-name scan refuses a domain naming a tree or a file the repo no longer holds", () => {
  // Vacuity guard: the same walk over the real domain resolves modules, so the
  // refusals below are the domain check firing rather than a walk that reads
  // nothing whatever it is handed.
  expect(modulesUnder(fixtureRoot, { trees: ["tools"] }).length).toBeGreaterThan(
    0,
  );

  // Both halves refuse rather than shrink: a domain that collapsed quietly
  // would report every page name in it as none and leave the pin below green
  // over nothing.
  expect(() =>
    scanPageCitations({ root: fixtureRoot, domain: { trees: ["retired"] } }),
  ).toThrow(/no source module under retired/);
  expect(() =>
    scanPageCitations({
      root: fixtureRoot,
      domain: { trees: ["tools"], files: ["cfg/retired.ts"] },
    }),
  ).toThrow(/no source module at cfg\/retired\.ts/);
});

// --- the form a verdict over the live tree is read in ---------------------

it("the citation scan's findings render to one line naming every dangling site", () => {
  const lines = fixtureScan.findings.map(formatCitation);

  // Vacuity guard: this fixture dangles at more than one site, so the join
  // below is read over a list that a render returning its first entry alone
  // would have passed just the same.
  expect(lines.length).toBeGreaterThan(1);

  const rendered = renderFindings(lines);

  // One line, because one line is all a reverted tick's detail carries
  // (`TestFailure`, `harness/runner.ts`). A site pushed onto a second line
  // is a site the verdict dropped on the way out.
  expect(rendered.split("\n")).toEqual([rendered]);

  // And every site is on it, spelled the way the array form spelled it.
  expect(renderFindings(lines.filter((line) => !rendered.includes(line)))).toBe(
    NO_FINDINGS,
  );

  // Nothing to report renders to a sentence rather than to an empty string,
  // so the expected half of a verdict states what it meant.
  expect(renderFindings([])).toBe(NO_FINDINGS);
});

it("a findings rendering refuses a finding carrying a line break rather than eliding what follows it", () => {
  expect(() =>
    renderFindings(["lib/surface.ts:12 vanishedHelper", "lib/a.ts:1 one\ntwo"]),
  ).toThrow(/line break/);
});

// --- the pin -------------------------------------------------------------

/**
 * Vocabulary the trees cite by name and legitimately do not declare, because
 * something outside the scan's reach owns it and no rung of the ladder here
 * can hold it. The scan says so by name rather than widening its resolution
 * until the residue disappears.
 *
 * A path citation sits here on the same terms: the file is real but the
 * working tree is not what holds it — a build output, a running loop, a
 * consumer's state root, a prompt resolved against a chain's config dir.
 * Resolving those would mean teaching the scan a second root it cannot
 * check, which is how an exclusion becomes a hole.
 *
 * `tests/` reaches two more owners that sit inside this repo and still
 * outside the scan's reach. A declaration of `examples/` is real code the
 * carve-out's three trees do not include. A member of a fixture this suite
 * authors as source *text* is spelled in no declaration the program holds.
 * Both are cited on purpose and neither is a token the checker can answer.
 *
 * One list for both scans below, because an exclusion is a claim about the
 * name rather than about the reader that met it: a page an example chain
 * writes only into a consumer's repo is external whether a `tests/` comment
 * or the example itself is the one citing it. So each entry's non-vacuity is
 * read over the union of the two judged sets.
 *
 * The reason rides the entry rather than the list, because an exclusion is
 * the one place the verdict is overridden by hand: a name added without one
 * is indistinguishable from residue nobody wanted to look at.
 *
 * **It is data, not a module, and that is load-bearing.** A string literal
 * resolves a citation, and `tests/` is now a judged tree, so a list spelling
 * the names it excuses would resolve every one of them from inside the
 * program and leave this pin green over an empty override. A `.json` no
 * module imports is in no program, so the list cannot answer for itself.
 */
const EXTERNAL_VOCABULARY: ReadonlyMap<string, string> = new Map(
  Object.entries(
    JSON.parse(
      readFileSync(
        new URL("./helpers/external-vocabulary.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, string>,
  ),
);

it("every backticked identifier in a src/, harness/ or tests/ comment names a declaration those trees hold", () => {
  const scan = repoScan;

  // Vacuity guard: all three trees were read and the judged set is populated
  // before the emptiness assertion. A `trees` prefix that stopped matching
  // would otherwise report a clean tree over zero citations.
  expect(scan.modules.some((m) => m.startsWith("src/"))).toBe(true);
  expect(scan.modules.some((m) => m.startsWith("harness/"))).toBe(true);
  expect(scan.modules.some((m) => m.startsWith("tests/"))).toBe(true);
  expect(scan.scanned.length).toBeGreaterThan(2500);
  expect(scan.resolved.length).toBeGreaterThan(0);

  // And the home arm is drawing, in quantity: these comments name the file a
  // symbol sits in wherever they cite one across a module boundary. A pair
  // rule that stopped matching would leave every one of them answered by the
  // repo-wide token set, and the emptiness below would pass over a stranded
  // cite exactly as it did before the arm existed.
  expect(scan.pairs.length).toBeGreaterThan(50);

  // Each exclusion is non-vacuous in the other direction: a name the trees
  // stopped citing is a hole widened for nothing, and reds here rather than
  // sitting in the list unread.
  const judged = [
    ...scan.scanned.map((s) => s.text),
    ...repoPageScan.scanned.map((s) => s.text),
  ];
  const excluded = [...EXTERNAL_VOCABULARY.keys()];
  expect(excluded.length).toBeGreaterThan(0);
  for (const name of excluded) {
    expect(judged).toContain(name);
  }

  // And the list as a whole is overriding something. Every name here also
  // being *resolved* is the shape this list took the moment `tests/` joined
  // the judged trees and the list itself was a module: a string literal is a
  // resolution arm, so the list answered for its own keys and the override
  // below became decorative. Per entry the claim would be order-dependent —
  // a `dist/` citation dangles in a fresh checkout and resolves once
  // something has built — so it is made over the set.
  const unresolved = new Set(scan.findings.map((s) => s.text));
  expect(excluded.filter((name) => unresolved.has(name)).length)
    .toBeGreaterThan(0);

  expectNoFindings(
    scan.findings.filter((s) => !excluded.includes(s.text)).map(formatCitation),
  );
});

it("the repo citation pin judges the repo-relative path citations src/, harness/ and tests/ comments carry", () => {
  const paths = repoScan.scanned.filter((site) => site.text.includes("/"));

  // Vacuity guard: the judged set holds path citations in quantity before
  // the verdict is read. A subject rule that stopped admitting them would
  // leave the pin above green over the identifier half alone.
  expect(paths.length).toBeGreaterThan(1000);
  expect(new Set(paths.map((s) => s.text)).size).toBeGreaterThan(80);

  // They are judged in the direction that matters: a rule page, a spec topic
  // and a module of the judged trees each resolve against the working tree,
  // so renaming any of them reds this suite rather than leaving every comment
  // that cites it standing.
  const resolved = new Set(repoScan.resolved.map((s) => s.text));
  for (const path of [
    ".claude/rules/engineering.md",
    "spec/harness.md",
    "src/Dispatcher.ts",
  ]) {
    expect(`${path} -> ${resolved.has(path)}`).toBe(`${path} -> true`);
  }
});

it("the repo citation pin judges the unbackticked page names src/, harness/ and tests/ comments carry", () => {
  // The judged set holds the very sites `bare` does, so membership is
  // identity — no re-deriving the subject rule here to decide it.
  const judged = new Set(repoScan.scanned);
  const unjudged = repoScan.bare.filter((site) => !judged.has(site));

  // Vacuity guard: these comments cite pages without a fence in quantity, and
  // the subject rule admits every one of them. A page name left unspelled —
  // a basename the working tree cannot answer without the directory ahead of
  // it — would sit in the dangling set the pin above asserts empty.
  expect(repoScan.bare.length).toBeGreaterThan(350);
  expectNoFindings(unjudged.map(formatCitation));

  // Both families the trees name this way resolve, so renaming either page
  // reds this suite rather than leaving every comment citing it standing.
  const resolved = new Set(repoScan.resolved.map((s) => s.text));
  for (const page of [".claude/rules/engineering.md", "spec/loop.md"]) {
    expect(`${page} -> ${resolved.has(page)}`).toBe(`${page} -> true`);
  }
});

it("the repo citation pin refuses any citation broken across a comment line", () => {
  // Vacuity guard: these trees wrap backticked spans in quantity — commands,
  // literal payloads, a fenced example — so the emptiness below is the
  // subject rule reading those wraps and passing over them as prose, not a
  // reader that found no wrap to read at all.
  expect(repoScan.wraps.scanned.length).toBeGreaterThan(40);

  // A citation the wrap broke is judged by nothing, so it is a defect at the
  // comment rather than a resolution arm the scan is missing: the space
  // markdown inserts is not a character any subject spelling admits, and the
  // pins above stay green over it however the name it cites is renamed.
  // Rewrap the span.
  expectNoFindings(repoScan.wraps.findings.map(formatCitation));
});

it("every `{@link}` reference in a `src/`, `harness/` or `tests/` comment resolves from its citing module", () => {
  const scan = repoScan;

  // Vacuity guard: these trees carry link tags in quantity and all three of
  // them carry one, before the emptiness below is read. A tag reader that
  // stopped matching would report a clean tree over zero references.
  expect(scan.links.scanned.length).toBeGreaterThan(400);
  for (const tree of ["src/", "harness/", "tests/"]) {
    const carried = scan.links.scanned.some((site) =>
      site.module.startsWith(tree),
    );
    expect(`${tree} -> ${carried}`).toBe(`${tree} -> true`);
  }

  // And the arm is judging at the altitude it claims: a tag whose target the
  // citing module cannot reach is unanswered here however many of these
  // trees declare the name, so a reference no reader can follow cannot ride
  // a sibling's declaration. Re-home the cite — name the file the
  // declaration sits in, the way every other cross-module citation does.
  expectNoFindings(scan.links.findings.map(formatCitation));
});

it("every section a src/, harness/ or tests/ comment cites is a section its page still carries", () => {
  // Vacuity guard: these comments cite sections in quantity before the
  // emptiness below is read off them. A reader that stopped drawing the
  // shape would report a clean tree over zero cites.
  expect(repoScan.sections.scanned.length).toBeGreaterThan(600);

  // Judged at both altitudes a page states a title at — a heading and a
  // bolded bullet lead — so a heading rewritten or a lead respelled reds
  // here rather than leaving every comment citing it standing.
  const dangling = new Set(repoScan.sections.findings);
  const resolved = new Set(
    repoScan.sections.scanned
      .filter((site) => !dangling.has(site))
      .map((site) => `${site.page} :: ${site.text}`),
  );
  for (const cite of [
    ".claude/rules/engineering.md :: Loud or nothing",
    "spec/loop.md :: No false signal",
  ]) {
    expect(`${cite} -> ${resolved.has(cite)}`).toBe(`${cite} -> true`);
  }

  // The verdict. Spell the section as its page titles it: the match is exact
  // once backticks and the renderer's wrapping are folded out, and there is
  // no prefix arm for an abbreviation to land on.
  expectNoFindings(
    repoScan.sections.findings.map(
      (site) => `${formatCitation(site)} -> ${site.page}`,
    ),
  );
});

it("every *.md page name a src/, harness/ or tests/ title carries names a file the working tree holds", () => {
  // Vacuity guard: the titles were read in quantity and the page names among
  // them are judged in quantity, before the emptiness below is read off
  // either. A collector that stopped matching this suite's runner vocabulary
  // would otherwise report a clean tree over zero titles, and a subject rule
  // that stopped admitting page names over zero citations.
  expect(repoScan.titled.length).toBeGreaterThan(1500);
  expect(repoScan.titles.scanned.length).toBeGreaterThan(80);

  // Judged in the direction that matters: each family these titles cite
  // resolves against the working tree, so renaming any of those pages reds the
  // title citing it as it already reds the comment beside it.
  const cited = new Set(repoScan.titles.scanned.map((s) => s.text));
  for (const page of [
    ".claude/rules/engineering.md",
    "spec/loop.md",
    "docs/CLI.md",
  ]) {
    expect(`${page} -> ${cited.has(page)}`).toBe(`${page} -> true`);
  }

  // A title is a literal, so a page name written in one is answered by the
  // working tree or by nothing at all: a page the repo moved leaves the title
  // citing it here rather than standing. Spell the page's directory.
  expectNoFindings(repoScan.titles.findings.map(formatCitation));
});

it("every .md page name a comment in bin/, examples/, scripts/ or .flume/chain.ts cites names a page the working tree holds", () => {
  // Vacuity guard, in the alphabet the domain is written in: every tree and
  // the named file resolved to modules the scan read. A `trees` entry that
  // stopped matching would report a clean verdict over a tree it never opened
  // — and the walk refuses an empty tree, so this is the positive half.
  for (const tree of ["bin/", "examples/", "scripts/"]) {
    expect(`${tree} -> ${repoPageScan.modules.some((m) => m.startsWith(tree))}`)
      .toBe(`${tree} -> true`);
  }
  expect(repoPageScan.modules).toContain(".flume/chain.ts");

  // And nothing the sweep domain names is judged by neither scan. The two
  // domains are exclusive, so this union is what keeps a tree from falling
  // between them as either list is edited.
  const read = [...repoScan.modules, ...repoPageScan.modules];
  for (const tree of SWEEP_DOMAIN) {
    expect(`${tree} -> ${read.some((m) => m.startsWith(tree))}`).toBe(
      `${tree} -> true`,
    );
  }

  // The judged set is populated in both fencings before any verdict is read
  // off it: these comments cite pages backticked and bare, and a subject rule
  // that stopped admitting either would leave the emptiness below green over
  // half the citations.
  expect(repoPageScan.scanned.length).toBeGreaterThan(40);
  expect(repoPageScan.backticked.length).toBeGreaterThan(20);
  expect(repoPageScan.bare.length).toBeGreaterThan(10);
  expect(repoPageScan.resolved.length).toBeGreaterThan(0);

  // Judged in the direction that matters: each family these comments cite
  // resolves against the working tree, so renaming any of those pages reds
  // here as it already reds a `src/` comment citing the same page.
  const resolved = new Set(repoPageScan.resolved.map((s) => s.text));
  for (const page of [
    "CHANGELOG.md",
    "spec/cli.md",
    "docs/CHAIN-AUTHORING.md",
    ".claude/rules/engineering.md",
  ]) {
    expect(`${page} -> ${resolved.has(page)}`).toBe(`${page} -> true`);
  }

  // These trees break no comment span at all today, so the wrap verdict is
  // read over zero — spelled here rather than inherited, with the arm shown
  // discriminating over the fixture above
  // (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
  expectNoFindings(repoPageScan.wraps.scanned.map(formatCitation));
  expectNoFindings(repoPageScan.wraps.findings.map(formatCitation));

  // The verdict. What remains is the vocabulary an example chain writes only
  // into a consumer's repo, excused by name and by reason in the list above.
  const excluded = [...EXTERNAL_VOCABULARY.keys()];
  expectNoFindings(
    repoPageScan.findings
      .filter((site) => !excluded.includes(site.text))
      .map(formatCitation),
  );

  // And that override is live rather than decorative: page names in these
  // trees do reach it, so a name dropped from the list reds here instead of
  // passing unnoticed.
  expect(
    repoPageScan.findings.filter((site) => excluded.includes(site.text)).length,
  ).toBeGreaterThan(0);
});

it("every section a comment in bin/, examples/, scripts/ or .flume/chain.ts cites is a section its page still carries", () => {
  // Vacuity guard: these comments cite sections in quantity before the
  // emptiness below is read off them, and the arm reaching here at all is
  // the point — a page's own titles answer a cite with no program to
  // consult, exactly as the page name beside it is answered.
  expect(repoPageScan.sections.scanned.length).toBeGreaterThan(15);

  const dangling = new Set(repoPageScan.sections.findings);
  const resolved = new Set(
    repoPageScan.sections.scanned
      .filter((site) => !dangling.has(site))
      .map((site) => `${site.page} :: ${site.text}`),
  );
  const cite = "spec/harness.md :: What this repo is";
  expect(`${cite} -> ${resolved.has(cite)}`).toBe(`${cite} -> true`);

  // The verdict, on the terms the program-backed scan is held to.
  expectNoFindings(
    repoPageScan.sections.findings.map(
      (site) => `${formatCitation(site)} -> ${site.page}`,
    ),
  );
});
