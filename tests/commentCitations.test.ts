/**
 * `.claude/rules/engineering.md` *Narration is the ladder's bottom rung* is
 * the ladder's bottom rung for its own property, and this file is the rung
 * above it for the carve-out that page names: a backticked identifier in a
 * `src/` or `harness/` comment is a reference, not a sentence, so a deleted
 * symbol may not leave its citations standing.
 *
 * Two cases, because a pin asserting an absence needs its detector shown
 * working. The first drives the scanner over a tree whose dangling citations
 * are known by construction — otherwise "no dangling citations" is a claim no
 * failing run has ever backed. The second is the pin itself.
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
  ].join("\n"),
};

let fixtureRoot = "";

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "flume-citation-scan-"));
  for (const [rel, body] of Object.entries(FIXTURE_FILES)) {
    const path = join(fixtureRoot, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

it("the citation scan flags a backticked identifier no src/ or harness/ declaration holds", () => {
  const scan = scanCommentCitations({
    root: fixtureRoot,
    programConfig: "tsconfig.json",
    trees: ["lib/"],
  });

  // Vacuity guard: both modules were read and the judged set is the one the
  // fixture authored, before any verdict is read off it. A scan that reached
  // one module, or judged nothing, would report its finding for the wrong
  // reason.
  expect([...scan.modules].sort()).toEqual([
    "lib/dataShapes.ts",
    "lib/surface.ts",
  ]);
  expect(scan.scanned.map((s) => s.text).sort()).toEqual([
    "Shipped.maxDepth",
    "WeakMap",
    "blockedBy",
    "dataShapes.ts",
    "this.opts.maxDepth",
    "vanishedHelper",
    "vanishedPastDivision",
  ]);

  expect(scan.dangling.map(formatCitation)).toEqual([
    "lib/surface.ts:12 vanishedHelper",
    "lib/surface.ts:25 vanishedPastDivision",
  ]);

  // Every resolution arm fired, so the two findings above are a
  // discrimination rather than a scan that flagged what it could not classify.
  expect(scan.resolved.map((s) => s.text).sort()).toEqual([
    "Shipped.maxDepth",
    "WeakMap",
    "blockedBy",
    "dataShapes.ts",
    "this.opts.maxDepth",
  ]);

  // A backtick inside a string literal is no citation: the reader takes
  // comments off the parse, so this name is not even a span it saw.
  const spans = scan.backticked.map((s) => s.text);
  expect(spans).not.toContain("vanishedInString");

  // The subject filter discriminates rather than the scan missing them: both
  // were read as spans and neither was judged.
  expect(spans).toContain("handoff");
  expect(spans).toContain("--dry-run");
});

// --- the pin -------------------------------------------------------------

/**
 * Vocabulary the trees cite by name and legitimately do not declare. Each
 * entry is an external artifact's field, so no rung of the ladder in this
 * repo can hold it; the scan says so here rather than widening its
 * resolution until the residue disappears.
 *
 * `exactOptionalPropertyTypes` is a tsconfig compiler option.
 */
const EXTERNAL_VOCABULARY: ReadonlySet<string> = new Set([
  "exactOptionalPropertyTypes",
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

  // The exclusion is non-vacuous in the other direction: a name the trees
  // stopped citing is an exclusion widening the hole for nothing, and reds
  // here rather than sitting in the list unread.
  const judged = scan.scanned.map((s) => s.text);
  for (const external of EXTERNAL_VOCABULARY) {
    expect(judged).toContain(external);
  }

  expect(
    scan.dangling
      .filter((s) => !EXTERNAL_VOCABULARY.has(s.text))
      .map(formatCitation),
  ).toEqual([]);
});
