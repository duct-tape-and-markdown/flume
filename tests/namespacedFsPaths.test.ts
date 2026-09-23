/**
 * The package's paths as they reach disk — `src/` and `harness/` together.
 * Every path either tree hands an fs call is composed under a state root, a
 * repo root or a worktree base *a consumer chose*, none of which the package
 * bounds, so win32's ~260-character total-path limit is reachable at all of
 * them (`.claude/rules/platform-facts.md`, *Windows MAX_PATH (~260 chars)
 * breaks fs calls with no long component*).
 *
 * Two lenses, because one cannot see what the other does:
 *
 * - The **tree-wide scan** reads the call sites, through the shared scan
 *   `tests/Baton.test.ts` judges its one module with. `toNamespacedPath` is
 *   identity on posix, so nothing a behavior test can observe on this
 *   suite's host distinguishes a wrapped path from a bare join — the source
 *   shape is what carries the property, and a module joining the scan does
 *   so by importing fs, never by being added to a list here.
 * - The **deep round-trip** drives the real writer and the real reader over
 *   a state root nesting past that limit (*A seam gate reads what the real
 *   writer wrote*). On posix it proves the composition survives the depth;
 *   on win32 it is the case that fails without the prefix.
 *
 * The scan reads both halves of a fold: that the path a call reaches disk on
 * was composed, and — where the call answers with a path built from it —
 * where that answer goes. A namespaced answer is still in win32's `\\?\`
 * alphabet, so a consumer that parses a path reads it as something else
 * (`pathToFileURL` takes `\\?\C:\…` for a UNC host). Composed and spent
 * are one property; a scan holding only the first passes the site that folds
 * correctly and then hands the answer to a reader that cannot take it.
 *
 * Where that answer goes out of reach — a callback form hands it to a
 * function the site passed, and nothing of it crosses the call expression —
 * the scan reports the call as unfollowed rather than returning the empty
 * escape verdict a clean call returns. An answer nothing read is not an
 * answer that was judged (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * And it reads the head the fold arrives at, because a composed path is not
 * a safer argument everywhere: node's JS realpath walk refuses every
 * namespaced drive path through node 22 — `realpathSync` throwing it, the
 * callback `realpath` handing it to its callback — so at those spellings the
 * fold is correct and the callee is the defect
 * (`.claude/rules/platform-facts.md`, *`realpathSync` keeps the `\\?\` prefix
 * only where nothing resolved*). The same name off `node:fs/promises` is the
 * native binding, so the verdict is read against the specifier and not the
 * name, which is the direction that would red a resolving call.
 *
 * `harness/planState.ts` is the loud one behind both: absence is a declared
 * state there, so a read that fails for a path-length reason reads back as
 * *no cursor*, and every plan window re-arms over a corpus that was already
 * derived.
 *
 * The scan's own reading of a call is pinned here too, because the two trees
 * are judged through it: an argument it mistakes for a path (a probe's
 * subject label) reds a correct site, and one it skips (a variadic descent)
 * leaves a real one unread — as does a call site it does not recognize as
 * one, which is the quiet direction, since a skipped call takes its path
 * argument and its answer out of both verdicts at once.
 */

import { readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, toNamespacedPath } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  planStatePath,
  readPlanState,
  writePlanState,
  type PlanState,
} from "../harness/index.ts";

import { mkTempDir } from "./helpers/fixtureRoot.ts";
import {
  describeBareCall,
  describeEscape,
  describeJsForm,
  describeUncalled,
  describeUnfollowed,
  scanFsCalls,
  type FsCallScan,
} from "./helpers/namespacedFsScan.ts";
import { expectNoFindings } from "./helpers/repoProgram.ts";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * Every `.ts` module under `tree`, walked rather than listed: a module added
 * to the package joins this scan by existing, which is the whole reason the
 * subject is the tree and not the files a finding named.
 */
function scanTree(tree: string): FsCallScan[] {
  const walk = (dir: string, rel: string): FsCallScan[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const here = `${rel}/${entry.name}`;
      if (entry.isDirectory()) return walk(join(dir, entry.name), here);
      if (!entry.name.endsWith(".ts")) return [];
      return [scanFsCalls(here, readFileSync(join(dir, entry.name), "utf8"))];
    });
  return walk(join(REPO_ROOT, tree), tree);
}

