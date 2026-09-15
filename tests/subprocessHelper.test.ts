/**
 * SUBPROCESS-TSX-SENTINEL — the shared CLI-subprocess harness's own suite.
 * Every other CLI suite *consumes* `tests/helpers/subprocess.ts`; this one
 * tests it, because the helper is where a CLI that never started used to
 * become an ordinary exit code 1 (`.claude/rules/engineering.md`, "A green
 * verdict is proven non-vacuous").
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLI,
  SPAWN_BUDGET_MS,
  TSX_CLI,
  exitStatusOf,
  mkFixtureRoot,
  mkTempDir,
  pinGitAutoGcOff,
  refuseLeakedStateRoots,
  refusePreexistingStateRoots,
  requireEntryPoint,
  runCli,
  watchStateRoots,
} from "./helpers/subprocess.ts";
import { filesUnder, relPath } from "./helpers/repoProgram.ts";
import {
  LANES,
  type Lane,
  type SpawnScan,
  declaredLaneGlobs,
  harnessBudgets,
  harnessSpawnExports,
  laneMode,
  reduceLaneGlobs,
  scanSpawnSites,
} from "./helpers/spawnBudget.ts";

const exec = promisify(execFile);

describe("requireEntryPoint — an unresolvable CLI entry point refuses (SUBPROCESS-TSX-SENTINEL)", () => {
  it("refuses by name instead of returning an exit code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-entry-point-"));
    try {
      const missing = join(dir, "node_modules", "tsx", "dist", "cli.mjs");
      expect(existsSync(missing)).toBe(false);

      // The status the refusal replaces: node exits 1 on a module it cannot
      // load, so the laundered value collided exactly with the 1 that the CLI
      // suites' `code).toBe(1)` assertions are written to check.
      const spawned = await exec(process.execPath, [missing]).then(
        () => ({ code: 0 }),
        (err: { code?: unknown }) => ({ code: err.code }),
      );
      expect(spawned.code).toBe(1);

      expect(() =>
        requireEntryPoint(missing, "run `pnpm install --frozen-lockfile`"),
      ).toThrow(missing);
      expect(() =>
        requireEntryPoint(missing, "run `pnpm install --frozen-lockfile`"),
      ).toThrow(/pnpm install --frozen-lockfile/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it("passes the real entry points through, so the refusal is not armed on a provisioned tree", () => {
    for (const path of [CLI, TSX_CLI]) {
      expect(isAbsolute(path)).toBe(true);
      expect(existsSync(path)).toBe(true);
      expect(requireEntryPoint(path, "unreachable on a provisioned tree")).toBe(
        path,
      );
    }
  });
});

describe("the helper's tsx entry point is guarded, not merely guardable", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("refuses at import when node_modules/tsx/dist/cli.mjs is absent", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        default: actual,
        existsSync: (p: Parameters<typeof actual.existsSync>[0]) =>
          p === TSX_CLI ? false : actual.existsSync(p),
      };
    });

    await expect(import("./helpers/subprocess.ts")).rejects.toThrow(
      /CLI entry point missing: .*tsx.*\n.*pnpm install --frozen-lockfile/s,
    );
  });
});

describe("exitStatusOf — a failure with no exit status refuses instead of reporting 1", () => {
  it("passes a real non-zero exit through", () => {
    expect(exitStatusOf({ code: 2, signal: null })).toBe(2);
    expect(exitStatusOf({ code: 1, signal: null })).toBe(1);
    expect(exitStatusOf({ code: 78, signal: null })).toBe(78);
  });

  it("refuses on a spawn failure, whose code is an errno string", () => {
    const err = Object.assign(new Error("spawn ENOENT"), {
      code: "ENOENT",
      signal: null,
    });
    expect(() => exitStatusOf(err)).toThrow(/no exit status/);
    expect(() => exitStatusOf(err)).toThrow(/ENOENT/);
  });

  it("refuses on a kill, which carries a signal and no code", () => {
    const err = Object.assign(new Error("killed"), {
      code: undefined,
      signal: "SIGKILL",
    });
    expect(() => exitStatusOf(err)).toThrow(/no exit status/);
    expect(() => exitStatusOf(err)).toThrow(/SIGKILL/);
  });
});

describe("runCli — reports the CLI's own status, not a default", () => {
  it("surfaces an exit code the CLI chose, distinct from the laundered 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-runcli-status-"));
    try {
      const { out, code } = await runCli(dir, ["definitely-not-a-verb"]);
      expect(out).toContain("unknown command: definitely-not-a-verb");
      expect(code).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
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
    // Canonical, because the watch below is opened on the fixture's parent —
    // `mkFixtureRoot` folds the spelling, so a raw `mkdtemp` attic and the
    // scope derived from it would name one directory two ways.
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
    const attic = await mkdtemp(join(tmpdir(), "flume-leak-preexisting-"));
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

/**
 * TESTS-EXIT-STATUS-VIA-HELPER — the fence that keeps `exitStatusOf` the
 * only reader of a spawned child's exit status in `tests/`
 * (`.claude/rules/engineering.md`, "The fix lands at the mechanism":
 * detection a sibling surface already performs is shared, never re-derived
 * beside it).
 *
 * Four suites used to hand-roll the extraction — each typing `e.code` as a
 * `number` it is not (a spawn failure carries an errno *string*, a kill
 * carries none) and then defaulting the miss to 1, into assertions checking
 * for 0, 2, 69 and 78. A copy of a refusal that does not refuse reads as the
 * mechanism while being its opposite, so the check is on the shape rather
 * than on any one site.
 *
 * The needles are matched line by line against `tests/**` on disk, so a new
 * suite is in scope the moment it exists. The fixtures below are assembled
 * through `${"code"}` for exactly that reason: spelled out, this file's own
 * text would be a site.
 */
