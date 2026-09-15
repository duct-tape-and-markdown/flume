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

import { existsSync } from "node:fs";
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
 * lib global the tree never uses — beside two that resolve to nothing.
 *
 * It carries each spelling the subject rule admits, and each it refuses,
 * against both verdicts: a camel hump, a dot, a leading capital, a single
 * lowercase word, a word in capitals alone.
 *
 * It also carries the two shapes a text search gets wrong in opposite
 * directions: a backticked name inside a string literal that *looks* like a
 * comment (scanned, it would be a phantom finding), and a real comment
 * sitting past a division pair that a raw token scan reads as a regular
 * expression (unscanned, its finding would be lost).
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
  ].join("\n"),
};

let fixtureRoot = "";
/** The one scan of that tree — every case below reads the same verdict. */
let fixtureScan: CitationScan;

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
    "Shipped.maxDepth",
    "Vanished",
    "WeakMap",
    "blockedBy",
    "dataShapes.ts",
    "surface.ts",
    "this.opts.maxDepth",
    "vanished.helper",
    "vanishedHelper",
    "vanishedPastDivision",
  ]);

  expect(scan.dangling.map(formatCitation)).toEqual([
    "lib/surface.ts:12 vanishedHelper",
    "lib/surface.ts:25 vanishedPastDivision",
    "lib/surface.ts:31 Vanished",
    "lib/surface.ts:31 vanished.helper",
  ]);

  // Every resolution arm fired, so the two findings above are a
  // discrimination rather than a scan that flagged what it could not classify.
  expect(scan.resolved.map((s) => s.text).sort()).toEqual([
    "Holder",
    "Shipped.maxDepth",
    "WeakMap",
    "blockedBy",
    "dataShapes.ts",
    "surface.ts",
    "this.opts.maxDepth",
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

// --- the pin -------------------------------------------------------------

/**
 * Vocabulary the trees cite by name and legitimately do not declare, because
 * an artifact outside this repo owns it and no rung of the ladder here can
 * hold it. The scan says so by name rather than widening its resolution until
 * the residue disappears.
 *
 * The reason rides the entry rather than the list, because an exclusion is
 * the one place the verdict is overridden by hand: a name added without one
 * is indistinguishable from residue nobody wanted to look at.
 */
const EXTERNAL_VOCABULARY: ReadonlyMap<string, string> = new Map([
  ["cmd.exe", "the Windows command interpreter, named as a spawn target"],
  ["exactOptionalPropertyTypes", "a tsconfig compiler option"],
  ["fs.rm", "`node:fs/promises`, under a namespace this tree never imports"],
  ["scripts.lint", "a field of the consumer's `package.json`, not of ours"],
  ["sysexits.h", "the BSD header flume's exit codes are taken from"],
]);

/**
 * Citations naming a file of *this* repo that sits outside the judged trees.
 * The scan resolves a module by basename, but only across the trees it reads,
 * so these resolve nowhere — and `EXTERNAL_VOCABULARY`'s reason is untrue of
 * them: the file is right here, one rung away.
 *
 * So they are excluded against a path instead of a reason, and the pin checks
 * the path exists. A renamed rules page or build config reds here exactly as
 * a deleted declaration does, which is the whole property the scan is for.
 */
const REPO_FILE_VOCABULARY: ReadonlyMap<string, string> = new Map([
  ["engineering.md", ".claude/rules/engineering.md"],
  ["tsconfig.build.json", "tsconfig.build.json"],
]);

it("every backticked identifier in a src/ or harness/ comment names a declaration those trees hold", () => {
  const scan = scanCommentCitations({
    root: REPO_ROOT,
    programConfig: "tsconfig.json",
    trees: ["src/", "harness/"],
  });

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
  const excluded = [
    ...EXTERNAL_VOCABULARY.keys(),
    ...REPO_FILE_VOCABULARY.keys(),
  ];
  for (const name of excluded) {
    expect(judged).toContain(name);
  }

  // And the repo-file arm carries its own check: the path each stands for is
  // on disk, so the exclusion cannot outlive the file it points at.
  for (const [name, path] of REPO_FILE_VOCABULARY) {
    expect(`${name} -> ${existsSync(join(REPO_ROOT, path))}`).toBe(
      `${name} -> true`,
    );
  }

  expect(
    scan.dangling
      .filter((s) => !excluded.includes(s.text))
      .map(formatCitation),
  ).toEqual([]);
});