/**
 * The three cases every shipped tree gets: the vacuity pin its two verdicts
 * need, the composition verdict itself, and the import the scan could not
 * judge because nothing calls it. `tests[]` and `pins[]` are matched on a
 * title, so each tree spells its own — the bodies are one shape and this is
 * their one home.
 */
function pinTree(
  tree: string,
  titles: { vacuity: string; composed: string; uncalled: string },
): void {
  const scans = scanTree(tree);
  const withFs = scans.filter((scan) => scan.symbols.length > 0);
  const judged = withFs.reduce((n, scan) => n + scan.judged, 0);

  /**
   * The subject count every verdict below rides (`.claude/rules/engineering.md`,
   * *A green verdict is proven non-vacuous*): a walk that stopped finding
   * modules, an import clause the scan stopped matching, or a call-site regex
   * that stopped matching would each leave an empty findings list looking
   * like a clean tree.
   */
  const populated = (): void => {
    expect(scans.length).toBeGreaterThan(0);
    expect(withFs.length).toBeGreaterThan(0);
    expect(judged).toBeGreaterThan(0);
  };

  it(titles.vacuity, populated);

  it(titles.composed, () => {
    populated();
    expectNoFindings(
      withFs.flatMap((scan) => scan.bare.map((call) => describeBareCall(scan, call))),
    );
  });

  it(titles.uncalled, () => {
    populated();
    expectNoFindings(
      withFs.flatMap((scan) => scan.uncalled.map((fn) => describeUncalled(scan, fn))),
    );
  });
}

describe("src/ — win32 MAX_PATH fix (.claude/rules/platform-facts.md)", () => {
  pinTree("src", {
    vacuity: "the src/ scan reads modules, fs importers among them, and path arguments in those",
    composed: "every fs call in src/ is made on a composed path",
    uncalled: "every fs symbol src/ imports is called, so none is imported past the scan",
  });
});

describe("harness/ — win32 MAX_PATH fix (.claude/rules/platform-facts.md)", () => {
  pinTree("harness", {
    vacuity:
      "the harness/ scan reads modules, fs importers among them, and path arguments in those",
    composed: "every fs call in harness/ is made on a composed path",
    uncalled: "every fs symbol harness/ imports is called, so none is imported past the scan",
  });
});

/**
 * A call on the loud probe's variadic descent, in the shape `src/` writes it:
 * a subject noun phrase, then the state root, then the dir being proven. The
 * probe namespaces each step of the descent itself (`src/fsProbe.ts`), so
 * every path here is correct as written and none of them is the caller's to
 * fold — while the subject is a label the probe never stats.
 */
const DESCENT_SOURCE = `
import { isDirectoryOrAbsent } from "./fsProbe.js";
import { mergingDir } from "./paths.js";

export function markerDir(flumeDir: string): string | undefined {
  const dir = mergingDir(flumeDir);
  return isDirectoryOrAbsent("merging-marker dir", flumeDir, dir) ? dir : undefined;
}
`;

/**
 * The shape the composition verdict exists to red: a path built from segments
 * and handed to an fs call with no fold on it. Segments are identifiers rather
 * than string literals because the scan reports the argument off its masked
 * source, where a literal reads as blanks.
 */
const BARE_JOIN_SOURCE = `
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function read(root: string, name: string): string {
  return readFileSync(join(root, name), "utf8");
}
`;

describe("the scan's reading of one call", () => {
  it("the namespaced-fs scan names the call and the uncomposed argument of a bare join", () => {
    // `describeBareCall` is the rendering both tree verdicts and the per-module
    // one (`tests/Baton.test.ts`) read their findings through, and all three
    // find none — so without this case the line a revert would be handed has
    // never been produced at all (`.claude/rules/engineering.md`, *A green
    // verdict is proven non-vacuous*).
    const scan = scanFsCalls("src/fixture.ts", BARE_JOIN_SOURCE);

    expect(scan.judged).toBe(1);
    expect(scan.bare.map((call) => describeBareCall(scan, call))).toEqual([
      "src/fixture.ts:6 — readFileSync() path argument 0, `join(root, name)`, " +
        "is not composed for win32's path limit",
    ]);
  });

  it("the scan reads a variadic fs-probe descent's paths and not the subject it names", () => {
    const scan = scanFsCalls("src/fixture.ts", DESCENT_SOURCE);

    // Both descent steps are read as paths, and neither is charged to this
    // module: the probe folds what it is handed.
    expect(scan.delegated).toBe(2);
    expect(scan.judged).toBe(0);
    // The subject label composes through nothing and would red here if the
    // scan read argument 0 as the path — which is the direction this pins.
    expect(scan.bare.map((call) => describeBareCall(scan, call))).toEqual([]);
  });
});

