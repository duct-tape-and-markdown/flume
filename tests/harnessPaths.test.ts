/**
 * The harness package's paths as they reach disk. Every path the package
 * hands an fs call is composed under a state root, a repo root or a worktree
 * base *a consumer chose* — none of which this package bounds — so win32's
 * ~260-character total-path limit is reachable at all of them
 * (`.claude/rules/platform-facts.md`, *Windows MAX_PATH (~260 chars) breaks
 * fs calls with no long component*).
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
 * `planState.ts` is the loud one behind both: absence is a declared state
 * there, so a read that fails for a path-length reason reads back as *no
 * cursor*, and every plan window re-arms over a corpus that was already
 * derived.
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
  scanFsCalls,
} from "./helpers/namespacedFsScan.ts";

const HARNESS_DIR = fileURLToPath(new URL("../harness/", import.meta.url));

/** One module of the package, as the scan reads it. */
interface Module {
  /** Its path from the repo root, for a failure message that is clickable. */
  rel: string;
  source: string;
}

/**
 * Every `.ts` module under `harness/`, walked rather than listed: a module
 * added to the package joins this scan by existing, which is the whole
 * reason the subject is the tree and not the two files a finding named.
 */
function harnessModules(dir = HARNESS_DIR, rel = "harness"): Module[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const here = `${rel}/${entry.name}`;
    if (entry.isDirectory()) return harnessModules(join(dir, entry.name), here);
    if (!entry.name.endsWith(".ts")) return [];
    return [{ rel: here, source: readFileSync(join(dir, entry.name), "utf8") }];
  });
}

describe("harness/ — win32 MAX_PATH fix (platform-facts.md)", () => {
  const modules = harnessModules();
  const scans = modules.map((module) => ({ ...module, ...scanFsCalls(module.source) }));
  const withFs = scans.filter((scan) => scan.symbols.length > 0);

  it("the tree-wide scan reads modules, fs importers among them, and path arguments in those", () => {
    // Vacuity pins for the two cases below (`.claude/rules/engineering.md`,
    // *A green verdict is proven non-vacuous*): a walk that stopped finding
    // modules, an import clause the scan stopped matching, or a call-site
    // regex that stopped matching would each leave them green over nothing.
    expect(modules.length).toBeGreaterThan(0);
    expect(withFs.length).toBeGreaterThan(0);
    expect(withFs.reduce((n, scan) => n + scan.judged, 0)).toBeGreaterThan(0);
  });

  it("every fs call in harness/ is made on a namespacedJoin-built path", () => {
    const bare = withFs.flatMap((scan) =>
      scan.bare.map((call) => describeBareCall(call, scan.rel)),
    );
    expect(bare).toEqual([]);
  });

  it("every fs symbol harness/ imports is called, so none is imported past the scan", () => {
    const uncalled = withFs.flatMap((scan) =>
      scan.uncalled.map((fn) => `${scan.rel} imports ${fn} and never calls it`),
    );
    expect(uncalled).toEqual([]);
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
