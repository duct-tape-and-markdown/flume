/**
 * `.claude/rules/engineering.md` *Narration is the ladder's bottom rung* is
 * the ladder's bottom rung for its own property, and this file is the rung
 * above it for the citations that sit inside quotes: a string literal naming
 * one of the engine's functions is a reference no other arm resolves, and a
 * rename leaves the name standing inside the message reading as current.
 *
 * The rule the scan reads is `literalSymbols.ts`; what it is resolved against
 * is the surface the package hands out, the same set the interface pages are
 * judged against — a name a message's reader can go and find, rather than a
 * module-private helper in a repository they do not have.
 *
 * The repo pin asserts an absence, so it comes after its detector shown
 * working: a tree whose literals name functions by construction, each arm of
 * the subject rule and each spelling it refuses. Without those, "no literal
 * names an unreachable function" is a claim no failing run has ever backed,
 * and it stays green however narrow the subject rule drifts.
 *
 * The scanner is the same one in both, reading a real tsconfig and a real
 * parse, so the fixture cannot drift into testing a second implementation of
 * the verdict. Only the resolver differs: the fixture hands it a surface of
 * one name, because what the fixture is proving is the arm, not the package.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import { packageSurface } from "./helpers/exportGraph.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import {
  formatLiteralSymbol,
  scanLiteralSymbols,
  type LiteralSymbolScan,
} from "./helpers/literalSymbols.ts";
import { expectNoFindings } from "./helpers/repoProgram.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// --- the detector, over a tree whose literals are known by construction ---

/**
 * A two-module tree carrying one literal per arm of the subject rule: a
 * function the surface holds, one it does not, a function spelled as an
 * arrow's value, and one nested inside another function's body — every depth
 * and every spelling a declaration takes, because a message naming any of
 * them has named a function.
 *
 * Beside them the spellings the scan must leave alone. A camel span naming no
 * declaration is a field name, a flag, a JSON key — prose this scan has no
 * business reading. A module specifier is a path the compiler resolves, and
 * the fixture imports the one module whose basename is a function of the
 * tree, so the exclusion is visible as an exclusion rather than as a name the
 * fixture never wrote.
 *
 * And the two shapes a text search gets wrong in opposite directions: a
 * function named in a real comment, which is the comment scan's alphabet and
 * not this one, and a literal that *looks* like a comment, which is a literal
 * whatever it holds.
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
  "lib/outerVerb.ts": [
    `/** The module whose basename is a function of this tree. */`,
    `export const marker = 1;`,
    ``,
  ].join("\n"),
  "lib/engine.ts": [
    `import { marker } from "./outerVerb.js";`,
    ``,
    `/** The functions this tree's literals name, at each depth and value. */`,
    `export function shippedVerb(): number {`,
    `  return marker;`,
    `}`,
    ``,
    `export function internalVerb(): number {`,
    `  return marker;`,
    `}`,
    ``,
    `export const arrowVerb = (): number => marker;`,
    ``,
    `export function outerVerb(): number {`,
    `  function nestedVerb(): number {`,
    `    return marker;`,
    `  }`,
    `  return nestedVerb();`,
    `}`,
    ``,
    `// A comment naming \`internalVerb\` is the comment scan's alphabet and`,
    `// not this one: a literal is what the parser produced, and trivia is not.`,
    `export const SURFACE = "shippedVerb is handed out, so a message may name it";`,
    ``,
    `export const RESIDUE = "internalVerb is not, so naming it here is residue";`,
    ``,
    `export const ARROW = \`arrowVerb is a function however its value is spelled\`;`,
    ``,
    `export const NESTED = "nestedVerb is one too, at whatever depth it sits";`,
    ``,
    `export const WORDS = "maxDepth and dryRun name no function of this tree";`,
    ``,
    `export const TAIL = \`the head names none \${marker}, and arrowVerb sits behind it\`;`,
    ``,
    `export const QUOTED = "// internalVerb in quotes is a literal, not a comment";`,
    ``,
  ].join("\n"),
};