/**
 * The shape `src/cli.ts` carries: a fold spent at libuv's
 * `realpathSync.native`, whose answer is spent again at `plainPath`
 * (`src/paths.ts`) — the fold that ends win32's namespaced alphabet.
 *
 * Two axes ride this one fixture, because one source carries both and a
 * second spelling of it would only be a second thing to keep in step. The
 * callee is a member expression, and the scan reads member callees dotted so
 * `JSON.parse` is never taken for an imported `parse` — so without the head
 * rule this call site would go unread: its path argument unjudged, its answer
 * unfollowed, and the symbol reported as imported-and-never-called while a
 * real call sits two lines below the import. And the answer is spent, not
 * escaping, which the reader must admit — a reader that refused it would
 * leave only the two shapes that hide an escape, binding the answer to a name
 * or not folding back at all.
 */
const FOLDED_SOURCE = `
import { realpathSync } from "node:fs";
import { toNamespacedPath } from "node:path";
import { plainPath } from "./paths.js";

export function entryIdentity(argv1: string): string {
  return plainPath(realpathSync.native(toNamespacedPath(argv1)));
}
`;

/**
 * The shape `src/cli.ts` carried until the windows lane read it: the same
 * fold and the same native call, whose answer is handed straight to
 * `pathToFileURL`. On win32 that answer is `\\?\C:\…`, which the URL builder
 * reads as a UNC host, so the entry check answered "not the entry" for every
 * junction- or symlink-based install (pnpm's linked store) and `flume` ran
 * nothing. The behavior cannot red off win32 — `toNamespacedPath` is identity
 * elsewhere — so the expression the answer is written into is where the
 * defect is decidable, and this is the reader that decides it.
 *
 * The call resolves through `.native` like the fixture above, so this source
 * differs from it in the answer's reader alone: the axis it exists to decide
 * is not confounded by a second defect at the same call.
 */
const ESCAPING_SOURCE = `
import { realpathSync } from "node:fs";
import { toNamespacedPath } from "node:path";
import { pathToFileURL } from "node:url";

export function entryUrl(argv1: string): string {
  return pathToFileURL(realpathSync.native(toNamespacedPath(argv1))).href;
}
`;

/**
 * The composed path at the head that cannot take it: node's JS
 * `realpathSync`, which lstats the root it splits off its argument and throws
 * on every namespaced drive path through node 22 — the version `engines`
 * admits and CI runs (`.claude/rules/platform-facts.md`, *`realpathSync`
 * keeps the `\\?\` prefix only where nothing resolved*). Every other verdict
 * is green over this source: the path composes, and its answer is spent at
 * the fold that ends the alphabet. The fold is correct and the callee throws
 * on it, which is why the head needs a verdict of its own.
 */
const JS_FORM_SOURCE = `
import { realpathSync } from "node:fs";
import { toNamespacedPath } from "node:path";
import { plainPath } from "./paths.js";

export function entryIdentity(argv1: string): string {
  return plainPath(realpathSync(toNamespacedPath(argv1)));
}
`;

/**
 * The same composed path at the async spelling of the same JS walk. The
 * callback `realpath` splits the same root off the argument and hands the
 * same failure to its callback rather than throwing it, so `.native` is the
 * only head that resolves a namespaced path here too
 * (`.claude/rules/platform-facts.md`, *`realpathSync` keeps the `\\?\` prefix
 * only where nothing resolved*). Nothing but the callee separates this source
 * from the one below it.
 */
const CALLBACK_JS_FORM_SOURCE = `
import { realpath } from "node:fs";
import { toNamespacedPath } from "node:path";
import { plainPath } from "./paths.js";

export function entryIdentity(argv1: string, done: (id: string) => void): void {
  realpath(toNamespacedPath(argv1), (_err, resolved) => done(plainPath(resolved)));
}
`;

