/**
 * The fixture-rooting idiom's own suite: the temp roots every temp-repo suite
 * composes its paths from, held to the spelling git reports for them.
 *
 * A fixture root is one side of a seam — the suites below it compare
 * `join`-composed paths against paths git emitted (a worktree registry entry,
 * `rev-parse --show-toplevel`, a name-only line). Naming the root by the
 * spelling `tmpdir()` happened to carry re-authors git's vocabulary in the
 * tester's hand, and the two sides then disagree about one directory
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * Driven through a link this suite plants itself, because the defect is
 * invisible on a host whose temp dir is already canonical — `/tmp` on most
 * Linux boxes — and is exactly what the other lanes meet: macOS reaches
 * `/private/var/folders/…` as `/var/folders/…`, and the Windows runner reaches
 * `C:\Users\runneradmin\…` as the 8.3 short name `C:\Users\RUNNER~1\…`.
 *
 * Readings of the one idiom, so all live here: the cases below prove the
 * makers fold, the guard between them proves no state root appears above the
 * fixtures they make, and the scan at the foot proves nothing in `tests/`
 * makes a temp root any other way. Proving the fold alone would leave it a
 * property of whichever roots remembered to ask for it, and rooting that
 * decides which directory a fixture is about is the same decision the guard
 * holds over the run (`tests/helpers/fixtureRoot.ts`).
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { readWorktreeRegistry } from "../src/worktrees.ts";

import { makeFixture } from "./helpers/dispatcherFixture.ts";
import {
  mkFixtureRoot,
  mkTempDir,
  mkTempDirSync,
  refuseLeakedStateRoots,
  refusePreexistingStateRoots,
  watchStateRoots,
} from "./helpers/fixtureRoot.ts";
import {
  filesUnder,
  relPath,
  type Scan,
  type ScanSite,
} from "./helpers/repoProgram.ts";
import { SPAWN_BUDGET_MS, gitOut, runCli } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

describe("a temp fixture root speaks git's spelling of itself", () => {
  it("a fixture repo root is the path git reports for it, not the spelling the temp dir was named by", async () => {
    const scratch = await mkTempDir("flume-fixture-canon-");
    try {
      // The host's temp dir stands in for a canonical root; `link` is the
      // indirect spelling of it the fixture is handed. `"junction"` is
      // ignored off win32, and is what win32 creates without elevation.
      const canonical = join(scratch, "bay");
      await mkdir(canonical);
      const link = join(scratch, "link");
      await symlink(canonical, link, "junction");

      // Non-vacuity: the two spellings really differ on this host, so the
      // assertions below have something to tell apart. A host that resolved
      // the link at creation would otherwise pass them over nothing.
      expect(await realpath(link)).toBe(canonical);
      expect(link).not.toBe(canonical);

      const fx = await makeFixture(link);
      try {
        // The fixture was rooted under the indirect spelling, and still
        // reports the direct one.
        expect(dirname(fx.repo)).toBe(canonical);

        // `resolve` folds git's separator back to the host's: git prints its
        // paths forward-slashed on win32 too.
        const top = await gitOut(fx.repo, ["rev-parse", "--show-toplevel"]);
        expect(resolve(top)).toBe(fx.repo);

        // The same disagreement as the registry sees it — every worktree
        // verdict in `Dispatcher.test.ts` and `worktrees.test.ts` filters or
        // asserts membership by exact match against a path composed from
        // `fx.repo`, so a root git does not spell this way drops the primary
        // checkout out of its own registry.
        const registry = await readWorktreeRegistry(fx.repo);
        if (!registry.read) {
          throw new Error(`worktree registry unreadable: ${registry.reason}`);
        }
        expect([...registry.paths]).toContain(fx.repo);
      } finally {
        await fx.cleanup();
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("the sync maker answers the host's spelling too, through the one form that resolves an 8.3 alias", async () => {
    const scratch = await mkTempDir("flume-fixture-canon-sync-");
    try {
      const canonical = join(scratch, "bay");
      await mkdir(canonical);
      const link = join(scratch, "link");
      await symlink(canonical, link, "junction");

      // Same non-vacuity as above: two spellings that really differ here.
      expect(await realpath(link)).toBe(canonical);
      expect(link).not.toBe(canonical);

      const made = mkTempDirSync("flume-sync-root-", link);
      try {
        expect(dirname(made)).toBe(canonical);
      } finally {
        await rm(made, { recursive: true, force: true });
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

/**
 * TMP-STATE-ROOT-WRITER-NAMED — the suite's own refusal to run over, or leak,
 * a flume state root above its fixtures. A leaked `/tmp/.flume` used to be
 * invisible on the run that wrote it and to red unrelated CLI tests on every
 * run after, with nothing naming either the directory or the writer
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * Driven by the real writer: the CLI itself, run from a directory with no
 * `.flume` at or above it, which is exactly how the litter was produced —
 * `resolveRepoRoot` falls back to cwd, `stop` mkdirs the bay and writes the
 * flag, and the `Baton` constructor mkdirs `awake/`.
 */
