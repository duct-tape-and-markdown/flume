/**
 * `.claude/rules/engineering.md` *An export earns its consumer* is the ladder's
 * bottom rung for its property, and this file is the rung above it: the pin
 * that makes the absence verdict mechanical over `src/` and `harness/`.
 *
 * Two cases, because a pin asserting an absence needs its detector shown
 * working. The first drives the scanner over a package whose residue is known
 * by construction — otherwise "no unearned exports" is a claim no failing run
 * has ever backed. The second is the pin itself.
 *
 * The scanner is the same one in both, reading real tsconfigs and a real
 * manifest, so the fixture cannot drift into testing a second implementation
 * of the verdict.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import { formatSite, scanExports } from "./helpers/exportGraph.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// --- the detector, over a package whose residue is known by construction ---

/**
 * A miniature package with the same shape as this one: an `exports` map naming
 * an emitted entry, a build config that folds that entry back to its source,
 * and a wider config adding a consumer module outside the shipped surface —
 * this repo's `tests/` in miniature.
 *
 * Its five shipped exports cover every way one is earned and the one way none
 * is. `publicEntry` sits on the map; `Shipped` is off the map but reachable
 * through `publicEntry`'s signature; `testOnly` and `internal` are reached by
 * nothing and referenced only from the consumer module; `residue` is
 * referenced from nowhere outside its own module, though that module uses it
 * internally and a comment names it — the two cases a text search would call
 * a hit.
 */
const FIXTURE_FILES: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({
    name: "fixture-pkg",
    exports: {
      ".": { types: "./dist/lib/index.d.ts", default: "./dist/lib/index.js" },
    },
  }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
    },
    include: ["lib/**/*", "consumer/**/*"],
  }),
  "tsconfig.build.json": JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: {
      noEmit: false,
      outDir: "./dist",
      rootDir: ".",
      declaration: true,
      allowImportingTsExtensions: false,
      rewriteRelativeImportExtensions: true,
    },
    include: ["lib/**/*"],
  }),
  "lib/index.ts": `export { publicEntry } from "./surface.js";\n`,
  "lib/shapes.ts": `export interface Shipped {\n  readonly n: number;\n}\n`,
  "lib/surface.ts": [
    `import type { Shipped } from "./shapes.js";`,
    ``,
    `export const publicEntry = (s: Shipped): number => s.n;`,
    ``,
    `export const testOnly = (n: number): number => n * 2;`,
    ``,
    `// Exported, used only here: the scan must read neither this module's own`,
    `// use of \`residue\` nor this mention of the name as a consumer.`,
    `export const residue = (n: number): number => n + 1;`,
    ``,
    `export const internal = (n: number): number => residue(n);`,
    ``,
  ].join("\n"),
  "consumer/drive.ts": [
    // A namespace import plus property access — the reference form a named
    // import would make trivial and a text search would miss.
    `import * as surface from "../lib/surface.ts";`,
    ``,
    `export const drive = (): number => surface.testOnly(surface.internal(1));`,
    ``,
  ].join("\n"),
};

let fixtureRoot = "";

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "flume-export-scan-"));
  for (const [rel, body] of Object.entries(FIXTURE_FILES)) {
    const path = join(fixtureRoot, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

it("the export scan flags an export that no other module references and the exports map cannot reach", () => {
  const scan = scanExports({
    root: fixtureRoot,
    buildConfig: "tsconfig.build.json",
    programConfig: "tsconfig.json",
  });

  // Vacuity guard: the scan resolved the package's entry and judged its
  // shipped exports before any verdict is read off it. A scan that resolved no
  // entry module, or judged nothing, would report its finding for the wrong
  // reason.
  expect(scan.entryModules).toEqual(["lib/index.ts"]);
  expect(scan.scanned.map((s) => s.name).sort()).toEqual([
    "Shipped",
    "internal",
    "publicEntry",
    "residue",
    "testOnly",
  ]);

  expect(scan.unearned.map(formatSite)).toEqual(["lib/surface.ts:9 residue"]);

  // Both earning arms fired, each over the exports it belongs to — so the
  // single finding above is a discrimination, not a scan that flagged
  // everything it could not classify.
  expect(scan.reachable.map((s) => s.name).sort()).toEqual([
    "Shipped",
    "publicEntry",
  ]);
  expect(scan.referenced.map((s) => s.name).sort()).toEqual([
    "internal",
    "testOnly",
  ]);
});

// --- the pin -------------------------------------------------------------

it("every src/ and harness/ export is reached by the package exports map or referenced from another module", () => {
  const scan = scanExports({
    root: REPO_ROOT,
    buildConfig: "tsconfig.build.json",
    programConfig: "tsconfig.json",
  });

  // Vacuity guard: both entries of this package's `exports` map folded back to
  // sources, and the judged set is populated, before the emptiness assertion.
  // A build config that stopped matching the manifest would otherwise report a
  // clean tree over zero exports.
  expect([...scan.entryModules].sort()).toEqual([
    "harness/index.ts",
    "src/index.ts",
  ]);
  expect(scan.scanned.length).toBeGreaterThan(200);

  // Both arms carry weight here too: neither "everything is on the map" nor
  // "nothing is" would exercise the verdict this pin exists to hold.
  expect(scan.reachable.length).toBeGreaterThan(0);
  expect(scan.referenced.length).toBeGreaterThan(0);

  expect(scan.unearned.map(formatSite)).toEqual([]);
});