/**
 * The head that does take it, over the same fold and the same callback — and
 * so the one source on which every verdict but the answer's is green: the
 * path composes, and `.native` is the head that resolves a namespaced one.
 * What remains is where the answer went, which is a callback, and that is the
 * axis the unfollowed report decides.
 */
const CALLBACK_NATIVE_SOURCE = CALLBACK_JS_FORM_SOURCE.replace(
  "  realpath(",
  "  realpath.native(",
);

/**
 * The third spelling of the name, and the one a flat refusal would red: off
 * `node:fs/promises` `realpath` *is* the native binding — no root split, the
 * prefix stripped — so the composed path resolves, and there is no `.native`
 * head the site could be asked for instead.
 */
const PROMISES_REALPATH_SOURCE = `
import { realpath } from "node:fs/promises";
import { toNamespacedPath } from "node:path";
import { plainPath } from "./paths.js";

export async function entryIdentity(argv1: string): Promise<string> {
  return plainPath(await realpath(toNamespacedPath(argv1)));
}
`;

describe("the scan's reading of a member callee", () => {
  it("the namespaced-fs scan reads `realpathSync.native` as the path-answering fs call it is", () => {
    const folded = scanFsCalls("src/fixture.ts", FOLDED_SOURCE);

    // Read at all: the call is the symbol's, so the import is not reported
    // unjudgeable and its path argument is one this module owed a fold on.
    expect(folded.uncalled).toEqual([]);
    expect(folded.judged).toBe(1);
    expect(folded.bare.map((call) => describeBareCall(folded, call))).toEqual([]);

    // And read on `realpathSync`'s contract rather than the default's: the
    // native call answers with a path built from the namespaced one, so the
    // answer is followed outward — spent here, escaping below.
    expect(folded.answered).toBe(1);
    expect(folded.escaped.map((e) => describeEscape(folded, e))).toEqual([]);

    const escaping = scanFsCalls("src/fixture.ts", ESCAPING_SOURCE);
    expect(escaping.answered).toBe(1);
    expect(escaping.escaped.map((e) => describeEscape(escaping, e))).toEqual([
      "src/fixture.ts:7 — realpathSync() answers a path in win32's namespaced alphabet " +
        "and pathToFileURL(), which is no fs call, reads it",
    ]);
  });

  it("the scan still refuses a member callee the imported fs symbol does not head", () => {
    // The direction the rule above must not widen into. Two shapes, one
    // rule: a foreign receiver whose *tail* spells the import
    // (`api.readFileSync`) is not this module's call site, and a member
    // callee the import does not head (`JSON.parse`) is not an fs call at
    // all. Only the bare `readFileSync` below is judged, and it is composed —
    // so a scan that read either member callee as the import would red here
    // on an argument that is no path.
    const foreign = scanFsCalls(
      "src/fixture.ts",
      `
import { readFileSync } from "node:fs";
import { namespacedJoin } from "./paths.js";

export function config(api: CacheApi, dir: string): unknown {
  api.readFileSync("cache-key");
  return JSON.parse(readFileSync(namespacedJoin(dir, "c.json"), "utf8"));
}
`,
    );
    expect(foreign.judged).toBe(1);
    expect(foreign.bare.map((call) => describeBareCall(foreign, call))).toEqual([]);
    // `readFileSync` answers content, not a path, so nothing is followed out
    // to `JSON.parse` — the escape verdict is vacuous here by design.
    expect(foreign.answered).toBe(0);
    expect(foreign.uncalled).toEqual([]);
  });
});

/**
 * A type literal whose method signature spells an fs symbol the module also
 * imports and calls. Nothing reaches disk at a signature — it is a shape the
 * module describes — so the scan owes it neither a fold verdict nor a place
 * in the subject count the tree verdicts ride: the composed call below is the
 * module's one call site.
 */
const TYPE_POSITION_SOURCE = `
import { readFileSync } from "node:fs";
import { namespacedJoin } from "./paths.js";

export interface FileHost {
  readFileSync(key: string, encoding: string): string;
}

export function config(dir: string): string {
  return readFileSync(namespacedJoin(dir, "c.json"), "utf8");
}
`;

