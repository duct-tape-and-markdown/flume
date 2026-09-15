/**
 * `.claude/rules/engineering.md` *An export earns its consumer* is the ladder's
 * bottom rung for its property, and this file is the rung above it: the pin
 * that makes the absence verdict mechanical over `src/` and `harness/`.
 *
 * Two verdicts ride the one scan. *Unearned* is the rule's own: an export
 * nothing reaches and nothing references. *Unnamable* is its consumer-facing
 * half — a type the shipped signature and property positions name that no
 * entry module exports, so the hover text shows a name no `import` can carry.
 *
 * Each is asserted over a fixture as well as over this tree, because a pin
 * asserting an absence needs its detector shown working. The fixture arms
 * drive the scanner over a package whose residue and whose unnamable
 * types are known by construction — otherwise "none of either" is a claim no
 * failing run has ever backed. The repo arms are the pins themselves, and
 * `unnamable` splits across three of them: a top-level function's signature,
 * a reached type's member signature, and a reached type's property
 * annotation are found by different parts of the walk, so each is judged
 * under its own title.
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
  formatSite,
  formatUnnamableType,
  scanExports,
  type ExportScan,
  type UnnamableType,
} from "./helpers/exportGraph.ts";

/**
 * Which part of the walk a finding came from. The scan says whether the
 * position was a signature or a property; within the signatures, a member is
 * reported dotted from the type that declares it (`Chain.worktreesBase`)
 * while a top-level one carries a bare identifier, which can hold no dot. The
 * three arms below split `unnamable` on these so each judges the part its
 * title claims, rather than all three restating one array.
 */
const isTopLevelSignature = (found: UnnamableType): boolean =>
  found.kind === "signature" && !found.position.name.includes(".");
const isMemberSignature = (found: UnnamableType): boolean =>
  found.kind === "signature" && found.position.name.includes(".");
const isProperty = (found: UnnamableType): boolean => found.kind === "property";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// --- the detector, over a package whose residue is known by construction ---

