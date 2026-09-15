/**
 * SUBPROCESS-TSX-SENTINEL — the shared CLI-subprocess harness's own suite.
 * Every other CLI suite *consumes* `tests/helpers/subprocess.ts`; this one
 * tests it, because the helper is where a CLI that never started used to
 * become an ordinary exit code 1 (`.claude/rules/engineering.md`, "A green
 * verdict is proven non-vacuous").
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  refuseLeakedStateRoots,
  refusePreexistingStateRoots,
  requireEntryPoint,
  runCli,
  watchStateRoots,
} from "./helpers/subprocess.ts";
import {
  declaredLaneGlobs,
  defaultLaneFiles,
  harnessBudgets,
  harnessSpawnExports,
  reduceLaneGlobs,
  scanDefaultLaneSpawnSites,
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
    const attic = await mkdtemp(join(tmpdir(), "flume-leak-attic-"));
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
        [join("helpers", "subprocess.ts")]:
          "exitStatusOf — the mechanism itself, where the narrowing lives",
      } as Record<string, string>,
    },
  ] as const;

  const corpus = readdirSync(TESTS_DIR, { recursive: true })
    .map((entry) => String(entry))
    .filter((rel) => rel.endsWith(".ts"))
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

  // Vacuity pin (engineering.md, "A green verdict is proven non-vacuous"):
  // the refusals below pass over an empty set once every site is fixed, so a
  // corpus that walked nothing — a non-recursive read, a wrong directory, a
  // filter that keeps no file — would read exactly like a clean tree. Pinned
  // on the subject rather than the count: the files that spawn a child are
  // the only ones that can hold the defect at all.
  it("scans a populated tests/ corpus, recursively, including the suites that spawn a child", () => {
    expect(corpus.length).toBeGreaterThan(0);
    expect(corpus.map((f) => f.path)).toContain(join("helpers", "subprocess.ts"));
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
  const sites = await scanDefaultLaneSpawnSites();
  expect(sites.length).toBeGreaterThan(0);
  expect(new Set(sites.map((s) => s.file)).size).toBeGreaterThan(1);

  const inheriting = sites
    .filter((s) => s.budget === null)
    .map((s) => `${s.file}:${s.line} ${s.kind} — ${s.title}`);
  expect(
    inheriting,
    `these sites start a node process on vitest's 5s default: declare ` +
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
  const declared = await declaredLaneGlobs();

  // Vacuity: the config was reached and it declared a selection at all, so
  // the reduction below is judging globs rather than two empty lists.
  expect(declared.include.length).toBeGreaterThan(0);
  expect(declared.exclude.length).toBeGreaterThan(0);

  // Agreement: reaching a rule at all is the claim — the reducer refuses any
  // declared glob the walk cannot implement, so a lane the scan would read
  // only part of cannot reduce quietly to the part it understands.
  const rule = reduceLaneGlobs(declared);
  const files = defaultLaneFiles(rule);

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
    reduceLaneGlobs({ include: ["tests/**/*.{test,spec}.ts"], exclude: [] }),
  ).toThrow("<root>/**/*<suffix>");
  expect(() =>
    reduceLaneGlobs({
      include: [...declared.include, "packages/**/*.test.ts"],
      exclude: [],
    }),
  ).toThrow("walks one root");
  expect(() =>
    reduceLaneGlobs({ include: declared.include, exclude: ["**/fixtures/**"] }),
  ).toThrow("drops files by suffix");
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
      const sites = await scanDefaultLaneSpawnSites(dir);

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

  it("reads only the default lane, so an integration suite's spawns are none of its business", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-budget-lane-"));
    try {
      await writeFile(join(dir, "fixture.integration.test.ts"), FIXTURE, "utf8");
      expect(await scanDefaultLaneSpawnSites(dir)).toEqual([]);

      // Sensitivity: the same bytes under the default lane's suffix are the
      // findings the assertion above must not be collecting.
      await writeFile(join(dir, "fixture.test.ts"), FIXTURE, "utf8");
      expect((await scanDefaultLaneSpawnSites(dir)).length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
