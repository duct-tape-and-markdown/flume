/**
 * The harness package's runner (`spec/harness.md`, *The runner interface*),
 * driven end to end: a real vitest project in a temp repo, the real
 * reporter's JSON, the real reader. Nothing here hand-authors a report —
 * a runner tested against a fixture written by the tester's hand pins the
 * tester's idea of vitest's output, not vitest's
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 *
 * The fixture is one source file and one test file, arranged so the base
 * commit and the working tree disagree about the source while the working
 * tree's test file carries a name the base's never did. That single
 * disagreement is what makes `runAtBase`'s two claims separable: the base's
 * bytes decided the failure, and the merged bytes decided which tests ran.
 *
 * The same fixture drives the judge (`harness/judge.ts`) over this runner,
 * end to end. The two sides of the runner interface are pinned apart
 * elsewhere — `harnessJudge.test.ts` rules over a stand-in runner, the cases
 * above read vitest's own reporter — and a seam whose halves are only ever
 * checked alone ships a one-sided change green. Here the judge's ruling is
 * decided by reports vitest actually wrote.
 *
 * `node_modules` reaches the fixture and the base checkout by symlink, never
 * by install — the fixture never runs one, which is the condition
 * `.claude/rules/platform-facts.md`, *pnpm deletes a symlinked
 * `node_modules` on install*, bounds.
 */

import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { harnessChain } from "../harness/chain.ts";
import {
  judgeNamedLines,
  scriptRunner,
  vitestRunner,
  type Lane,
  type RunResult,
  type Runner,
  type RunnerContext,
  type ScriptReader,
  type ScriptReport,
} from "../harness/index.ts";
import { buildFlumeApi, type FlumeApi } from "../src/flumeApi.ts";
import { worktreesBase } from "../src/paths.ts";
import { withGateCheckouts } from "../src/worktrees.ts";

import { filesUnder, relPath } from "./helpers/repoProgram.ts";
import { stubRunner } from "./helpers/stubRunner.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { SPAWN_BUDGET_MS, exec, gitOutSync } from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const git = (repo: string, args: string[]): string =>
  gitOutSync(repo, args).trim();

const put = async (repo: string, rel: string, body: string): Promise<void> => {
  await mkdir(dirname(join(repo, rel)), { recursive: true });
  await writeFile(join(repo, rel), body);
};

/** The test file as the base commit holds it: one name, and it needs "base". */
const BASE_TEST = `import { describe, expect, it } from "vitest";
import { widget } from "../src/widget.ts";

describe("widget", () => {
  it("carries the base widget", () => {
    expect(widget).toBe("base");
  });
});
`;

/**
 * The test file as the working tree holds it: a name that only passes over
 * the merged source, beside one that passes over either. The second is how
 * a base run proves the merged bytes were laid down at all — the base commit
 * has no test by that name.
 */
const MERGED_TEST = `import { describe, expect, it } from "vitest";
import { widget } from "../src/widget.ts";

describe("widget", () => {
  it("carries the merged widget", () => {
    expect(widget).toBe("merged");
  });
  it("runs wherever it is laid down", () => {
    expect(typeof widget).toBe("string");
  });
});
`;

/**
 * A declaration a consumer could write, minus the `setup` each case states
 * for itself. Real, because the context a runner factory is called with is
 * reduced from one: a hand-composed context would re-author, by the tester's
 * hand, exactly the reduction this seam exists to carry
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
const DECLARATION = {
  specLocus: ["spec/**"],
  fence: { build: ["src/**", "tests/**"] },
  slices: {
    enabled: ["plan-inbox", "plan-derive", "plan-sweep"],
    sweep: { domain: ["src/**"], posturePages: ["docs/**"] },
  },
};

/**
 * A base run happens inside a gate invocation — `namedLinesGate`
 * (`harness/chain.ts`) reaches the runner through `Dispatcher.runGate`, which
 * opens the checkout scope `api.git.checkoutAt` plants into and reclaims at.
 * Driving the runner from inside the same scope is what the runtime does, not
 * a seam invented here: outside one there is no boundary to reclaim at and
 * the API refuses.
 *
 * `declaredBase` is the chain's own worktree base when a case states one —
 * the value the dispatcher hands the scope, never the gate. The engine mints
 * no level beneath that base, so the checkout lands at the base itself.
 */
const inGateScope = <T>(
  body: () => Promise<T>,
  declaredBase?: string,
): Promise<T> =>
  withGateCheckouts(
    {
      log: { info: () => {}, warn: () => {}, error: () => {} },
      ...(declaredBase !== undefined
        ? { declaredWorktreesBase: declaredBase }
        : {}),
    },
    body,
  );

/**
 * A real `FlumeApi` over a fixture repo, with one member replaced: neither
 * fixture here commits a lockfile, so the engine's own installer would refuse
 * it. Everything a factory reads — the state root, and the installer it
 * provisions a base checkout with — arrives through this and nowhere else.
 */
