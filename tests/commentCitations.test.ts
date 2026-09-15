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
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  type CitationScan,
  formatCitation,
  scanCommentCitations,
} from "./helpers/commentCitations.ts";

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
  "guide.md": "# the root-level page a broken cite's tail answers instead\n",
  "release-notes.md": "# the root-level page a fenced cite names by hyphen\n",
  "lib/dataShapes.ts": [
    `/** Cites \`WeakMap\`, a lib global no statement in this tree uses. */`,
    `export interface Shipped {`,
    `  readonly maxDepth: number;`,
    `}`,
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
  ].join("\n"),
};

let fixtureRoot = "";
/** The one scan of that tree — every case below reads the same verdict. */
let fixtureScan: CitationScan;
/** The one scan of this repo — both pins below read the same verdict. */
let repoScan: CitationScan;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "flume-citation-scan-"));
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
  expect(scan.scanned.map((s) => s.text).sort()).toEqual([
    "Holder",
    "Shipped",
    "Shipped.maxDepth",
    "Vanished",
    "WeakMap",
    "blockedBy",
    "dataShapes.ts",
    "docs/guide.md",
    "docs/vanished.md",
    "lib/dataShapes.ts",
    "lib/vanished.ts",
    "release-notes.md",
    "surface.ts",
    "this.opts.maxDepth",
    "tsconfig.json",
    "vanished-notes.md",
    "vanished.helper",
    "vanishedHelper",
    "vanishedPastDivision",
  ]);

  expect(scan.dangling.map(formatCitation)).toEqual([
    "lib/surface.ts:12 vanishedHelper",
    "lib/surface.ts:25 vanishedPastDivision",
    "lib/surface.ts:31 Vanished",
    "lib/surface.ts:31 vanished.helper",
    "lib/surface.ts:36 lib/vanished.ts",
    "lib/surface.ts:57 docs/vanished.md",
    "lib/surface.ts:68 vanished-notes.md",
  ]);

  // Every resolution arm fired, so the two findings above are a
  // discrimination rather than a scan that flagged what it could not classify.
  expect(scan.resolved.map((s) => s.text).sort()).toEqual([
    "Holder",
    "Shipped",
    "Shipped.maxDepth",
    "WeakMap",
    "blockedBy",
    "dataShapes.ts",
    "docs/guide.md",
    "lib/dataShapes.ts",
    "release-notes.md",
    "surface.ts",
    "this.opts.maxDepth",
    "tsconfig.json",
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
  expect(fixtureScan.dangling.map(formatCitation)).toContain(
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
  ]);

  expect(fixtureScan.resolved.map((s) => s.text)).toContain("Holder");
  expect(fixtureScan.dangling.map(formatCitation)).toContain(
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

  expect(fixtureScan.dangling.map(formatCitation)).toContain(
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
  expect(fixtureScan.dangling.map(formatCitation)).toContain(
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
  expect(fixtureScan.wrapped.map(formatCitation)).toEqual([
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
  expect(fixtureScan.wrapped.map((s) => s.closed)).toEqual([
    "lib/dataShapes.ts",
    "Shipped.maxDepth",
    "nota citation",
    "docs/guide.md",
  ]);

  // The three that close to a name are reported as broken citations, and the
  // one that closes to prose is not: the wrap is read by the subject rule the
  // judged set is held to, in either alphabet, rather than by the slash.
  expect(fixtureScan.broken.map(formatCitation)).toEqual([
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
  ]);

  // Judged, and judged in both directions by the arm the fenced paths go
  // through: the page this tree holds resolves against the working tree and
  // the one it does not dangles.
  expect(fixtureScan.resolved.map(formatCitation)).toContain(
    "lib/surface.ts:56 docs/guide.md",
  );
  expect(fixtureScan.dangling.map(formatCitation)).toContain(
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
  expect(fixtureScan.wrapped.map(formatCitation)).toContain(
    "lib/surface.ts:62 docs/ guide.md",
  );
  expect(fixtureScan.wrapped.find((s) => s.line === 62)?.closed).toBe(
    "docs/guide.md",
  );
  expect(fixtureScan.broken.map(formatCitation)).toContain(
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

  // Each exclusion is non-vacuous in the other direction: a name the trees
  // stopped citing is a hole widened for nothing, and reds here rather than
  // sitting in the list unread.
  const judged = scan.scanned.map((s) => s.text);
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
  const unresolved = new Set(scan.dangling.map((s) => s.text));
  expect(excluded.filter((name) => unresolved.has(name)).length)
    .toBeGreaterThan(0);

  expect(
    scan.dangling
      .filter((s) => !excluded.includes(s.text))
      .map(formatCitation),
  ).toEqual([]);
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
  expect(unjudged.map(formatCitation)).toEqual([]);

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
  expect(repoScan.wrapped.length).toBeGreaterThan(40);

  // A citation the wrap broke is judged by nothing, so it is a defect at the
  // comment rather than a resolution arm the scan is missing: the space
  // markdown inserts is not a character any subject spelling admits, and the
  // pins above stay green over it however the name it cites is renamed.
  // Rewrap the span.
  expect(repoScan.broken.map(formatCitation)).toEqual([]);
});