/** The same signature with nothing calling the symbol it spells. */
const SIGNATURE_ONLY_SOURCE = `
import { readFileSync } from "node:fs";

export interface FileHost {
  readFileSync(key: string, encoding: string): string;
}
`;

describe("the scan's reading of a type position", () => {
  it("a method signature in a type literal is not read as an fs call site", () => {
    const scan = scanFsCalls("src/fixture.ts", TYPE_POSITION_SOURCE);

    // One call site, one path argument owed a fold — the signature's `key`
    // is no path, and a scan reading it as one both inflates the subject
    // count and reds this module over an argument that never reaches disk.
    expect(scan.judged).toBe(1);
    expect(scan.bare.map((call) => describeBareCall(scan, call))).toEqual([]);
    expect(scan.uncalled).toEqual([]);

    // And the quiet direction stays loud: a module that only *describes* the
    // symbol has no call site at all, which the scan reports rather than
    // passing over.
    const described = scanFsCalls("src/fixture.ts", SIGNATURE_ONLY_SOURCE);
    expect(described.uncalled.map((fn) => describeUncalled(described, fn))).toEqual([
      "src/fixture.ts imports readFileSync and never calls it",
    ]);
  });
});

describe("a namespaced path never leaves its fs call", () => {
  it("the win32 path scan admits a toNamespacedPath result spent at the fold that ends the alphabet", () => {
    const fixture = scanFsCalls("src/fixture.ts", FOLDED_SOURCE);
    // Same fold, same answer, one reader apart from the refusal below: the
    // composition verdict is green over both, and only the answer's reader
    // separates them.
    expect(fixture.bare).toEqual([]);
    expect(fixture.answered).toBe(1);
    expect(fixture.escaped.map((e) => describeEscape(fixture, e))).toEqual([]);
  });

  it("the win32 path scan refuses a toNamespacedPath result consumed by anything but an fs call", () => {
    // The refusal itself, on the shape that shipped the defect: the fold
    // composes and resolves at the head that takes it, so every other verdict
    // is green over this source — the whole reason the answer needs its own
    // reader.
    const fixture = scanFsCalls("src/fixture.ts", ESCAPING_SOURCE);
    expect(fixture.bare).toEqual([]);
    expect(fixture.answered).toBe(1);
    expect(fixture.escaped.map((e) => describeEscape(fixture, e))).toEqual([
      "src/fixture.ts:7 — realpathSync() answers a path in win32's namespaced alphabet " +
        "and pathToFileURL(), which is no fs call, reads it",
    ]);

    // And the package under that same reader. The accepted shape is not
    // re-authored here: `src/cli.ts` spends its own answer at `plainPath`
    // before the comparison it derives both sides through, and is one of the
    // calls counted below.
    const scans = [...scanTree("src"), ...scanTree("harness")];
    const answered = scans.reduce((n, scan) => n + scan.answered, 0);
    expect(answered, "path-answering fs calls on a composed path").toBeGreaterThan(0);
    expectNoFindings(
      scans.flatMap((scan) =>
        scan.escaped.map((escape) => describeEscape(scan, escape)),
      ),
    );
  });

  it("the namespaced-fs scan reports a path-answering call whose answer goes to a callback rather than judging it clean", () => {
    const callback = scanFsCalls("src/fixture.ts", CALLBACK_NATIVE_SOURCE);

    // Every other verdict is green over this source — the path composes and
    // the head is the one that resolves a namespaced path — so the answer is
    // all that is left to judge, and the walk above cannot reach it: it never
    // crosses the call expression. Without a report of its own, this call is
    // an unresolved input the scan proceeds over
    // (`.claude/rules/engineering.md`, *Loud or nothing*).
    expect(callback.bare.map((call) => describeBareCall(callback, call))).toEqual([]);
    expect(callback.jsForm.map((call) => describeJsForm(callback, call))).toEqual([]);
    expect(callback.escaped.map((e) => describeEscape(callback, e))).toEqual([]);
    expect(callback.unfollowed.map((call) => describeUnfollowed(callback, call))).toEqual([
      "src/fixture.ts:7 — realpath() answers a path in win32's namespaced " +
        "alphabet into a callback, which this scan follows no further than the " +
        "call expression; where that answer is spent is unread",
    ]);
    // And the escape verdict's vacuity count does not claim it: a call that
    // verdict never judged must not read as one more call it judged clean.
    expect(callback.answered).toBe(0);

    // The route is what this turns on, not the name: the same `realpath` off
    // the promise face of `fs` answers through the expression, which the walk
    // does read — so it is counted and followed rather than reported here.
    const promised = scanFsCalls("src/fixture.ts", PROMISES_REALPATH_SOURCE);
    expect(promised.answered).toBe(1);
    expect(promised.unfollowed).toEqual([]);
  });

  it("no src/ or harness/ call answers a path into a callback, so the unfollowed report is empty by design", () => {
    // Empty is the whole verdict here, and it is spelled rather than inherited
    // from the escape verdict beside it (`.claude/rules/engineering.md`, *A
    // green verdict is proven non-vacuous*): neither tree calls an async
    // `node:fs` form today, so this report has no subject to count. The day one
    // arrives, the escape verdict silently stops covering that call and this
    // case is what says so.
    const scans = [...scanTree("src"), ...scanTree("harness")];
    // The scan reached fs importers at all — the walk, the import clause and
    // the call-site regex all still match — which is what an empty-by-design
    // verdict cannot assert for itself.
    expect(scans.filter((scan) => scan.symbols.length > 0).length).toBeGreaterThan(0);
    expectNoFindings(
      scans.flatMap((scan) =>
        scan.unfollowed.map((call) => describeUnfollowed(scan, call)),
      ),
    );
  });
});