describe("tests/ reads a child's exit status through one mechanism (TESTS-EXIT-STATUS-VIA-HELPER)", () => {
  const TESTS_DIR = fileURLToPath(new URL(".", import.meta.url));

  /** A line the needles must flag, spelled so this file is not itself a site. */
  const handRolled = {
    nullish: `return { out, code: e.${"code"} ?? 1 };`,
    or: `return { out, code: e.${"code"} || 1 };`,
    typedNumber: `const e = err as { stdout?: string; ${"code"}?: number };`,
    narrowing: `if (typeof e.${"code"} === "number") return e.code;`,
  };

  /**
   * Each re-derivation of the mechanism, with the sites allowed to carry it.
   * The narrowing has exactly one home; the other two shapes have none —
   * they are the bug, not the mechanism.
   */
  const RE_DERIVED = [
    {
      what: "a fallback default on a spawned child's exit `code`",
      pattern: /\bcode\s*(?:\?\?|\|\|)\s*\d/,
      instead: "`exitStatusOf(err)`, which refuses instead of defaulting",
      allowed: {} as Record<string, string>,
    },
    {
      what: "an error cast typing `code` as `number`",
      pattern: /\bas\s*\{[^}\n]*\bcode\?\s*:\s*number/,
      instead:
        "`runNodeStreams`/`runCliStreams`, which own the cast and read the " +
        "status through `exitStatusOf`",
      allowed: {} as Record<string, string>,
    },
    {
      what: "a hand-rolled narrowing of a child's `code` to a number",
      pattern: /typeof\s+\w+\.code\s*===\s*["']number["']/,
      instead: "`exitStatusOf(err)`",
      allowed: {
        "helpers/subprocess.ts":
          "exitStatusOf — the mechanism itself, where the narrowing lives",
      } as Record<string, string>,
    },
  ] as const;

  // Through the shared corpus walk (`tests/helpers/repoProgram.ts`), so the
  // paths below are posix whatever the host spells, and the `allowed` keys
  // are one alphabet rather than the walk's.
  const corpus = filesUnder({ root: TESTS_DIR, suffix: ".ts" })
    .map((path) => relPath(TESTS_DIR, path))
    .sort()
    .map((rel) => ({
      path: rel,
      lines: readFileSync(join(TESTS_DIR, rel), "utf8").split("\n"),
    }));

  /** `path:line` for every line the needle flags, minus the declared homes. */
  function sitesOf(
    pattern: RegExp,
    allowed: Record<string, string>,
  ): string[] {
    return corpus
      .filter((f) => !(f.path in allowed))
      .flatMap((f) =>
        f.lines.flatMap((line, i) =>
          pattern.test(line) ? [`${f.path}:${i + 1}`] : [],
        ),
      );
  }

  // Vacuity pin (.claude/rules/engineering.md, "A green verdict is proven
  // non-vacuous"): the refusals below pass over an empty set once every site is
  // fixed, so a corpus that walked nothing — a non-recursive read, a wrong
  // directory, a filter that keeps no file — would read exactly like a clean
  // tree. Pinned on the subject rather than the count: the files that spawn a
  // child are the only ones that can hold the defect at all.
  it("scans a populated tests/ corpus, recursively, including the suites that spawn a child", () => {
    expect(corpus.length).toBeGreaterThan(0);
    expect(corpus.map((f) => f.path)).toContain("helpers/subprocess.ts");
    const spawners = corpus
      .filter((f) => f.lines.some((line) => line.includes("execFile")))
      .map((f) => f.path);
    expect(
      spawners,
      "no scanned file spawns a subprocess — the corpus is off target",
    ).not.toEqual([]);
  });

  it("no suite outside the subprocess helper defaults a missing exit status to 1", () => {
    for (const { what, pattern, instead, allowed } of RE_DERIVED) {
      expect(
        sitesOf(pattern, allowed),
        `${what}: read the status through ${instead} — a hand-rolled ` +
          "extraction reports a status no process returned",
      ).toEqual([]);
    }
  });

  // Sensitivity pin (same section): all three refusals above are green over
  // an empty set by design now, so a needle that stopped matching anything
  // would be indistinguishable from a clean tree. Drive both directions —
  // each shape as the four suites actually wrote it, and the mechanism's own
  // lines, which must stay unflagged while still being code about `code`.
  it("the exit-status needles flag the hand-rolled shapes and not the mechanism", () => {
    const [nullish, typedNumber, narrowing] = RE_DERIVED;
    for (const [needle, flagged] of [
      [nullish, [handRolled.nullish, handRolled.or]],
      [typedNumber, [handRolled.typedNumber]],
      [narrowing, [handRolled.narrowing]],
    ] as const) {
      for (const line of flagged) {
        expect(needle.pattern.test(line), `needle missed: ${line}`).toBe(true);
      }
    }
    for (const [needle, clean] of [
      [nullish, "  return { stdout: e.stdout ?? \"\", code: exitStatusOf(err) };"],
      [nullish, "  maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,"],
      [nullish, "  if ((err as { code?: unknown }).code !== 1) throw err;"],
      [typedNumber, "  const e = err as { code?: unknown; signal?: unknown };"],
      [typedNumber, "  expect(exitStatusOf({ code: 2, signal: null })).toBe(2);"],
      [narrowing, "  const { code } = await runCli(dir, [\"status\"]);"],
    ] as const) {
      expect(
        needle.pattern.test(clean),
        `needle over-fires on: ${clean}`,
      ).toBe(false);
    }
  });
});

// ---------- the lane's declared spawn budget
// (spec/worktrees.md, "The default test lane must stay fast") ----------

/**
 * The lane's spawning sites against the budget they are supposed to declare.
 *
 * The flake this pins is asymmetric: a spawning case that inherits vitest's
 * 5s default passes alone and reds under the afterMerge gate's full-suite
 * contention, where the cost is an innocent entry reverted. So the property
 * is checked where it is decidable — on what each site *declares* — rather
 * than by timing a run that would have to go bad to report anything.
 *
 * Both halves of the acceptance ride here: every spawning site names a
 * budget, and every one of them names the *same* constant, so the lane's
 * number has one home to move (`.claude/rules/engineering.md`, *Derived
 * state is computed, never restated beside its source*).
 */
it("every default-lane suite that spawns the CLI declares the shared spawn budget rather than inheriting the runner's default", async () => {
  // One home. `harnessBudgets` reads the harness module's exported numbers
  // off the module itself, so this is the parse and the import agreeing on
  // the same constant rather than the test restating either.
  const budgets = harnessBudgets();
  expect(budgets.size).toBe(1);
  expect([...budgets.values()]).toEqual([SPAWN_BUDGET_MS]);

  // Vacuity: the wrappers were discovered and the lane was read. A scan that
  // found no spawn wrapper, or no suite, would clear every assertion below
  // without judging anything.
  expect(harnessSpawnExports().length).toBeGreaterThan(0);
  const scan = await scanSpawnSites({ lane: "default" });
  expect(scan.scanned.length).toBeGreaterThan(0);
  expect(new Set(scan.scanned.map((s) => s.module)).size).toBeGreaterThan(1);

  const inheriting = scan.findings.map(
    (s) => `${s.module}:${s.line} ${s.kind} — ${s.title}`,
  );
  expect(
    inheriting,
    `these sites start a process — \`process.execPath\`, a launcher like ` +
      `\`node\`/\`npm\`/\`pnpm\`, or \`renderPrompt\`, whose inline-exec spans ` +
      `each start an \`sh\` — on vitest's 5s default: declare ` +
      `SPAWN_BUDGET_MS (tests/helpers/subprocess.ts) on each, rather than a ` +
      `number of its own`,
  ).toEqual([]);
});

/**
 * The lane the scan walks against the lane the runner is told to run.
 *
 * Both used to be spelled here — a root and two suffixes in the helper, the
 * globs in `vitest.config.ts` — so a config-side widening (another suffix,
 * another root, an exclude the walk does not implement) left the scan green
 * over sites it had silently stopped reading.
 *
 * Config-first, like the setup-file pin above: the real config function is
 * called and its own globs go through the scan's own reducer, which refuses
 * anything the walk cannot implement (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*).
 */
it("the spawn-budget scan's lane rule agrees with the default lane vitest.config.ts declares", async () => {
  const declared = await declaredLaneGlobs("default");

  // Vacuity: the config was reached and it declared a selection at all, so
  // the reduction below is judging globs rather than two empty lists.
  expect(declared.include.length).toBeGreaterThan(0);
  expect(declared.exclude.length).toBeGreaterThan(0);

  // Agreement: reaching a rule at all is the claim — the reducer refuses any
  // declared glob the walk cannot implement, so a lane the scan would read
  // only part of cannot reduce quietly to the part it understands.
  const rule = reduceLaneGlobs(declared);
  const files = filesUnder(rule);

  expect(files).toContain(fileURLToPath(import.meta.url));
  expect(new Set(files).size).toBeGreaterThan(1);
  expect(files.every((f) => f.endsWith(rule.suffix))).toBe(true);
  expect(files.some((f) => rule.excluded.some((x) => f.endsWith(x)))).toBe(
    false,
  );

  // Non-vacuity on the exclusion: the excluded lane is on disk, so the
  // absence above is the rule doing work rather than a tree with nothing to
  // drop.
  expect(
    readdirSync(rule.root).filter((name) =>
      rule.excluded.some((x) => name.endsWith(x)),
    ),
  ).not.toEqual([]);

  // Refusal, on hand-authored input as a refusal case must be: a lane
  // declared in a shape this walk does not implement reds here instead of
  // narrowing what the scan reads.
  expect(() =>
    reduceLaneGlobs({
      lane: "default",
      include: ["tests/**/*.{test,spec}.ts"],
      exclude: [],
    }),
  ).toThrow("<root>/**/*<suffix>");
  expect(() =>
    reduceLaneGlobs({
      lane: "default",
      include: [...declared.include, "packages/**/*.test.ts"],
      exclude: [],
    }),
  ).toThrow("walks one root");
  expect(() =>
    reduceLaneGlobs({
      lane: "default",
      include: declared.include,
      exclude: ["**/fixtures/**"],
    }),
  ).toThrow("drops files by suffix");
});

/**
 * The other spelling of the same startup: a command *name*.
 *
 * `process.execPath` was the scan's whole node vocabulary, so a case handing
 * `"node"` to a gate, or shelling out to `npm`, read as spawning nothing and
 * kept vitest's 5s default — the exact inheritance this scan exists to
 * report. Both spellings pay one Node startup, so both are reported.
 *
 * The negative half is the lane boundary itself: `git` plumbing is measured
 * fast and is explicitly *not* a trigger (spec/worktrees.md, "The default
 * test lane must stay fast"), so a vocabulary wide enough to catch it would
 * be reporting most of the dispatcher's suite.
 *
 * Top-level rather than inside the describe below: the fixture it drives is
 * its own, and the two shapes it separates are the ones the widening turns
 * on.
 */
it("the spawn-budget scan reports a case that starts node under a command-string name", async () => {
  const FIXTURE = [
    `import { SPAWN_BUDGET_MS } from "../helpers/subprocess.ts";`,
    ``,
    `it("hands a bare node to a gate", async () => {`,
    `  await shellGate({ name: "n", when: "afterCommit", cmd: "node" }).run(ctx());`,
    `});`,
    ``,
    `it("shells out to npm", async () => {`,
    `  await exec("npm", ["pack", "--dry-run"], { cwd: dir });`,
    `}, SPAWN_BUDGET_MS);`,
    ``,
    `it("runs git plumbing on a temp fixture", async () => {`,
    `  await exec("git", ["rev-parse", "HEAD"], { cwd: dir });`,
    `});`,
    ``,
    `it("spawns nothing at all", () => {`,
    `  expect(1).toBe(1);`,
    `});`,
    ``,
  ].join("\n");

  const dir = await mkdtemp(join(tmpdir(), "flume-budget-command-"));
  try {
    await writeFile(join(dir, "fixture.test.ts"), FIXTURE, "utf8");
    const { scanned: sites } = await scanSpawnSites({ lane: "default", dir });

    // The whole list, so the two shapes the scan must *not* report — git
    // plumbing and a case that spawns nothing — are pinned by their absence
    // rather than by a filter that could quietly match nothing.
    expect(sites.map((s) => [s.title, s.budget])).toEqual([
      ["hands a bare node to a gate", null],
      ["shells out to npm", "SPAWN_BUDGET_MS"],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * The startup no launcher name spells: the engine's own renderer.
 *
 * `renderPrompt` runs each of a template's inline-exec spans through a fresh
 * `sh`, so a case whose subject is a shipped template's spans pays a process
 * per span. `sh` is no node launcher, and the propagation never follows an
 * import, so neither half of the node vocabulary could reach it: a
 * span-rendering case read as spawning nothing and kept vitest's 5s default,
 * which is what timed one out under the afterMerge gate's full-suite
 * contention and reverted an innocent entry.
 *
 * The negative half is a case that names the engine's render error without
 * rendering: a file that merely *imports* from the same module pays no
 * startup, so the report is the call reaching the entry rather than the
 * module being in scope.
 */
it("the spawn scan reports a case that renders inline-exec spans without a declared budget", async () => {
  const FIXTURE = [
    `import { InlineExecRenderError, renderPrompt } from "../../src/Prompt.ts";`,
    `import { SPAWN_BUDGET_MS } from "../helpers/subprocess.ts";`,
    ``,
    `const render = (file: string) =>`,
    `  renderPrompt({ phase, promptFile: file, cwd, flumeDir: root, args });`,
    ``,
    `it("renders a template's spans", async () => {`,
    `  expect(await renderPrompt({ phase, promptFile, cwd, flumeDir: root, args })).toContain("x");`,
    `});`,
    ``,
    `it("renders through a file-local wrapper", async () => {`,
    `  expect(await render("plan.md")).toContain("x");`,
    `});`,
    ``,
    `it("declares the budget over a render", async () => {`,
    `  expect(await render("build.md")).toContain("x");`,
    `}, SPAWN_BUDGET_MS);`,
    ``,
    `it("names the render error without rendering", () => {`,
    `  expect(new InlineExecRenderError([]).failures).toEqual([]);`,
    `});`,
    ``,
  ].join("\n");

  const dir = await mkdtemp(join(tmpdir(), "flume-budget-render-"));
  try {
    await writeFile(join(dir, "fixture.test.ts"), FIXTURE, "utf8");
    const { scanned: sites } = await scanSpawnSites({ lane: "default", dir });

    // The whole list: the two inheriting shapes are reported, the declaring
    // one is reported as declaring, and the case that only names the module
    // is absent — so the widening is the render entry's doing rather than a
    // scan that started reporting every case in the file.
    expect(sites.map((s) => [s.title, s.budget])).toEqual([
      ["renders a template's spans", null],
      ["renders through a file-local wrapper", null],
      ["declares the budget over a render", "SPAWN_BUDGET_MS"],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * A name declared twice in one file, which is ordinary: two `describe`s, each
 * with its own `boot`.
 *
 * The scan has no scopes, and the reach map used to keep one node per name, so
 * the *last* declaration walked decided reach for the whole file — an innocent
 * sibling silently un-flagged a case that boots node through a file-local
 * wrapper, and the suite read as a lane in order. That is under-approximation,
 * which is the one direction this scan must not take
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * The widening's cost is priced in the fixture below, not hidden from it: the
 * innocent half's case is reported too, because a name that reaches a spawn
 * anywhere is treated as reaching everywhere. One unneeded declared ceiling is
 * the trade this scan takes against one missed flake.
 */
it("a same-named function elsewhere in the file does not hide a spawning case from the scan", async () => {
  const FIXTURE = [
    `import { SPAWN_BUDGET_MS } from "../helpers/subprocess.ts";`,
    ``,
    `describe("the half that wraps a spawn", () => {`,
    `  const boot = (args: string[]) => exec(process.execPath, args);`,
    ``,
    `  it("boots the CLI through a file-local wrapper", async () => {`,
    `    await boot(["--version"]);`,
    `  });`,
    `});`,
    ``,
    `describe("the half that reuses the name", () => {`,
    `  const boot = (n: number) => n + 1;`,
    ``,
    `  it("reuses the name for arithmetic", () => {`,
    `    expect(boot(1)).toBe(2);`,
    `  });`,
    `});`,
    ``,
    `it("shares no name with either half", () => {`,
    `  expect(1).toBe(1);`,
    `});`,
    ``,
  ].join("\n");

  const dir = await mkdtemp(join(tmpdir(), "flume-budget-shadowed-"));
  try {
    await writeFile(join(dir, "fixture.test.ts"), FIXTURE, "utf8");
    const { scanned: sites } = await scanSpawnSites({ lane: "default", dir });

    // The whole list: the spawning case is back, and the case sharing neither
    // name is still absent — so the widening is the shadowed declaration's
    // doing rather than a scan that started reporting every case it reads.
    expect(sites.map((s) => [s.title, s.budget])).toEqual([
      ["boots the CLI through a file-local wrapper", null],
      ["reuses the name for arithmetic", null],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * The scan's own sensitivity, driven over a fixture written to be caught:
 * the assertion above is green over an empty set by design, so a detector
 * that stopped firing would be indistinguishable from a lane in order
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*).
 */
describe("the default-lane spawn-budget scan", () => {
  const FIXTURE = [
    `import { runCli, SPAWN_BUDGET_MS } from "../helpers/subprocess.ts";`,
    ``,
    `const viaWrapper = (dir: string) => runCli(dir, ["status"]);`,
    ``,
    `beforeAll(async () => { await runCli("/tmp", ["status"]); });`,
    ``,
    `it("declares the budget", async () => {`,
    `  await runCli("/tmp", ["status"]);`,
    `}, SPAWN_BUDGET_MS);`,
    ``,
    `it("inherits the runner's default", async () => {`,
    `  await runCli("/tmp", ["status"]);`,
    `});`,
    ``,
    `it("restates a number of its own", async () => {`,
    `  await runCli("/tmp", ["status"]);`,
    `}, 30_000);`,
    ``,
    `it("reaches the spawn through a local wrapper", async () => {`,
    `  await viaWrapper("/tmp");`,
    `});`,
    ``,
    `it("spawns node without the harness", async () => {`,
    `  await new Promise((r) => r(process.execPath));`,
    `});`,
    ``,
    `it("spawns nothing at all", () => {`,
    `  expect(1).toBe(1);`,
    `});`,
    ``,
  ].join("\n");

  it("flags every shape that inherits the default, and clears only the site that names the budget", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-budget-scan-"));
    try {
      await writeFile(join(dir, "fixture.test.ts"), FIXTURE, "utf8");
      const { scanned: sites } = await scanSpawnSites({ lane: "default", dir });

      // A spawning hook inherits `hookTimeout`, which is lower still than
      // the case default — the same defect one registrar over.
      const hooks = sites.filter((s) => s.kind === "hook");
      expect(hooks.map((s) => s.budget)).toEqual([null]);
      expect(hooks[0]?.title).toMatch(/^beforeAll at .*fixture\.test\.ts:5$/);

      expect(
        sites.filter((s) => s.kind === "case").map((s) => [s.title, s.budget]),
      ).toEqual([
        ["declares the budget", "SPAWN_BUDGET_MS"],
        ["inherits the runner's default", null],
        // A literal is the number restated per case, not a declared budget.
        ["restates a number of its own", null],
        ["reaches the spawn through a local wrapper", null],
        ["spawns node without the harness", null],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("each lane reads its own files and not the other lane's", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-budget-lane-"));
    try {
      await writeFile(join(dir, "fixture.integration.test.ts"), FIXTURE, "utf8");
      expect((await scanSpawnSites({ lane: "default", dir })).scanned).toEqual([]);

      // The same bytes, read by the lane whose suffix they carry: the absence
      // above is the default lane's exclude doing work rather than a scan
      // that stopped reading.
      const { scanned: theirs } = await scanSpawnSites({
        lane: "integration",
        dir,
      });
      expect(theirs.length).toBeGreaterThan(0);
      expect(theirs.every((s) => s.module.endsWith(".integration.test.ts"))).toBe(
        true,
      );

      // And the symmetric half: the integration lane does not collect a
      // default-lane file sitting beside it.
      await writeFile(join(dir, "fixture.test.ts"), FIXTURE, "utf8");
      expect(
        (await scanSpawnSites({ lane: "default", dir })).scanned.length,
      ).toBeGreaterThan(0);
      expect(
        (await scanSpawnSites({ lane: "integration", dir })).scanned,
      ).toEqual(theirs);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads each lane under the vitest mode its own package script selects", () => {
    // The binding the scan runs on, against the scripts that run the lanes:
    // `pnpm test` passes no `--mode`, `pnpm test:integration` passes one, and
    // the two must not resolve to the same lane.
    expect(LANES).toEqual(["default", "integration"]);
    const modes = LANES.map((lane) => laneMode(lane));
    expect(new Set(modes).size).toBe(LANES.length);
    const scripts = (
      JSON.parse(
        readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
      ) as { scripts: Record<string, string> }
    ).scripts;
    expect(scripts.test).not.toContain("--mode");
    for (const mode of modes) {
      if (mode === laneMode("default")) continue;
      expect(scripts["test:integration"]).toContain(`--mode ${mode}`);
    }
  });
});

// ---------- the lanes' sync points
// (spec/worktrees.md, "The default test lane must stay fast") ----------

/**
 * A spawning case's wait, against the clock it waits on.
 *
 * A fixed sleep between spawning `flume tick`/`loop` and asserting on what
 * that process wrote is a guess at a `node`+`tsx` startup, calibrated on a
 * host running one file. Under whole-lane contention the same guess goes
 * short and reds an innocent entry — which is a defect in the test, not a
 * lane assignment: the spec's bar is that a load-sensitive timing assertion
 * belongs in *neither* lane until it is event-based.
 *
 * Both lanes, because both spawn: the integration lane is where the sleeps
 * were, and the default lane is where one would cost the afterMerge gate
 * directly. `tests/helpers/waitFor.ts` is the shape that passes here — it
 * ends on the event, and the scan does not follow an import into it, so the
 * timer it is built on is not the timer this pin is about.
 */
it("no case that starts a node process awaits a timer, in either lane", async () => {
  const byLane = new Map<Lane, SpawnScan>();
  for (const lane of LANES) byLane.set(lane, await scanSpawnSites({ lane }));

  // Vacuity: both lanes were reached, both carry spawning sites, and the two
  // sets are the different lanes they claim to be — a scan that read the same
  // lane twice, or read one of them as empty, would clear the refusal below
  // without judging anything (`.claude/rules/engineering.md`, *A green
  // verdict is proven non-vacuous*).
  expect([...byLane.keys()]).toEqual([...LANES]);
  for (const [lane, scan] of byLane) {
    expect(
      scan.scanned.length,
      `${lane} lane: no spawning site found`,
    ).toBeGreaterThan(0);
  }
  const integration = byLane.get("integration")?.scanned ?? [];
  const fast = byLane.get("default")?.scanned ?? [];
  expect(
    integration.every((s) => s.module.endsWith(".integration.test.ts")),
  ).toBe(true);
  expect(fast.some((s) => s.module.endsWith(".integration.test.ts"))).toBe(
    false,
  );

  const sleeping = [...byLane].flatMap(([lane, scan]) =>
    scan.sleeping.map(
      (s) =>
        `${lane} lane — ${s.module}:${s.line} ${s.kind} "${s.title}" awaits ` +
        `${s.awaitedTimer ?? ""}`,
    ),
  );
  expect(
    sleeping,
    "these cases start a node process and then await a wall-clock timer: " +
      "wait on the event instead (`waitFor`, tests/helpers/waitFor.ts), which " +
      "ends as soon as the thing arrives and refuses by name at its ceiling",
  ).toEqual([]);
});

/**
 * The timer scan's own sensitivity, over a fixture written to be caught: the
 * pin above is green over an empty set by design, so a detector that stopped
 * firing would read exactly like two lanes in order.
 *
 * The fixture prices both edges of the vocabulary as well as its middle — an
 * event-based wait, a timer named only inside chain source, and a timer armed
 * but never awaited are all *not* sleeps, and a case that sleeps without
 * spawning is not this scan's business at all.
 */
it("the timer scan reports an awaited timer in a spawning fixture case", async () => {
  const FIXTURE = [
    `import { runCli, SPAWN_BUDGET_MS } from "../helpers/subprocess.ts";`,
    `import { fileWithContent, waitFor } from "../helpers/waitFor.ts";`,
    ``,
    `const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));`,
    ``,
    `it("sleeps a fixed guess after spawning", async () => {`,
    `  const child = runCli("/tmp", ["loop"]);`,
    `  await new Promise((r) => setTimeout(r, 800));`,
    `  await child;`,
    `}, SPAWN_BUDGET_MS);`,
    ``,
    `it("sleeps through a file-local wrapper", async () => {`,
    `  await runCli("/tmp", ["status"]);`,
    `  await settle(800);`,
    `}, SPAWN_BUDGET_MS);`,
    ``,
    `it("waits on the event instead", async () => {`,
    `  await runCli("/tmp", ["status"]);`,
    `  await waitFor("the claim", () => fileWithContent("/tmp/claim"));`,
    `}, SPAWN_BUDGET_MS);`,
    ``,
    `it("names a timer only inside the chain source it writes", async () => {`,
    `  await runCli("/tmp", ["status"]);`,
    `  expect("await new Promise((r) => setTimeout(r, 10));").toContain("r");`,
    `}, SPAWN_BUDGET_MS);`,
    ``,
    `it("arms a kill timer it never awaits", async () => {`,
    `  const kill = setTimeout(() => {}, 5000);`,
    `  await runCli("/tmp", ["status"]);`,
    `  clearTimeout(kill);`,
    `}, SPAWN_BUDGET_MS);`,
    ``,
    `it("sleeps but spawns nothing", async () => {`,
    `  await settle(800);`,
    `});`,
    ``,
  ].join("\n");

  const dir = await mkdtemp(join(tmpdir(), "flume-sync-point-"));
  try {
    await writeFile(join(dir, "fixture.test.ts"), FIXTURE, "utf8");
    const { scanned: sites } = await scanSpawnSites({ lane: "default", dir });

    // The whole list, so the four shapes that must read as event-based — and
    // the sleeping case that spawns nothing, absent entirely — are pinned by
    // their verdicts rather than by a filter that could match nothing.
    expect(sites.map((s) => [s.title, s.awaitedTimer])).toEqual([
      ["sleeps a fixed guess after spawning", "setTimeout"],
      // The local wrapper is named at the site, not the timer under it.
      ["sleeps through a file-local wrapper", "settle"],
      ["waits on the event instead", null],
      ["names a timer only inside the chain source it writes", null],
      ["arms a kill timer it never awaits", null],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * The end of the pin that matters: not what `pinGitAutoGcOff` returns, but
 * what a real `git` resolves inside a fixture the suite created, with the
 * environment `tests/helpers/vitestSetup.ts` armed for this worker
 * (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
 * wrote").
 *
 * Top-level rather than under the describe below, because its subject is the
 * wiring rather than the function.
 */
it("a temp git repository the suite creates has git's auto gc disabled", async () => {
  const repo = await mkFixtureRoot("flume-auto-gc-");
  try {
    const opts = { cwd: repo };
    await exec("git", ["init", "-q", "-b", "main"], opts);

    // Non-vacuity: git answered from inside the fixture this test created,
    // not from an ancestor repository whose own config would otherwise be
    // what the assertion below reads.
    const { stdout: top } = await exec(
      "git",
      ["rev-parse", "--show-toplevel"],
      opts,
    );
    expect(await realpath(top.trim())).toBe(await realpath(repo));

    const { stdout } = await exec(
      "git",
      ["config", "--type=int", "--get", "gc.auto"],
      opts,
    );
    expect(stdout.trim()).toBe("0");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

describe("pinGitAutoGcOff — appended to the host's git config sequence, never over it", () => {
  it("appends beside a sequence the host already declared", () => {
    const env: NodeJS.ProcessEnv = {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "protocol.version",
      GIT_CONFIG_VALUE_0: "2",
    };

    expect(pinGitAutoGcOff(env)).toBe(env);
    expect(env).toEqual({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "protocol.version",
      GIT_CONFIG_VALUE_0: "2",
      GIT_CONFIG_KEY_1: "gc.auto",
      GIT_CONFIG_VALUE_1: "0",
    });
  });

  it("re-arming one environment overwrites in place rather than growing the sequence", () => {
    const env: NodeJS.ProcessEnv = {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "gc.auto",
      GIT_CONFIG_VALUE_0: "6700",
    };

    pinGitAutoGcOff(env);
    pinGitAutoGcOff(env);

    expect(env).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "gc.auto",
      GIT_CONFIG_VALUE_0: "0",
    });
  });

  it("refuses a GIT_CONFIG_COUNT that is not a count, rather than writing over the pair it names", () => {
    const env: NodeJS.ProcessEnv = {
      GIT_CONFIG_COUNT: "two",
      GIT_CONFIG_KEY_0: "protocol.version",
    };

    expect(() => pinGitAutoGcOff(env)).toThrow(/GIT_CONFIG_COUNT/);
    expect(env.GIT_CONFIG_KEY_0).toBe("protocol.version");
  });
});
