/**
 * `.claude/rules/engineering.md` *Narration is the ladder's bottom rung* is
 * the ladder's bottom rung for its own property, and this file is the rung
 * above it for the carve-out that page names: a backticked identifier in a
 * `src/` or `harness/` comment is a reference, not a sentence, so a deleted
 * symbol may not leave its citations standing.
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
    trees: ["src/", "harness/"],
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
    "lib/dataShapes.ts",
    "lib/vanished.ts",
    "surface.ts",
    "this.opts.maxDepth",
    "tsconfig.json",
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
    "lib/dataShapes.ts",
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

// --- the wrap, which no subject spelling can survive ---------------------

it("the citation scan reports a backticked span its comment line leaves open", () => {
  // Vacuity guard: every other comment in the fixture closes its spans on the
  // line that opened them, so the three reports below are the wraps the
  // fixture authored rather than a parity artifact of some earlier comment.
  expect(fixtureScan.wrapped.map(formatCitation)).toEqual([
    "lib/surface.ts:42 lib/ dataShapes.ts",
    "lib/surface.ts:49 Shipped. maxDepth",
    "lib/surface.ts:51 not a citation",
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
  // Vacuity guard: all three wraps were read and closed, in both alphabets
  // and in prose, before any subset of them is judged. Closing the break
  // removes the break alone — the prose span keeps the space it spelled
  // itself, which is why it closes to no subject.
  expect(fixtureScan.wrapped.map((s) => s.closed)).toEqual([
    "lib/dataShapes.ts",
    "Shipped.maxDepth",
    "nota citation",
  ]);

  // The two that close to a name are reported as broken citations, and the
  // one that closes to prose is not: the wrap is read by the subject rule the
  // judged set is held to, in either alphabet, rather than by the slash.
  expect(fixtureScan.broken.map(formatCitation)).toEqual([
    "lib/surface.ts:42 lib/ dataShapes.ts",
    "lib/surface.ts:49 Shipped. maxDepth",
  ]);

  // Reported because nothing else can reach the identifier wrap either: the
  // member it names resolves when spelled on one line, and carries markdown's
  // space when the author wraps it, so no resolution arm answers it.
  expect(fixtureScan.resolved.map((s) => s.text)).toContain("Shipped.maxDepth");
  expect(fixtureScan.scanned.map((s) => s.text)).not.toContain(
    "Shipped. maxDepth",
  );
});

// --- the pin -------------------------------------------------------------

/**
 * Vocabulary the trees cite by name and legitimately do not declare, because
 * an artifact outside this repo owns it and no rung of the ladder here can
 * hold it. The scan says so by name rather than widening its resolution until
 * the residue disappears.
 *
 * A path citation sits here on the same terms: the file is real but the
 * working tree is not what holds it — a build output, a running loop, a
 * consumer's state root. Resolving those would mean teaching the scan a
 * second root it cannot check, which is how an exclusion becomes a hole.
 *
 * The reason rides the entry rather than the list, because an exclusion is
 * the one place the verdict is overridden by hand: a name added without one
 * is indistinguishable from residue nobody wanted to look at.
 */
const EXTERNAL_VOCABULARY: ReadonlyMap<string, string> = new Map([
  [".flume/loop.pid", "a live loop's pidfile, written by a run and not by us"],
  ["cmd.exe", "the Windows command interpreter, named as a spawn target"],
  ["dist/harness/init.js", "the published build's layout, not a checkout's"],
  ["dist/harness/prompts.js", "the published build's layout, not a checkout's"],
  ["dist/src/cli.js", "the published build's layout, not a checkout's"],
  ["exactOptionalPropertyTypes", "a tsconfig compiler option"],
  ["fs.rm", "`node:fs/promises`, under a namespace this tree never imports"],
  ["plan/pending.json", "the state root's layout — `<flumeDir>`-relative"],
  ["scripts.lint", "a field of the consumer's `package.json`, not of ours"],
  ["sysexits.h", "the BSD header flume's exit codes are taken from"],
]);

it("every backticked identifier in a src/ or harness/ comment names a declaration those trees hold", () => {
  const scan = repoScan;

  // Vacuity guard: both trees were read and the judged set is populated
  // before the emptiness assertion. A `trees` prefix that stopped matching
  // would otherwise report a clean tree over zero citations.
  expect(scan.modules.some((m) => m.startsWith("src/"))).toBe(true);
  expect(scan.modules.some((m) => m.startsWith("harness/"))).toBe(true);
  expect(scan.scanned.length).toBeGreaterThan(500);
  expect(scan.resolved.length).toBeGreaterThan(0);

  // Each exclusion is non-vacuous in the other direction: a name the trees
  // stopped citing is a hole widened for nothing, and reds here rather than
  // sitting in the list unread.
  const judged = scan.scanned.map((s) => s.text);
  const excluded = [...EXTERNAL_VOCABULARY.keys()];
  for (const name of excluded) {
    expect(judged).toContain(name);
  }

  expect(
    scan.dangling
      .filter((s) => !excluded.includes(s.text))
      .map(formatCitation),
  ).toEqual([]);
});

it("the repo citation pin judges the repo-relative path citations src/ and harness/ comments carry", () => {
  const paths = repoScan.scanned.filter((site) => site.text.includes("/"));

  // Vacuity guard: the judged set holds path citations in quantity before
  // the verdict is read. A subject rule that stopped admitting them would
  // leave the pin above green over the identifier half alone.
  expect(paths.length).toBeGreaterThan(400);
  expect(new Set(paths.map((s) => s.text)).size).toBeGreaterThan(40);

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

it("the repo citation pin refuses any citation broken across a comment line", () => {
  // Vacuity guard: these trees wrap backticked spans in quantity — commands,
  // literal payloads, a fenced example — so the emptiness below is the
  // subject rule reading those wraps and passing over them as prose, not a
  // reader that found no wrap to read at all.
  expect(repoScan.wrapped.length).toBeGreaterThan(20);

  // A citation the wrap broke is judged by nothing, so it is a defect at the
  // comment rather than a resolution arm the scan is missing: the space
  // markdown inserts is not a character any subject spelling admits, and the
  // pins above stay green over it however the name it cites is renamed.
  // Rewrap the span.
  expect(repoScan.broken.map(formatCitation)).toEqual([]);
});