let fixtureRoot: string;
/** The one scan of that fixture's tree, resolved against a surface of one. */
let fixtureScan: LiteralSymbolScan;

beforeAll(async () => {
  fixtureRoot = await mkTempDir("flume-literal-symbol-scan-");
  for (const [rel, body] of Object.entries(FIXTURE_FILES)) {
    const path = join(fixtureRoot, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  fixtureScan = scanLiteralSymbols({
    root: fixtureRoot,
    programConfig: "tsconfig.json",
    trees: ["lib/"],
    surface: new Set(["shippedVerb"]),
  });
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

it("the literal scan flags a string naming a function the surface does not hold", () => {
  const scan = fixtureScan;

  // Vacuity guard: both modules were read, and the subject rule is armed for
  // every declaration spelling the fixture carries — a rule that missed the
  // arrow or the nested body would report a clean verdict for the wrong
  // reason.
  expect([...scan.modules].sort()).toEqual([
    "lib/engine.ts",
    "lib/outerVerb.ts",
  ]);
  expect([...scan.functions].sort()).toEqual([
    "arrowVerb",
    "internalVerb",
    "nestedVerb",
    "outerVerb",
    "shippedVerb",
  ]);

  // The subject rule narrows rather than admitting everything: the spans the
  // literals carry are read, and the ones naming no function of the tree are
  // dropped rather than never collected.
  expect(scan.spans.map((site) => site.text)).toContain("maxDepth");
  expect(scan.spans.map((site) => site.text)).toContain("dryRun");
  expect(scan.scanned.map((site) => site.text)).not.toContain("maxDepth");

  // A module specifier is not narration: `outerVerb` is a function of this
  // tree and the import names it, and no span is drawn from the specifier at
  // all — so the exclusion is visible rather than inferred from an absence
  // the fixture could have caused by never writing the name.
  expect(scan.functions.has("outerVerb")).toBe(true);
  expect(scan.spans.map((site) => site.text)).not.toContain("outerVerb");

  // The surface arm, both ways, at the line a reader has to edit. The comment
  // at lines 21-22 names a function and is not here; the literal at line 35
  // holds a comment's own marker and is.
  expect(scan.resolved.map(formatLiteralSymbol)).toEqual([
    "lib/engine.ts:23 shippedVerb",
  ]);
  expect(scan.findings.map(formatLiteralSymbol)).toEqual([
    "lib/engine.ts:25 internalVerb",
    "lib/engine.ts:27 arrowVerb",
    "lib/engine.ts:29 nestedVerb",
    "lib/engine.ts:33 arrowVerb",
    "lib/engine.ts:35 internalVerb",
  ]);
});

// --- the repo pin ---------------------------------------------------------

it("no src/ string literal names a function the package's surface does not hold", () => {
  const surface = packageSurface({
    root: REPO_ROOT,
    buildConfig: "tsconfig.build.json",
    programConfig: "tsconfig.json",
  });

  // Non-vacuity on the resolving side: the surface is what the `exports` map
  // reaches. Built from its entry list alone it would hold two module symbols
  // and red every message naming a member, and an emit that resolved nothing
  // would hold none at all.
  expect(surface.entryModules).toEqual(["src/index.ts", "harness/index.ts"]);
  expect(surface.names.size).toBeGreaterThan(500);

  const scan = scanLiteralSymbols({
    root: REPO_ROOT,
    programConfig: "tsconfig.json",
    trees: ["src/"],
    surface: surface.names,
  });

  // Non-vacuity on the judged side: the literals were read, the subject rule
  // admitted some of what they carry and dropped the rest, and the surface
  // answered some of what it admitted — each read before the emptiness
  // assertion below.
  expect(scan.functions.size).toBeGreaterThan(0);
  expect(scan.scanned.length).toBeGreaterThan(0);
  expect(scan.spans.length).toBeGreaterThan(scan.scanned.length);
  expect(scan.resolved.length).toBeGreaterThan(0);

  expectNoFindings(scan.findings.map(formatLiteralSymbol));
});