/**
 * A miniature package with the same shape as this one: an `exports` map naming
 * an emitted entry, a build config that folds that entry back to its source,
 * and a wider config adding a consumer module outside the shipped surface —
 * this repo's `tests/` in miniature.
 *
 * Its shipped exports cover every way one is earned and the one way none is.
 * `publicEntry` sits on the map; `Shipped` is off the map but reachable
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
 *
 * Four more cover the member walk and its exclusions, each as a type named
 * from exactly one place. `Container.reach` is a member signature, and the
 * `Membered` it names is the second finding. `Container.held` is a property
 * position, and the `Held` it names is the third — while `Container.boxed`
 * is the same position over a `Box` the entry module re-exports, so the
 * property arm discriminates exactly as the signature arm does. `Guarded.hush`
 * is `private`, so neither the member nor the `Hushed` it names is public
 * surface at all — `Hushed` stays earned only through the consumer module,
 * which is how the arm sees the exclusion fire rather than inferring it.
 * `Box.Lid.open` is a namespace member, and the `Box.Key` it names is written
 * through the namespace, as is the `Box.Lid` that `Box.lid` holds — the
 * exclusion reads from both sides, the position's and the named type's.
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
    `export type { Container, Guarded } from "./surface.js";`,
    `export type { Box, Named } from "./shapes.js";`,
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
    `export interface Membered {`,
    `  readonly m: number;`,
    `}`,
    ``,
    `export interface Hushed {`,
    `  readonly h: number;`,
    `}`,
    ``,
    `export interface Held {`,
    `  readonly held: number;`,
    `}`,
    ``,
    `export interface Box {`,
    `  readonly lid: Box.Lid;`,
    `}`,
    ``,
    `export declare namespace Box {`,
    `  export interface Lid {`,
    `    readonly open: (k: Key) => void;`,
    `  }`,
    `  export interface Key {`,
    `    readonly k: string;`,
    `  }`,
    `}`,
    ``,
  ].join("\n"),
  "lib/surface.ts": [
    `import type { Box, Held, Hushed, Membered, Named, Shipped } from "./shapes.js";`,
    ``,
    `export const publicEntry = (s: Shipped, k: Named): number =>`,
    `  s.n + k.label.length;`,
    ``,
    `export interface Container {`,
    `  readonly reach: (m: Membered) => void;`,
    `  readonly boxed: Box;`,
    `  readonly held: Held;`,
    `}`,
    ``,
    `export class Guarded {`,
    `  private hush(h: Hushed): number {`,
    `    return h.h;`,
    `  }`,
    `}`,
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
    `import type { Hushed } from "../lib/shapes.ts";`,
    ``,
    `export const drive = (): number => surface.testOnly(surface.internal(1));`,
    ``,
    `export const hush = (h: Hushed): number => h.h;`,
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
    "Box",
    "Container",
    "Guarded",
    "Held",
    "Hushed",
    "Membered",
    "Named",
    "Shipped",
    "internal",
    "publicEntry",
    "residue",
    "testOnly",
  ]);

  expect(scan.unearned.map(formatSite)).toEqual(["lib/surface.ts:22 residue"]);

  // Both earning arms fired, each over the exports it belongs to — so the
  // single finding above is a discrimination, not a scan that flagged
  // everything it could not classify. `Hushed` sits on the referenced side
  // and not the reachable one: a `private` member's parameter type is off the
  // emitted `.d.ts`, so the map does not reach it through `Guarded`.
  expect(scan.reachable.map((s) => s.name).sort()).toEqual([
    "Box",
    "Container",
    "Guarded",
    "Held",
    "Membered",
    "Named",
    "Shipped",
    "publicEntry",
  ]);
  expect(scan.referenced.map((s) => s.name).sort()).toEqual([
    "Hushed",
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
  expect(scan.signatures.map(formatSite)).toContain(
    "lib/surface.ts:3 publicEntry",
  );
  expect(scan.reachable.map((s) => s.name).sort()).toContain("Shipped");

  // `Named` is re-exported by `lib/index.ts` and so is absent here; `Shipped`
  // is not, and is the finding. Same signature, same reachability, opposite
  // verdicts — the arm discriminates rather than flagging what it walked.
  expect(
    scan.unnamable.filter(isTopLevelSignature).map(formatUnnamableType),
  ).toEqual(["lib/surface.ts:3 publicEntry names lib/shapes.ts:1 Shipped"]);
});

it("the export scan walks a member signature and skips a private member and a namespace member", () => {
  const scan = fixtureScan();

  // Vacuity guard: the walk reached the whole surface, and the one member it
  // is allowed to walk is in the set by name. An empty `signatures` — or one
  // holding only the top-level function — would make every exclusion below
  // read green for having walked nothing.
  expect(scan.entryModules).toEqual(["lib/index.ts"]);
  expect(scan.signatures.map(formatSite)).toEqual([
    "lib/surface.ts:3 publicEntry",
    "lib/surface.ts:7 Container.reach",
  ]);

  // The member signature's parameter type is the finding, exactly as a
  // top-level function's would be.
  expect(
    scan.unnamable.filter(isMemberSignature).map(formatUnnamableType),
  ).toEqual([
    "lib/surface.ts:7 Container.reach names lib/shapes.ts:9 Membered",
  ]);

  // Both exclusions, read off the types they would otherwise have flagged:
  // `Guarded.hush` is `private` and `Box.Lid.open` is a namespace member, so
  // neither `Hushed` nor `Key` reaches a verdict here.
  const flagged = scan.unnamable.map((f) => f.type.name);
  expect(flagged).not.toContain("Hushed");
  expect(flagged).not.toContain("Key");
});

it("the export scan flags a property type no entry module exports", () => {
  const scan = fixtureScan();

  // Vacuity guard: the map resolved, and the walk carries every property
  // position the shipped surface has — the two on `Container` that split the
  // verdict among them. An empty `properties` would report the same empty
  // `unnamable` below for having walked nothing at all.
  expect(scan.entryModules).toEqual(["lib/index.ts"]);
  expect(scan.properties.map(formatSite).sort()).toEqual([
    "lib/shapes.ts:10 Membered.m",
    "lib/shapes.ts:18 Held.held",
    "lib/shapes.ts:2 Shipped.n",
    "lib/shapes.ts:22 Box.lid",
    "lib/shapes.ts:6 Named.label",
    "lib/surface.ts:8 Container.boxed",
    "lib/surface.ts:9 Container.held",
  ]);

  // `Box` is re-exported by `lib/index.ts` and so `Container.boxed` is
  // silent; `Held` is not, and is the finding. Same container, same
  // reachability, opposite verdicts — the arm discriminates rather than
  // flagging every property it walked.
  expect(scan.unnamable.filter(isProperty).map(formatUnnamableType)).toEqual([
    "lib/surface.ts:9 Container.held names lib/shapes.ts:17 Held",
  ]);

  // The namespace exclusion read from the named type's side rather than the
  // position's: `Box.lid` is an ordinary property of an ordinary interface,
  // and the `Box.Lid` it holds is written through the namespace.
  expect(scan.unnamable.map((f) => f.type.name)).not.toContain("Lid");
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

  expect(
    scan.unnamable.filter(isTopLevelSignature).map(formatUnnamableType),
  ).toEqual([]);
});

it("every type a member signature of a reached type names is exported from an entry module", () => {
  const scan = repoScan();

  // Vacuity guard: the map resolved to both entry modules, and the walk
  // carries member signatures — named, because a top-level-only walk reports
  // the same empty verdict below. `Chain.worktreesBase` is the callback whose
  // `FlumePaths` parameter this arm first went red over; the other two are a
  // class method and an interface method, the two member kinds the walk
  // collects differently.
  expect([...scan.entryModules].sort()).toEqual([
    "harness/index.ts",
    "src/index.ts",
  ]);
  const walked = new Set(scan.signatures.map((site) => site.name));
  for (const member of [
    "Chain.worktreesBase",
    "Dispatcher.render",
    "Phase.handoff",
  ]) {
    expect(walked).toContain(member);
  }

  expect(
    scan.unnamable.filter(isMemberSignature).map(formatUnnamableType),
  ).toEqual([]);
});

it("every type a reached property position names is exported from an entry module", () => {
  const scan = repoScan();

  // Vacuity guard: the map resolved to both entry modules, and the walk
  // carries property positions — named, because a signature-only walk reports
  // the same empty verdict below. These three are the positions this arm
  // first went red over, one per module that had to gain an entry line.
  expect([...scan.entryModules].sort()).toEqual([
    "harness/index.ts",
    "src/index.ts",
  ]);
  const walked = new Set(scan.properties.map((site) => site.name));
  for (const property of [
    "TickResult.entries",
    "FlumeApi.paths",
    "TickVerdict.gateFailures",
  ]) {
    expect(walked).toContain(property);
  }

  expect(scan.unnamable.filter(isProperty).map(formatUnnamableType)).toEqual(
    [],
  );
});