describe("a composed path reaches only the head that takes it", () => {
  it("the namespaced-fs scan refuses a composed path handed to node's JS realpathSync", () => {
    const refused = scanFsCalls("src/fixture.ts", JS_FORM_SOURCE);

    // Every other verdict is green over this source — the path composes and
    // its answer is spent at the fold that ends the alphabet — so nothing
    // already here can see the call that throws. Only the head is wrong.
    expect(refused.bare.map((call) => describeBareCall(refused, call))).toEqual([]);
    expect(refused.escaped.map((e) => describeEscape(refused, e))).toEqual([]);
    expect(refused.nativeOnly).toBe(1);
    expect(refused.jsForm.map((call) => describeJsForm(refused, call))).toEqual([
      "src/fixture.ts:7 — realpathSync() is handed a path in win32's namespaced " +
        "alphabet, which node's JS implementation refuses through node 22; only " +
        "realpathSync.native resolves one",
    ]);

    // The head that does take one, over the same fold spent at the same
    // reader: the two sources differ in the callee alone, so the callee is
    // what this verdict turns on.
    const native = scanFsCalls("src/fixture.ts", FOLDED_SOURCE);
    expect(native.nativeOnly).toBe(1);
    expect(native.jsForm.map((call) => describeJsForm(native, call))).toEqual([]);
  });

  it("a composed path handed to the bare callback realpath is refused", () => {
    const refused = scanFsCalls("src/fixture.ts", CALLBACK_JS_FORM_SOURCE);

    // Same green everywhere else as the sync source above: the path composes,
    // and the answer goes to a callback rather than out through the call
    // expression, so the composition and escape verdicts both pass over this
    // call — the escape one by unreachability, which is the unfollowed report
    // below and not this case's subject.
    expect(refused.bare.map((call) => describeBareCall(refused, call))).toEqual([]);
    expect(refused.escaped.map((e) => describeEscape(refused, e))).toEqual([]);
    expect(refused.nativeOnly).toBe(1);
    expect(refused.jsForm.map((call) => describeJsForm(refused, call))).toEqual([
      "src/fixture.ts:7 — realpath() is handed a path in win32's namespaced " +
        "alphabet, which node's JS implementation refuses through node 22; only " +
        "realpath.native resolves one",
    ]);

    // And the head that resolves one, over a source differing in the callee
    // alone — so the callee is what this verdict turns on here too.
    const native = scanFsCalls("src/fixture.ts", CALLBACK_NATIVE_SOURCE);
    expect(native.nativeOnly).toBe(1);
    expect(native.jsForm.map((call) => describeJsForm(native, call))).toEqual([]);
  });

  it("a composed path handed to fs/promises realpath is admitted as the native binding", () => {
    const promised = scanFsCalls("src/fixture.ts", PROMISES_REALPATH_SOURCE);

    // Read at all, and read as the path-answering call it is: the refusal
    // above must not widen into the same name off the promise face of `fs`,
    // where there is no JS form to refuse and no `.native` head to ask for.
    expect(promised.uncalled).toEqual([]);
    expect(promised.judged).toBe(1);
    expect(promised.answered).toBe(1);
    expect(promised.bare.map((call) => describeBareCall(promised, call))).toEqual([]);
    expect(promised.escaped.map((e) => describeEscape(promised, e))).toEqual([]);

    // The specifier, not the name, is what carries the verdict: `realpath`
    // spelled identically off `node:fs` is the refusal above.
    expect(promised.nativeOnly).toBe(0);
    expect(promised.jsForm.map((call) => describeJsForm(promised, call))).toEqual([]);
  });

  it("no src/ or harness/ call hands a composed path to node's JS realpathSync", () => {
    // The package under the same reader. `src/cli.ts` resolves its entry
    // check through `realpathSync.native` and is the call counted here; a
    // tree that stopped reaching that call site would leave the verdict below
    // green over nothing (`.claude/rules/engineering.md`, *A green verdict is
    // proven non-vacuous*).
    const scans = [...scanTree("src"), ...scanTree("harness")];
    const nativeOnly = scans.reduce((n, scan) => n + scan.nativeOnly, 0);
    expect(nativeOnly, "composed paths at a symbol only .native resolves").toBeGreaterThan(0);
    expectNoFindings(
      scans.flatMap((scan) => scan.jsForm.map((call) => describeJsForm(scan, call))),
    );
  });
});