const apiOver = (
  repo: string,
  flumeDir: string,
  install: (tree: string) => Promise<void>,
): FlumeApi => ({
  ...buildFlumeApi({ repoRoot: repo, configDir: flumeDir, flumeDir }),
  setupWorktree: install,
});

/**
 * The context a declared runner factory is called with, taken from the real
 * chain factory over a real declaration — so the provisioning a base checkout
 * gets here is the one this consumer's build worktrees get, never one
 * composed beside it.
 */
const contextFrom = (
  over: FlumeApi,
  setup?: { directories: string[]; restore?: string },
): RunnerContext => {
  let seen: RunnerContext | undefined;
  harnessChain({
    api: over,
    declaration: {
      ...DECLARATION,
      runner: (received: RunnerContext) => {
        seen = received;
        // The captured declaration's runner is never driven; the capture is
        // the whole point of this factory.
        return stubRunner;
      },
      ...(setup === undefined ? {} : { setup }),
    },
  });
  if (seen === undefined) {
    throw new Error("the chain factory never called the declared runner factory");
  }
  return seen;
};

describe("the vitest runner", () => {
  let fixture: string;
  let flumeDir: string;
  let baseSha: string;
  /** The engine surface the factory is handed, and the runner it returns. */
  let api: FlumeApi;
  let ctx: RunnerContext;
  let runner: Runner;

  /**
   * Every path git registers as a worktree of `repo`, the primary aside —
   * asked of the engine's own registry probe through the api the runner was
   * handed, never re-spelled here. The reclamation assertions below are
   * absence verdicts over that probe's own result, so a second decoder beside
   * it would judge membership by a different reading of git's output than the
   * engine acted on (`.claude/rules/engineering.md`, *The fix lands at the
   * mechanism*: detection a sibling surface already performs is shared, never
   * re-derived).
   *
   * `read: false` throws rather than returning an empty set: "the registry
   * could not be read" is not "no checkout is registered", and an absence
   * assertion handed the former would go green over nothing
   * (`.claude/rules/engineering.md`, *Loud or nothing*).
   */
  const checkoutsOf = async (repo: string): Promise<string[]> => {
    const registry = await api.git.readWorktreeRegistry(repo);
    if (!registry.read) {
      throw new Error(`worktree registry unreadable: ${registry.reason}`);
    }
    return [...registry.worktrees.keys()].filter((p) => p !== resolve(repo));
  };

  /** `node_modules` for a tree that has none of its own. */
  const link = async (tree: string): Promise<void> => {
    await symlink(join(REPO_ROOT, "node_modules"), join(tree, "node_modules"), "dir");
  };

  /** {@link apiOver} bound to this fixture. */
  const apiWithInstaller = (install: (tree: string) => Promise<void>): FlumeApi =>
    apiOver(fixture, flumeDir, install);

  /**
   * One base run through a freshly-declared factory over a declaration with
   * no `setup`, recording every checkout path the API's installer was
   * handed. Both halves of the factory's contract are observable from here:
   * where the checkout landed, and that the run reached a suite at all —
   * which it could only do through what the installer laid down.
   */
  const recordedBaseRun = async (): Promise<{
    checkouts: string[];
    result: RunResult;
  }> => {
    const checkouts: string[] = [];
    const recording = apiWithInstaller(async (tree) => {
      checkouts.push(tree);
      await link(tree);
    });
    const result = await inGateScope(() =>
      vitestRunner()(contextFrom(recording)).runAtBase(
        ["runs wherever it is laid down"],
        ["tests/widget.test.ts"],
        baseSha,
        fixture,
      ),
    );
    return { checkouts, result };
  };

  beforeAll(async () => {
    // Rooted at the spelling git reports (`mkTempDir`): the gate-checkout
    // assertions below compare `worktreesBase(flumeDir)`-composed paths
    // against git's own worktree registry.
    fixture = await mkTempDir("flume-harness-runner-");
    flumeDir = join(fixture, ".flume");
    git(fixture, ["init", "-q"]);
    git(fixture, ["config", "user.email", "t@example.com"]);
    git(fixture, ["config", "user.name", "t"]);
    git(fixture, ["config", "commit.gpgsign", "false"]);

    await put(fixture, "package.json", `{ "name": "fixture", "private": true, "type": "module" }\n`);
    await put(fixture, ".gitignore", "node_modules\n");
    await put(
      fixture,
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });\n`,
    );
    await put(fixture, "src/widget.ts", `export const widget = "base";\n`);
    await put(fixture, "tests/widget.test.ts", BASE_TEST);
    git(fixture, ["add", "-A"]);
    git(fixture, ["commit", "-q", "-m", "base"]);
    baseSha = git(fixture, ["rev-parse", "HEAD"]);

    await put(fixture, "src/widget.ts", `export const widget = "merged";\n`);
    await put(fixture, "tests/widget.test.ts", MERGED_TEST);
    git(fixture, ["add", "-A"]);
    git(fixture, ["commit", "-q", "-m", "merged"]);

    await link(fixture);

    api = apiWithInstaller(link);
    ctx = contextFrom(api);
    runner = vitestRunner()(ctx);
  });

  afterAll(async () => {
    if (fixture) await rm(fixture, { recursive: true, force: true });
  });

  it("reports, per named line, whether one passing test carried it", async () => {
    const r = await runner.run(
      ["carries the merged widget", "a behavior nobody titled"],
      fixture,
    );

    // Vacuity: the suite the verdict is read off actually ran tests.
    expect(r.passed).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);

    expect(r.names).toEqual([
      {
        name: "carries the merged widget",
        carried: true,
        files: ["tests/widget.test.ts"],
      },
      { name: "a behavior nobody titled", carried: false, files: [] },
    ]);
  });

  it("lays the merged bytes over a detached base checkout and runs the same names there", async () => {
    const r = await inGateScope(() =>
      runner.runAtBase(
        ["carries the merged widget", "runs wherever it is laid down"],
        ["tests/widget.test.ts"],
        baseSha,
        fixture,
      ),
    );

    // Vacuity: the base run collected and executed the file it was given.
    expect(r.passed + r.failed).toBeGreaterThan(0);

    // The merged bytes ran: the base commit's test file has no test by this
    // name, so a passing one there could only have come from the copy.
    expect(r.names[1]).toEqual({
      name: "runs wherever it is laid down",
      carried: true,
      files: ["tests/widget.test.ts"],
    });
    // Against the base's own source: everything outside `files` stayed at
    // `baseSha`, so the name the merged source carries is red here.
    expect(r.names[0]).toEqual({
      name: "carries the merged widget",
      carried: false,
      files: [],
    });

    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.file).toBe("tests/widget.test.ts");
    expect(r.failures[0]!.name).toBe("widget carries the merged widget");
    expect(r.failures[0]!.message).toContain("base");

    // The checkout is gone with the gate scope: the engine reclaims it
    // whether the gate ruled or threw, so the worktree base holds no
    // residue of it.
    expect(await checkoutsOf(fixture)).toEqual([]);
  });

  it("the judge proves a named line over the real vitest runner's merged-tree and base reports", async () => {
    const test = "carries the merged widget";
    const pin = "runs wherever it is laid down";

    const verdict = await inGateScope(() =>
      judgeNamedLines(runner, {
        tests: [test],
        pins: [pin],
        baseSha,
        cwd: fixture,
      }),
    );

    // Vacuity: the merged-tree suite the ruling is read off ran tests and was
    // green, so "proven" is a verdict over evidence rather than over nothing.
    expect(verdict.passed).toBeGreaterThan(0);
    expect(verdict.failures).toEqual([]);
    expect(verdict.failingFiles).toEqual([]);

    // Both halves of the seam decided this: vitest's merged-tree report
    // carried each line, and vitest's base report — over the base's own
    // source, with the test file laid down — did not carry the `tests[]` one.
    expect(verdict.outcome).toBe("proven");
    expect(verdict.lines).toEqual([
      { line: test, lane: "tests", state: "proven", files: ["tests/widget.test.ts"] },
      { line: pin, lane: "pins", state: "proven", files: ["tests/widget.test.ts"] },
    ]);

    // The base checkout is gone with the gate that drove the ruling, as it
    // is with a bare run.
    expect(await checkoutsOf(fixture)).toEqual([]);
  });

  it("the judge reports green-on-base for a line the real vitest runner already carries at the base", async () => {
    // The fixture's second name passes wherever its file is laid down, so the
    // base run carries it — the shape of a `tests[]` line that pins nothing
    // the change introduced.
    const line = "runs wherever it is laid down";

    const verdict = await inGateScope(() =>
      judgeNamedLines(runner, {
        tests: [line],
        pins: [],
        baseSha,
        cwd: fixture,
      }),
    );

    // Vacuity: the merged tree was green and carried the line, so the base
    // report is what separated this verdict from `proven`.
    expect(verdict.passed).toBeGreaterThan(0);
    expect(verdict.failures).toEqual([]);

    expect(verdict.outcome).toBe("green-on-base");
    expect(verdict.lines).toEqual([
      { line, lane: "tests", state: "green-on-base", files: ["tests/widget.test.ts"] },
    ]);
    expect(verdict.message).toContain(line);
    expect(verdict.message).toContain(baseSha.slice(0, 7));
  });

  it("the vitest runner factory places its base checkout under the state root's worktree base", async () => {
    const { checkouts, result } = await recordedBaseRun();

    // Vacuity: a base run happened and reached a checkout at all, so the
    // path below is one the factory actually planted.
    expect(checkouts).toHaveLength(1);
    expect(result.passed).toBeGreaterThan(0);

    // Under the engine's own resolution of the base, agreed with rather than
    // respelled here: an operator may relocate it, and the whole point of
    // taking the API is that the runner plants where the engine says.
    expect(dirname(checkouts[0]!)).toBe(worktreesBase(flumeDir));

    // Nothing of it survives the run; what a killed run would leave sits
    // where the engine's stale-worktree sweep reads.
    expect(existsSync(checkouts[0]!)).toBe(false);
  });

  it("runAtBase takes its base checkout from the engine's api rather than adding a worktree", async () => {
    // A base the runner has no way to compute: not the state root's default,
    // and reachable only through the scope the dispatcher opens. A runner
    // planting its own worktree lands under `worktreesBase(flumeDir)` and
    // never sees this.
    const declaredBase = join(fixture, "engine-placed", "worktrees");

    let standing: string[] = [];
    const result = await inGateScope(async () => {
      const r = await runner.runAtBase(
        ["runs wherever it is laid down"],
        ["tests/widget.test.ts"],
        baseSha,
        fixture,
      );
      // Read while the scope is still open: the run has returned and the
      // checkout is still registered, so the runner removed nothing of its
      // own.
      standing = await checkoutsOf(fixture);
      return r;
    }, declaredBase);

    // Vacuity: the base run reached a suite in that checkout at all, so the
    // path below is one a real run was driven in.
    expect(result.passed).toBeGreaterThan(0);

    expect(standing).toHaveLength(1);
    // Planted where the gate scope said — the chain's declared base, which
    // only `api.git.checkoutAt` resolves.
    expect(dirname(standing[0]!)).toBe(declaredBase);

    // And reclaimed by the engine when the scope closed, not by the runner.
    expect(existsSync(standing[0]!)).toBe(false);
    expect(await checkoutsOf(fixture)).toEqual([]);
  });

  it.runIf(process.platform !== "win32")("the vitest runner provisions a base checkout through the declared setup", async () => {
    const installs: string[] = [];
    const recording = apiWithInstaller(async (tree) => {
      installs.push(tree);
    });
    // A consumer that provisions with its own command rather than with the
    // engine's installer — the shape of every stack whose install the engine
    // reads no lockfile for, and of every install that is not at the repo
    // root.
    const declared = vitestRunner()(
      contextFrom(recording, {
        directories: ["."],
        restore: `ln -s ${join(REPO_ROOT, "node_modules")} node_modules`,
      }),
    );

    const result = await inGateScope(() =>
      declared.runAtBase(
        ["runs wherever it is laid down"],
        ["tests/widget.test.ts"],
        baseSha,
        fixture,
      ),
    );

    // Vacuity: the base run reached a suite at all, which it could only do
    // through the `node_modules` the declared command laid down — the
    // checkout has none of its own.
    expect(result.passed).toBeGreaterThan(0);
    expect(result.names[0]).toEqual({
      name: "runs wherever it is laid down",
      carried: true,
      files: ["tests/widget.test.ts"],
    });

    // And the engine's installer never ran: a runner reaching past what it
    // was handed would provision the base one way while this consumer's
    // build worktrees are provisioned another.
    expect(installs).toEqual([]);
  });

  it("a consumer declaring no setup provisions a base checkout with the installer at the root", async () => {
    const { checkouts, result } = await recordedBaseRun();

    // The API's own member ran, once, on the checkout the factory planted —
    // and on its root: the path it was handed sits directly under the
    // worktree base, so nothing narrowed the install to a subdirectory.
    expect(checkouts).toHaveLength(1);
    expect(dirname(checkouts[0]!)).toBe(worktreesBase(flumeDir));

    // And it ran before the tests: the base checkout has no `node_modules`
    // of its own, so a run that collected a suite and carried a name could
    // only have resolved vitest through what this installer laid down. A
    // factory reaching past the API for the engine's default installer would
    // have refused the fixture outright — it commits no lockfile.
    expect(result.passed).toBeGreaterThan(0);
    expect(result.names[0]).toEqual({
      name: "runs wherever it is laid down",
      carried: true,
      files: ["tests/widget.test.ts"],
    });
  });

  it("reports its lanes and the files each excludes", () => {
    const declared: Lane[] = [
      { name: "fast", excludes: ["**/*.integration.test.ts"], runs: true },
      { name: "integration", excludes: ["**/*.unit.test.ts"], runs: false },
    ];
    expect(vitestRunner({ lanes: declared })(ctx).lanes).toEqual(declared);

    // Unsplit by default: one lane, nothing excluded — no consumer inherits
    // another's split.
    expect(vitestRunner()(ctx).lanes).toEqual([
      { name: "default", excludes: [], runs: true },
    ]);

    // Which lane the judge runs is declared, never guessed.
    expect(() => vitestRunner({ lanes: declared.map((l) => ({ ...l, runs: false })) })).toThrow(
      /exactly one lane must carry `runs`, got 0 of 2/,
    );
    expect(() => vitestRunner({ lanes: declared.map((l) => ({ ...l, runs: true })) })).toThrow(
      /exactly one lane must carry `runs`, got 2 of 2/,
    );
    expect(() => vitestRunner({ lanes: [] })).toThrow(/no lanes/);
  });

  it("refuses a base run it cannot judge: no files to lay down, or a file absent from the tree", async () => {
    // Both refusals are raised outside any gate scope, which is only
    // reachable because they precede the checkout: a selection that cannot
    // be laid down is refused before a `git worktree add` is spent to reach
    // the same error.
    await expect(runner.runAtBase(["x"], [], baseSha, fixture)).rejects.toThrow(
      /no files to lay over the base/,
    );
    await expect(
      runner.runAtBase(["x"], ["tests/absent.test.ts"], baseSha, fixture),
    ).rejects.toThrow(/tests\/absent\.test\.ts is not in the tree/);
  });

  it("refuses a run that produced no report rather than reading one as empty", async () => {
    const silent = vitestRunner({
      invoke: () => ({ command: process.execPath, args: ["-e", ""] }),
    })(ctx);
    await expect(silent.run(["anything"], fixture)).rejects.toThrow(/wrote no JSON report/);
  }, SPAWN_BUDGET_MS);
});

/**
 * The validator a consumer declares to `scriptRunner`: one command, run in
 * whatever tree it is pointed at, printing one verdict line per name it was
 * handed.
 *
 * It is a real program rather than a canned string, because the seam under
 * test is exactly the one a fixture would re-author: a reader driven over
 * stdout the tester wrote pins the tester's idea of the encoding, not a
 * validator's (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*). This one decides from the tree it is running in — the
 * checks its `checks/widget.checks` declares, against the source that tree
 * holds — so which tree ran it is observable from the verdicts alone.
 *
 * It also writes what every run it made saw: the tree it ran in, and the
 * arguments it was handed. And it exits non-zero when a check it ran did not
 * pass, the way a validator does, which is the status the verdict lines are
 * read in spite of.
 */
const VALIDATOR = `import { appendFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(1);
const log = argv[1];
const names = argv.slice(2);
appendFileSync(log, JSON.stringify({ cwd: process.cwd(), argv }) + "\\n");

const listed = readFileSync("checks/widget.checks", "utf8").split("\\n").filter(Boolean);
const source = readFileSync("src/widget.ts", "utf8");

// The validator's own output, on the stream the verdict lines share.
console.log("checked " + listed.length + " declared check(s) in " + process.cwd());

let failed = 0;
for (const name of names) {
  const carried = listed.includes(name) && source.includes(name.split(" ").pop());
  if (!carried) failed += 1;
  process.stdout.write(
    carried
      ? "flume\\tpass\\tchecks/widget.checks\\t" + name + "\\n"
      : "flume\\tfail\\t\\t" + name + "\\n",
  );
}
process.exit(failed === 0 ? 0 : 1);
`;

/**
 * A second validator, deciding exactly what the first one does and reporting
 * it the way most validators already do: one JSON document on stdout, no
 * verdict line anywhere in it.
 *
 * Its clean run omits the `drift` key rather than writing an empty list,
 * which is the shape a declared reader is priced against — the fact "nothing
 * drifted" is carried by the key's absence, so a reader that only looked up
 * names in it would answer nothing at all.
 *
 * A real program, for the reason the line validator above is one: the reader
 * under test is the half of a seam whose other half is a validator's output,
 * and a document written by the tester's hand would re-author it
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*).
 */
const SUMMARY = `import { readFileSync } from "node:fs";

const names = process.argv.slice(2);
const declared = readFileSync("checks/widget.checks", "utf8").split("\\n").filter(Boolean);
const source = readFileSync("src/widget.ts", "utf8");

const drift = names.filter(
  (name) => !declared.includes(name) || !source.includes(name.split(" ").pop()),
);
const report = {
  tree: process.cwd(),
  checks: declared.map((name) => ({ name, file: "checks/widget.checks" })),
};
if (drift.length > 0) report.drift = drift;

process.stdout.write(JSON.stringify(report) + "\\n");
process.exit(drift.length === 0 ? 0 : 1);
`;

/**
 * A second validator, committed at the base and changed in the working tree,
 * whose whole verdict is which copy of itself ran. Declared by a path rather
 * than by an absolute one, it is how the tree under judgment's own copy is
 * told from the caller's.
 */
const verdictScript = (verdict: "pass" | "fail"): string =>
  `#!/bin/sh\nfor name in "$@"; do\n  printf 'flume\\t${verdict}\\t${verdict === "pass" ? "checks/widget.checks" : ""}\\t%s\\n' "$name"\ndone\n`;

/** A check the merged tree declares and the base does not, carried by either source. */
const CARRIED = "the source names widget";
/** A check the merged tree declares, carried only where the source says merged. */
const MERGED_ONLY = "the source says merged";
/** A check no tree declares — the shape of a line nothing carried. */
const UNLISTED = "the source says nothing";

describe("the script runner", () => {
  let fixture: string;
  let flumeDir: string;
  let baseSha: string;
  /** Where every run the validator made is recorded, outside the tree it judges. */
  let logPath: string;
  let logDir: string;
  /** The declared command's arguments ahead of the named lines. */
  let args: string[];
  let ctx: RunnerContext;
  let runner: Runner;

  /** One entry per run the validator made, in the order it made them. */
  const runsLogged = async (): Promise<{ cwd: string; argv: string[] }[]> =>
    (await readFile(logPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { cwd: string; argv: string[] });

  const resetLog = async (): Promise<void> => {
    await writeFile(logPath, "");
  };

  /** The base run every case below drives, inside the scope that owns its checkout. */
  const atBase = (names: readonly string[]): Promise<RunResult> =>
    inGateScope(() =>
      runner.runAtBase(names, ["checks/widget.checks"], baseSha, fixture),
    );

  beforeAll(async () => {
    fixture = await mkTempDir("flume-script-runner-");
    logDir = await mkTempDir("flume-script-runner-log-");
    logPath = join(logDir, "runs.jsonl");
    await resetLog();
    flumeDir = join(fixture, ".flume");
    git(fixture, ["init", "-q"]);
    git(fixture, ["config", "user.email", "t@example.com"]);
    git(fixture, ["config", "user.name", "t"]);
    git(fixture, ["config", "commit.gpgsign", "false"]);

    await put(fixture, "package.json", `{ "name": "fixture", "private": true, "type": "module" }\n`);
    await put(fixture, "checks/run.mjs", VALIDATOR);
    await put(fixture, "checks/summary.mjs", SUMMARY);
    await put(fixture, "checks/verdict.sh", verdictScript("pass"));
    await chmod(join(fixture, "checks/verdict.sh"), 0o755);
    // The base declares a check nobody asks about: a name carried at the base
    // could then only have come from the merged bytes laid down there.
    await put(fixture, "checks/widget.checks", "the base lists this check\n");
    await put(fixture, "src/widget.ts", `export const widget = "base";\n`);
    git(fixture, ["add", "-A"]);
    git(fixture, ["commit", "-q", "-m", "base"]);
    baseSha = git(fixture, ["rev-parse", "HEAD"]);

    await put(fixture, "checks/widget.checks", `${CARRIED}\n${MERGED_ONLY}\n`);
    await put(fixture, "checks/verdict.sh", verdictScript("fail"));
    await put(fixture, "src/widget.ts", `export const widget = "merged";\n`);
    git(fixture, ["add", "-A"]);
    git(fixture, ["commit", "-q", "-m", "merged"]);

    args = [join(fixture, "checks", "run.mjs"), logPath];
    // The base checkout this consumer's runs are judged in is provisioned
    // through the api, as every shipped runner's is (`baseTree`,
    // `harness/toolRun.ts`) — the fixture installs nothing, its validator
    // being plain node.
    ctx = contextFrom(apiOver(fixture, flumeDir, async () => {}));
    runner = scriptRunner({ command: process.execPath, args })(ctx);
  });

  afterAll(async () => {
    if (fixture) await rm(fixture, { recursive: true, force: true });
    if (logDir) await rm(logDir, { recursive: true, force: true });
  });

  it("runs its command once per operation in the tree under judgment", async () => {
    await resetLog();

    const merged = await runner.run([CARRIED, MERGED_ONLY], fixture);
    const base = await atBase([CARRIED, MERGED_ONLY]);
    const logged = await runsLogged();

    // Vacuity: both operations reached the command and it answered both names.
    expect(merged.names).toHaveLength(2);
    expect(base.names).toHaveLength(2);

    // Once per operation — not once per name, and not once per file.
    expect(logged).toHaveLength(2);

    // And each in the tree that operation judges: the caller's for `run`, and
    // for `runAtBase` the engine-planted checkout under the state root's
    // worktree base, which the runner never spells itself.
    expect(logged[0]!.cwd).toBe(fixture);
    expect(dirname(logged[1]!.cwd)).toBe(worktreesBase(flumeDir));

    // The verdicts say the same thing the paths do: the base run's checks came
    // from the merged bytes laid over it, and its source came from the base.
    expect(base.names.map((n) => n.carried)).toEqual([true, false]);
    expect(merged.names.map((n) => n.carried)).toEqual([true, true]);
  });

  it("passes the named lines as the command's arguments", async () => {
    await resetLog();
    const names = [CARRIED, MERGED_ONLY, UNLISTED];

    await runner.run(names, fixture);
    await atBase(names);
    const logged = await runsLogged();

    // Vacuity: both runs happened, so both argv below are ones a run was
    // actually driven with.
    expect(logged).toHaveLength(2);

    for (const run of logged) {
      // The declared arguments, then every name verbatim and in order. The
      // same argv in both operations: the tree differs, never the question.
      expect(run.argv).toEqual([...args, ...names]);
    }
  });

  it("an undeclared reader takes one verdict line per name from stdout", async () => {
    // `runner` declares a command and no reader, so what reads this stdout is
    // the default the package ships.
    const r = await runner.run([CARRIED, MERGED_ONLY, UNLISTED], fixture);

    // Vacuity: the verdict set is read off a validator that carried something.
    expect(r.passed).toBe(2);

    // One answer per name, in the order they were asked about — the name, that
    // a passing check carried it, and the file that did. The validator's own
    // output on the same stream is no part of it.
    expect(r.names).toEqual([
      { name: CARRIED, carried: true, files: ["checks/widget.checks"] },
      { name: MERGED_ONLY, carried: true, files: ["checks/widget.checks"] },
      { name: UNLISTED, carried: false, files: [] },
    ]);
  });

  it("a declared reader turns a validator's one JSON document into a verdict per name", async () => {
    /** What the validator's document says, as the reader below reads it. */
    interface Summary {
      readonly tree: string;
      readonly checks: readonly { readonly name: string; readonly file: string }[];
      /** Absent on a clean run — nothing drifted is said by not saying it. */
      readonly drift?: readonly string[];
    }

    /** Every report the reader was handed, in the order the runs happened. */
    const seen: ScriptReport[] = [];
    const read: ScriptReader = (report) => {
      seen.push(report);
      const doc = JSON.parse(report.stdout) as Summary;
      const drifted = new Set(doc.drift ?? []);
      return report.names.map((name) => {
        const check = doc.checks.find((c) => c.name === name);
        return check !== undefined && !drifted.has(name)
          ? { name, carried: true, files: [check.file] }
          : { name, carried: false, files: [] };
      });
    };

    const summaryArgs = [join(fixture, "checks", "summary.mjs")];
    const declared = scriptRunner({
      command: process.execPath,
      args: summaryArgs,
      read,
    })(ctx);

    const clean = await declared.run([CARRIED, MERGED_ONLY], fixture);

    // The reader read one document off the run's whole stdout — a real one,
    // written in the tree the run happened in, and carrying no verdict line
    // for the default reader to have taken instead.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.cwd).toBe(fixture);
    const cleanDoc = JSON.parse(seen[0]!.stdout) as Summary;
    expect(cleanDoc.tree).toBe(fixture);
    // The shape this seam is priced against: a clean run states nothing about
    // drift, so the verdict per name comes from the reader, not from a lookup.
    expect("drift" in cleanDoc).toBe(false);

    // And the verdicts are the runner's own: one per name, in the order asked,
    // each carrying the file a base run would lay over the base tree.
    expect(clean.passed).toBe(2);
    expect(clean.names).toEqual([
      { name: CARRIED, carried: true, files: ["checks/widget.checks"] },
      { name: MERGED_ONLY, carried: true, files: ["checks/widget.checks"] },
    ]);

    // What the declaration buys, stated as the price it removes: this same
    // command under the default reader answers nothing, so a consumer without
    // this seam ships a second program that reprints the document as lines.
    await expect(
      scriptRunner({ command: process.execPath, args: summaryArgs })(ctx).run(
        [CARRIED],
        fixture,
      ),
    ).rejects.toThrow(/answered nothing for 1 of 1/);

    // The other arm of the same document: a name the validator drifted on is
    // uncarried, and a run carrying one still reports no failure of its own.
    const drifted = await declared.run([CARRIED, UNLISTED], fixture);
    expect((JSON.parse(seen[1]!.stdout) as Summary).drift).toEqual([UNLISTED]);
    expect(drifted.ok).toBe(true);
    expect(drifted.names).toEqual([
      { name: CARRIED, carried: true, files: ["checks/widget.checks"] },
      { name: UNLISTED, carried: false, files: [] },
    ]);

    // Both operations read through the declared reader, over the tree each one
    // judges: the base checkout's source carries one of these names and not
    // the other, which is the disagreement the line reader reports too.
    const base = await inGateScope(() =>
      declared.runAtBase([CARRIED, MERGED_ONLY], ["checks/widget.checks"], baseSha, fixture),
    );
    expect(seen).toHaveLength(3);
    expect(dirname(seen[2]!.cwd)).toBe(worktreesBase(flumeDir));
    expect(base.names.map((n) => n.carried)).toEqual([true, false]);
  });

  it("a non-zero exit carrying a complete verdict set is not a failure", async () => {
    // The same command the runner drives, driven here for its exit status
    // alone: this validator exits non-zero when a check it ran did not pass,
    // which asking about a name no tree declares makes it do.
    const status = await exec(process.execPath, [...args, UNLISTED], {
      cwd: fixture,
    }).then(
      () => 0,
      (err: NodeJS.ErrnoException) => err.code,
    );
    expect(status).toBe(1);

    const r = await runner.run([UNLISTED], fixture);

    // The lines are the verdict: the run reports what the validator said about
    // the name, and reports no failure of its own over the status.
    expect(r.names).toEqual([{ name: UNLISTED, carried: false, files: [] }]);
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("refuses stdout that is not one well-formed verdict line per requested name", async () => {
    // Hand-authored output, which a refusal case is entitled to: no real
    // validator produces the malformed stream a reader's refusal is about
    // (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
    // wrote*, on scope).
    const printing = (line: string): Runner =>
      scriptRunner({
        command: process.execPath,
        args: ["-e", `process.stdout.write(${JSON.stringify(line)})`],
      })(ctx);

    // A name with no line of its own is not a name nothing carried.
    await expect(printing("nothing to say\n").run([CARRIED], fixture)).rejects.toThrow(
      /answered nothing for 1 of 1/,
    );
    // A line about something nobody asked about.
    await expect(
      printing(`flume\tpass\tchecks/widget.checks\tsome other check\n`).run(
        [CARRIED],
        fixture,
      ),
    ).rejects.toThrow(/nobody asked about/);
    // One name, two answers.
    await expect(
      printing(
        `flume\tpass\tchecks/widget.checks\t${CARRIED}\nflume\tfail\t\t${CARRIED}\n`,
      ).run([CARRIED], fixture),
    ).rejects.toThrow(/answered "the source names widget" twice/);
    // A verdict the encoding does not spell.
    await expect(
      printing(`flume\tmaybe\t\t${CARRIED}\n`).run([CARRIED], fixture),
    ).rejects.toThrow(/where a verdict line says/);
    // A pass with no file to lay over the base.
    await expect(
      printing(`flume\tpass\t\t${CARRIED}\n`).run([CARRIED], fixture),
    ).rejects.toThrow(/where a run-relative file goes/);
  });

  it.runIf(process.platform !== "win32")(
    "resolves a command carrying a path separator against the tree it runs in",
    async () => {
      // A shebang script, so the case declares its host: win32 spawns no such
      // file, and a structural substitute would stop being the subject
      // (`.claude/rules/platform-facts.md`, *Node refuses to spawn a `.cmd`
      // shim without a shell*).
      const local = scriptRunner({ command: "checks/verdict.sh" })(ctx);

      // The working tree's copy answers here, and the base checkout's copy
      // there — the two disagree about every name by construction, and the
      // laid-over selection is the checks file rather than the script.
      expect((await local.run([CARRIED], fixture)).names[0]!.carried).toBe(false);

      const base = await inGateScope(() =>
        local.runAtBase([CARRIED], ["checks/widget.checks"], baseSha, fixture),
      );
      expect(base.names[0]!.carried).toBe(true);
    },
  );

  it("reports its lanes and refuses a set naming no running lane", () => {
    const declared: Lane[] = [
      { name: "fast", excludes: ["checks/slow/**"], runs: true },
      { name: "slow", excludes: ["checks/fast/**"], runs: false },
    ];
    expect(scriptRunner({ command: "check", lanes: declared })(ctx).lanes).toEqual(declared);

    // Unsplit by default, as every shipped runner is: one lane, nothing
    // excluded.
    expect(scriptRunner({ command: "check" })(ctx).lanes).toEqual([
      { name: "default", excludes: [], runs: true },
    ]);

    // And the invariant is the interface's, so it reads the same here as it
    // does from the vitest factory — under this factory's own name.
    expect(() => scriptRunner({ command: "check", lanes: [] })).toThrow(
      /scriptRunner: exactly one lane must carry `runs`, got 0 of 0 \(no lanes\)/,
    );
  });
});

/**
 * `harness/` imports `src/`; `src/` never imports `harness/`
 * (`spec/harness.md`, *Where it lives*). The check reads every specifier in
 * the engine's own sources — a decidable property of a fixed file set, not
 * an absence verdict over a symbol — so a text scan is the right layer for
 * it here.
 */
describe("the harness package boundary", () => {
  it("no module under src/ imports harness/", async () => {
    const srcDir = join(REPO_ROOT, "src");
    const harnessDir = join(REPO_ROOT, "harness");
    const modules = filesUnder({ root: srcDir, suffix: ".ts" }).map((path) =>
      relPath(srcDir, path),
    );

    // Vacuity: the engine's modules were found before their imports are
    // judged — an absence over an empty set is a false green.
    expect(modules.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const module of modules) {
      const text = await readFile(join(srcDir, module), "utf8");
      for (const m of text.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g)) {
        const spec = m[1]!;
        const reaches = spec.startsWith(".")
          ? resolve(dirname(join(srcDir, module)), spec).startsWith(harnessDir + sep)
          : /(^|\/)harness(\/|$)/.test(spec);
        if (reaches) offenders.push(`src/${module} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