describe("the suite refuses a flume state root above its fixtures", () => {
  it("a run that creates a state root above its own fixture fails the suite and names the offender", async () => {
    // The watch below is opened on the fixture's parent, so the attic and the
    // scope derived from it have to be one spelling of one directory — which
    // is what every root here is made through (`tests/helpers/fixtureRoot.ts`).
    const attic = await mkTempDir("flume-leak-attic-");
    try {
      const fixture = await mkFixtureRoot("flume-leak-fixture-", attic);
      const watch = watchStateRoots(dirname(fixture));

      // Non-vacuity: the watch covers the fixture's own parent, that bay is
      // not armed before the leak, and the watch is silent as it stands — so
      // the refusal below is the leak's doing, not a set already dirty.
      // Asserted on the parent's bay rather than on an empty `known`, because
      // the scope runs to the filesystem root: a host that already carries
      // litter is refused by this suite's own guard, not by this case.
      expect(watch.scope).toContain(join(attic, ".flume"));
      expect(watch.known.has(join(attic, ".flume"))).toBe(false);
      expect(() => refuseLeakedStateRoots(watch, "control")).not.toThrow();

      // The leak, written by the real CLI: `stop` plants the bay and the flag,
      // `status` builds a Baton and plants `awake/`.
      expect((await runCli(attic, ["stop"])).code).toBe(0);
      expect((await runCli(attic, ["status"])).code).toBe(0);
      expect(existsSync(join(attic, ".flume", "stop"))).toBe(true);
      expect(existsSync(join(attic, ".flume", "awake"))).toBe(true);

      const offender = "cli.test.ts > some suite > some leaking test";
      let reported = "";
      try {
        refuseLeakedStateRoots(watch, offender);
      } catch (err) {
        reported = String(err);
      }
      // Names the directory, the test it is attributed to, and the bound on
      // that attribution — vitest runs files in parallel, so the flag that
      // removes the ambiguity is part of the report.
      expect(reported).toContain(join(attic, ".flume"));
      expect(reported).toContain(offender);
      expect(reported).toContain("--no-file-parallelism");

      // A second look does not re-report what it already named: one leak
      // names one offender rather than reddening every test after it.
      expect(() => refuseLeakedStateRoots(watch, "a later test")).not.toThrow();

      // The fixture below the litter is unharmed — its own bay stops the walk,
      // so the guard is reporting a hazard to unrooted fixtures, not a break.
      const rooted = await runCli(fixture, ["status"]);
      expect(rooted.code).toBe(0);
      expect(rooted.out).not.toContain("stop present");
    } finally {
      await rm(attic, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it("refuses before its first test when the litter is already on disk", async () => {
    const attic = await mkTempDir("flume-leak-preexisting-");
    try {
      // Control: the parent's own bay is not armed yet, so the refusal below
      // is the litter's doing.
      const clean = watchStateRoots(attic);
      expect(clean.scope).toContain(join(attic, ".flume"));
      expect(clean.known.has(join(attic, ".flume"))).toBe(false);

      await mkdir(join(attic, ".flume", "awake"), { recursive: true });
      const watch = watchStateRoots(attic);
      expect(watch.known.has(join(attic, ".flume"))).toBe(true);
      expect(() => refusePreexistingStateRoots(watch)).toThrow(
        join(attic, ".flume"),
      );
      expect(() => refusePreexistingStateRoots(watch)).toThrow(/rm -rf/);
    } finally {
      await rm(attic, { recursive: true, force: true });
    }
  });

  it("is armed by vitest.config, in both lanes, at the host temp dir", async () => {
    const repoRoot = fileURLToPath(new URL("..", import.meta.url));
    const exported = (await import("../vitest.config.ts")).default;
    expect(typeof exported).toBe("function");
    const asFn = exported as (env: {
      command: "serve";
      mode: string;
    }) => Promise<{ test?: { setupFiles?: string | string[] } }>;

    for (const mode of ["test", "integration"]) {
      const config = await asFn({ command: "serve", mode });
      const declared = config.test?.setupFiles ?? [];
      const entries = typeof declared === "string" ? [declared] : declared;
      expect(entries.length).toBeGreaterThan(0);

      // Agreement, not restatement: whatever the config names is imported and
      // asked what it armed. A setup file that exists but installs nothing
      // fails here.
      const armed = await Promise.all(
        entries.map(
          (entry) =>
            import(resolve(repoRoot, entry)) as Promise<{
              ARMED_STATE_ROOT_WATCH?: { scope: readonly string[] };
            }>,
        ),
      );
      const scopes = armed.flatMap(
        (m) => m.ARMED_STATE_ROOT_WATCH?.scope ?? [],
      );
      expect(scopes).toContain(join(tmpdir(), ".flume"));
    }
  });
});

// ---------- the idiom's adoption, read off the tree ----------

/**
 * Node's own temp-directory makers, by the name a site spells. A root made at
 * one of these carries whatever spelling `tmpdir()` was configured with, which
 * is the spelling git will not answer in.
 */
const BARE_MAKERS: readonly string[] = ["mkdtemp", "mkdtempSync"];

/** The makers that fold at creation (`tests/helpers/fixtureRoot.ts`). */
const FOLDING_MAKERS: readonly string[] = [
  "mkTempDir",
  "mkTempDirSync",
  "mkFixtureRoot",
];

const MAKERS: readonly string[] = [...BARE_MAKERS, ...FOLDING_MAKERS];

/**
 * The one module that may reach node's makers — where the fold is spent, so
 * asking it to go through itself is asking it to delegate to its own body.
 *
 * Spelled, never discovered: an exemption read off a marker at the site is an
 * exemption any site can write itself.
 */
const THE_FOLD = "helpers/fixtureRoot.ts";

/** One place a temp-root maker is named, and which one it is. */
interface MakerSite extends ScanSite {
  /** The maker the site spells. */
  readonly maker: string;
  /** Where the name appears — the call itself, or the import binding it. */
  readonly via: "call" | "import";
}

/**
 * Every temp-root maker one module names, and the subset reaching node's own.
 *
 * Off the parse, never the text: `mkdtemp` is a word this suite also writes in
 * prose and in fixture sources it hands to other scans, and only the parser
 * tells a call from a mention. Scopeless (`ts.createSourceFile`) because
 * nothing here needs a type — a name is the subject.
 *
 * Both a call and an import specifier count, so the verdict survives the
 * rename that would slip past a callee check alone: `mkdtemp as mkTemp` is
 * read at the binding that brings it in.
 */
function scanMakers(module: string, source: string): Scan<MakerSite> {
  const sf = ts.createSourceFile(module, source, ts.ScriptTarget.Latest, true);
  const scanned: MakerSite[] = [];
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const walk = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node)) {
      const name = (node.propertyName ?? node.name).text;
      if (MAKERS.includes(name))
        scanned.push({ module, line: lineOf(node), maker: name, via: "import" });
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (name !== undefined && MAKERS.includes(name))
        scanned.push({ module, line: lineOf(node), maker: name, via: "call" });
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);

  return {
    scanned,
    findings: scanned.filter((site) => BARE_MAKERS.includes(site.maker)),
  };
}

const TESTS_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Every module under `tests/`, scanned — the paths posix whatever the host spells. */
const corpus = filesUnder({ root: TESTS_DIR, suffix: ".ts" })
  .map((path) => relPath(TESTS_DIR, path))
  .sort()
  .map((rel) => scanMakers(rel, readFileSync(join(TESTS_DIR, rel), "utf8")));

const madeHere = corpus.flatMap((scan) => scan.scanned);
const bareHere = corpus
  .flatMap((scan) => scan.findings)
  .filter((site) => site.module !== THE_FOLD);

const describeSite = (site: MakerSite): string =>
  `${site.module}:${site.line} — ${site.maker} (${site.via})`;

it("every temp fixture root in tests/ is created through the helper that folds it to git's spelling", () => {
  // Vacuity pin (`.claude/rules/engineering.md`, *A green verdict is proven
  // non-vacuous*): this verdict is empty-by-design once the tree is clean, so
  // a corpus that read nothing — a non-recursive walk, a wrong directory, a
  // parse that threw the file away — would read exactly like adoption. Pinned
  // on the subject: roots are what the scan judges, and there are many.
  expect(
    madeHere.filter((site) => site.via === "call").length,
    "no temp root was found in tests/ — the scan is off target",
  ).toBeGreaterThan(0);

  expect(
    bareHere.map(describeSite),
    `a temp root made outside \`${THE_FOLD}\`: take it through ` +
      "`mkTempDir`/`mkTempDirSync` instead, which fold the root to the " +
      "spelling git reports before anything composes a path from it",
  ).toEqual([]);
});

it("the temp-root scan reads every module under tests/, the helpers subdirectory included", () => {
  const named = madeHere.map((site) => site.module);
  expect(
    named,
    "the fold's own module went unread — it is the one exemption, so a walk " +
      "that misses it is a walk that would miss the sites it exempts too",
  ).toContain(THE_FOLD);
  expect(
    named,
    "the deepest temp-repo suite named no maker — the walk is off target",
  ).toContain("Dispatcher.test.ts");
});

/**
 * The needle's own two directions, driven over sources written to be caught
 * and to be passed. Held as text rather than on disk: a fixture file under
 * `tests/` would be a site of the very shape this scan refuses.
 */
const BARE_SOURCE = [
  'import { mkdtemp } from "node:fs/promises";',
  'import { tmpdir } from "node:os";',
  'import { join } from "node:path";',
  "",
  'export const root = () => mkdtemp(join(tmpdir(), "fixture-"));',
].join("\n");

const ALIASED_SOURCE = [
  'import { mkdtempSync as mkTemp } from "node:fs";',
  'import { tmpdir } from "node:os";',
  'import { join } from "node:path";',
  "",
  'export const root = () => mkTemp(join(tmpdir(), "fixture-"));',
].join("\n");

const FOLDED_SOURCE = [
  'import { mkTempDir } from "./helpers/fixtureRoot.ts";',
  "",
  'export const root = () => mkTempDir("fixture-");',
  "// a comment naming mkdtemp(join(tmpdir(), \"x\")) is prose, not a root",
].join("\n");

it("the temp-root scan flags a bare maker, flags it through a rename, and passes a folded one", () => {
  const bare = scanMakers("suite.test.ts", BARE_SOURCE);
  expect(bare.findings.map(describeSite)).toEqual([
    "suite.test.ts:1 — mkdtemp (import)",
    "suite.test.ts:5 — mkdtemp (call)",
  ]);

  // The binding is what carries it: the call spells a name node never
  // exported, so a callee-only reader would report this source clean.
  const aliased = scanMakers("suite.test.ts", ALIASED_SOURCE);
  expect(aliased.findings.map(describeSite)).toEqual([
    "suite.test.ts:1 — mkdtempSync (import)",
  ]);

  const folded = scanMakers("suite.test.ts", FOLDED_SOURCE);
  expect(folded.findings).toEqual([]);
  // ...and still judged something, so the clean verdict is not an empty read.
  expect(folded.scanned.map(describeSite)).toEqual([
    "suite.test.ts:1 — mkTempDir (import)",
    "suite.test.ts:3 — mkTempDir (call)",
  ]);
});