/**
 * A state root whose *total* path length clears win32's limit with no long
 * component — the shape the fact describes, and the shape a consumer
 * produces by nesting a job's state root under a checkout under a home
 * directory. The depth goes on the subject path alone; nothing is spawned in
 * it (`.claude/rules/platform-facts.md`, *win32 refuses to spawn a process
 * whose working directory exceeds MAX_PATH*).
 */
const MAX_PATH = 260;

let deepRoot: string | undefined;

afterEach(async () => {
  // Namespaced for the same reason the subject is: the tree being removed is
  // past the limit, and node builds each descent path off the one it is given.
  if (deepRoot) await rm(toNamespacedPath(deepRoot), { recursive: true, force: true });
  deepRoot = undefined;
});

async function deepStateRoot(): Promise<string> {
  const base = await mkTempDir("flume-deep-");
  deepRoot = base;
  let root = base;
  // Each segment is well under NAME_MAX; only the total is out of bounds,
  // which is precisely the case `toNamespacedPath` exists for.
  while (planStatePath(root).length <= MAX_PATH) {
    root = join(root, "nested-consumer-state-root");
  }
  return root;
}

const DEEP_STATE: PlanState = {
  derivedThrough: "4758d60f6de696904d8d5692107889af26bba625",
  sweptThrough: "b7972ec41f41adfeaecaf947a4cafe2b9970dee1",
  rotation: { kind: "open", covered: ["harness/planState.ts"] },
};

describe("harness plan state — a state root past win32's path limit", () => {
  it("readPlanState and writePlanState round-trip a plan state under a state root nesting past win32's ~260-char limit", async () => {
    const stateRoot = await deepStateRoot();
    expect(planStatePath(stateRoot).length).toBeGreaterThan(MAX_PATH);

    writePlanState(stateRoot, DEEP_STATE);

    expect(readPlanState(stateRoot)).toEqual(DEEP_STATE);
  });

  it("reads absent as absent at that depth, rather than reporting a read failure as no cursor", async () => {
    // The direction the defect is silent in: at this depth an unprefixed read
    // fails for the path's length, and `readPlanState`'s ENOENT arm would
    // answer `undefined` — a plan tick then re-derives the whole corpus
    // believing it never had a cursor. Nothing was written here, so
    // `undefined` is the honest answer and the arm is exercised as itself.
    const stateRoot = await deepStateRoot();

    expect(readPlanState(stateRoot)).toBeUndefined();
  });
});
