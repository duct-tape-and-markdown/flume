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
 * `harness/planState.ts` is the loud one behind both: absence is a declared
 * state there, so a read that fails for a path-length reason reads back as
 * *no cursor*, and every plan window re-arms over a corpus that was already
 * derived.
 *
 * The scan's own reading of a call is pinned here too, because the two trees
 * are judged through it: an argument it mistakes for a path (a probe's
 * subject label) reds a correct site, and one it skips (a variadic descent)
 * leaves a real one unread.
 */

import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, toNamespacedPath } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  planStatePath,
  readPlanState,
  writePlanState,
  type PlanState,
} from "../harness/index.ts";

import {
  describeBareCall,
  describeEscape,
  scanFsCalls,
  type FsCallScan,
} from "./helpers/namespacedFsScan.ts";

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
    const bare = withFs.flatMap((scan) =>
      scan.bare.map((call) => describeBareCall(scan, call)),
    );
    expect(bare).toEqual([]);
  });

  it(titles.uncalled, () => {
    populated();
    const uncalled = withFs.flatMap((scan) =>
      scan.uncalled.map((fn) => `${scan.module} imports ${fn} and never calls it`),
    );
    expect(uncalled).toEqual([]);
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

describe("the scan's reading of one call", () => {
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
 * The shape `src/cli.ts` carried until the windows lane read it: a fold spent
 * at `realpathSync`, whose answer was handed straight to `pathToFileURL`. On
 * win32 that answer is `\\?\C:\…`, which the URL builder reads as a UNC
 * host, so the entry check answered "not the entry" for every junction- or
 * symlink-based install (pnpm's linked store) and `flume` ran nothing. The
 * behavior cannot red off win32 — `toNamespacedPath` is identity elsewhere —
 * so the expression the answer is written into is where the defect is
 * decidable, and this is the reader that decides it.
 */
const ESCAPING_SOURCE = `
import { realpathSync } from "node:fs";
import { toNamespacedPath } from "node:path";
import { pathToFileURL } from "node:url";

export function entryUrl(argv1: string): string {
  return pathToFileURL(realpathSync(toNamespacedPath(argv1))).href;
}
`;

describe("a namespaced path never leaves its fs call", () => {
  it("the win32 path scan refuses a toNamespacedPath result consumed by anything but an fs call", () => {
    // The refusal itself, on the shape that shipped it: the fold composes, so
    // the composition verdict above is green over this source — the whole
    // reason the answer needs its own reader.
    const fixture = scanFsCalls("src/fixture.ts", ESCAPING_SOURCE);
    expect(fixture.bare).toEqual([]);
    expect(fixture.answered).toBe(1);
    expect(fixture.escaped.map((e) => describeEscape(fixture, e))).toEqual([
      "src/fixture.ts:7 — realpathSync() answers a path in win32's namespaced alphabet " +
        "and pathToFileURL(), which is no fs call, reads it",
    ]);

    // And the package under that same reader. The accepted shape is not
    // re-authored here: `src/cli.ts` spends its own answer at the comparison
    // it derives both sides through, and is one of the calls counted below.
    const scans = [...scanTree("src"), ...scanTree("harness")];
    const answered = scans.reduce((n, scan) => n + scan.answered, 0);
    expect(answered, "path-answering fs calls on a composed path").toBeGreaterThan(0);
    expect(
      scans.flatMap((scan) =>
        scan.escaped.map((escape) => describeEscape(scan, escape)),
      ),
    ).toEqual([]);
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
  const base = await mkdtemp(join(tmpdir(), "flume-deep-"));
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
