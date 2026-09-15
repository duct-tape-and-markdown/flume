/**
 * `.claude/rules/engineering.md` *An export earns its consumer* is the ladder's
 * bottom rung for its property, and this file is the rung above it: the pin
 * that makes the absence verdict mechanical over `src/` and `harness/`.
 *
 * Two verdicts ride the one scan. *Unearned* is the rule's own: an export
 * nothing reaches and nothing references. *Unnamable* is its consumer-facing
 * half — a type the shipped signatures name that no entry module exports, so
 * the hover text shows a name no `import` can carry.
 *
 * Each is asserted twice, because a pin asserting an absence needs its
 * detector shown working. The fixture arms drive the scanner over a package
 * whose residue and whose unnamable signature type are both known by
 * construction — otherwise "none of either" is a claim no failing run has
 * ever backed. The repo arms are the pins themselves.
 *
 * The scanner is the same one throughout, reading real tsconfigs and a real
 * manifest, so the fixture cannot drift into testing a second implementation
 * of the verdict.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  formatSignatureType,
  formatSite,
  scanExports,
  type ExportScan,
} from "./helpers/exportGraph.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// --- the detector, over a package whose residue is known by construction ---

/**
 * A miniature package with the same shape as this one: an `exports` map naming
 * an emitted entry, a build config that folds that entry back to its source,
 * and a wider config adding a consumer module outside the shipped surface —
 * this repo's `tests/` in miniature.
 *
 * Its six shipped exports cover every way one is earned and the one way none
 * is. `publicEntry` sits on the map; `Shipped` is off the map but reachable
 * through `publicEntry`'s signature; `testOnly` and `internal` are reached by
 * nothing and referenced only from the consumer module; `residue` is
 * referenced from nowhere outside its own module, though that module uses it
 * internally and a comment names it — the two cases a text search would call
 * a hit.
 *
 * The two types `publicEntry` names split the second verdict: `Named` is
 * re-exported by the entry module and so is nameable, `Shipped` is not and so
 * is the one finding. Reachability cannot tell them apart — both land in the
 * emitted `.d.ts` — which is the whole reason the second arm exists.
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
  "lib/index.ts": [
    `export { publicEntry } from "./surface.js";`,
    `export type { Named } from "./shapes.js";`,
    ``,
  ].join("\n"),
  "lib/shapes.ts": [
    `export interface Shipped {`,
    `  readonly n: number;`,
    `}`,
    ``,
    `export interface Named {`,
    `  readonly label: string;`,
    `}`,
    ``,
  ].join("\n"),
  "lib/surface.ts": [
    `import type { Named, Shipped } from "./shapes.js";`,
    ``,
    `export const publicEntry = (s: Shipped, k: Named): number =>`,
    `  s.n + k.label.length;`,
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

/**
 * One scan per package, shared by the arms that read it. A scan builds a whole
 * TypeScript program, so running one per assertion would pay that cost four
 * times over to reach the same four verdicts.
 */
const once = (build: () => ExportScan): (() => ExportScan) => {
  let memo: ExportScan | undefined;
  return () => (memo ??= build());
};

const fixtureScan = once(() =>
  scanExports({
    root: fixtureRoot,
    buildConfig: "tsconfig.build.json",
    programConfig: "tsconfig.json",
  }),
);

const repoScan = once(() =>
  scanExports({
    root: REPO_ROOT,
    buildConfig: "tsconfig.build.json",
    programConfig: "tsconfig.json",
  }),
);

it("the export scan flags an export that no other module references and the exports map cannot reach", () => {
  const scan = fixtureScan();

  // Vacuity guard: the scan resolved the package's entry and judged its
  // shipped exports before any verdict is read off it. A scan that resolved no
  // entry module, or judged nothing, would report its finding for the wrong
  // reason.
  expect(scan.entryModules).toEqual(["lib/index.ts"]);
  expect(scan.scanned.map((s) => s.name).sort()).toEqual([
    "Named",
    "Shipped",
    "internal",
    "publicEntry",
    "residue",
    "testOnly",
  ]);

  expect(scan.unearned.map(formatSite)).toEqual(["lib/surface.ts:10 residue"]);

  // Both earning arms fired, each over the exports it belongs to — so the
  // single finding above is a discrimination, not a scan that flagged
  // everything it could not classify.
  expect(scan.reachable.map((s) => s.name).sort()).toEqual([
    "Named",
    "Shipped",
    "publicEntry",
  ]);
  expect(scan.referenced.map((s) => s.name).sort()).toEqual([
    "internal",
    "testOnly",
  ]);
});

it("the export scan flags a signature type no entry module exports", () => {
  const scan = fixtureScan();

  // Vacuity guard: the scan judged a populated surface, and both types
  // `publicEntry` names are *reachable* — the weaker verdict cannot separate
  // them. Without this, an empty `unnamable` below could mean the signature
  // was never walked at all.
  expect(scan.entryModules).toEqual(["lib/index.ts"]);
  expect(scan.signatures.map(formatSite)).toEqual([
    "lib/surface.ts:3 publicEntry",
  ]);
  expect(scan.reachable.map((s) => s.name).sort()).toEqual([
    "Named",
    "Shipped",
    "publicEntry",
  ]);

  // `Named` is re-exported by `lib/index.ts` and so is absent here; `Shipped`
  // is not, and is the finding. Same signature, same reachability, opposite
  // verdicts — the arm discriminates rather than flagging what it walked.
  expect(scan.unnamable.map(formatSignatureType)).toEqual([
    "lib/surface.ts:3 publicEntry names lib/shapes.ts:1 Shipped",
  ]);
});

// --- the pins ------------------------------------------------------------

it("every src/ and harness/ export is reached by the package exports map or referenced from another module", () => {
  const scan = repoScan();

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

it("every type an exported function's signature names is exported from an entry module", () => {
  const scan = repoScan();

  // Vacuity guard: the map resolved to both entry modules, and the arm walked
  // a populated signature set — including the three functions whose option
  // and ref types this verdict first went red over. Asserting the walked set
  // rather than the verdict is what makes the emptiness below mean something:
  // a signature walk that stopped finding functions would report the same
  // empty `unnamable`.
  expect([...scan.entryModules].sort()).toEqual([
    "harness/index.ts",
    "src/index.ts",
  ]);
  const walked = new Set(scan.signatures.map((site) => site.name));
  expect(walked.size).toBeGreaterThan(0);
  for (const fn of [
    "partitionByFileOverlap",
    "priorAttemptPath",
    "renderPrompt",
  ]) {
    expect(walked).toContain(fn);
  }

  expect(scan.unnamable.map(formatSignatureType)).toEqual([]);
});
