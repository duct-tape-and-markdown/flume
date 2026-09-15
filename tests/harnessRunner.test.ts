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

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { harnessChain } from "../harness/chain.ts";
import {
  judgeNamedLines,
  vitestRunner,
  type Lane,
  type RunResult,
  type Runner,
  type RunnerContext,
} from "../harness/index.ts";
import { buildFlumeApi, type FlumeApi } from "../src/flumeApi.ts";
import { worktreesBase } from "../src/paths.ts";
import { withGateCheckouts } from "../src/worktrees.ts";

import { filesUnder, relPath } from "./helpers/repoProgram.ts";
import { stubRunner } from "./helpers/stubRunner.ts";
import { SPAWN_BUDGET_MS, mkTempDir } from "./helpers/subprocess.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const git = (repo: string, args: string[]): string =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

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
 * the value the dispatcher hands the scope, never the gate. No case here
 * runs under a job namespace, so the scope carries none and the checkout
 * lands at the base itself.
 */
const inGateScope = <T>(
  body: () => Promise<T>,
  declaredBase?: string,
): Promise<T> =>
  withGateCheckouts(
    {
      log: { info: () => {}, warn: () => {}, error: () => {} },
      namespace: undefined,
      ...(declaredBase !== undefined
        ? { declaredWorktreesBase: declaredBase }
        : {}),
    },
    body,
  );

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
    return [...registry.paths].filter((p) => p !== resolve(repo));
  };

  /** `node_modules` for a tree that has none of its own. */
  const link = async (tree: string): Promise<void> => {
    await symlink(join(REPO_ROOT, "node_modules"), join(tree, "node_modules"), "dir");
  };

  /**
   * A real `FlumeApi` over the fixture, with one member replaced: the
   * fixture commits no lockfile, so the engine's own installer would refuse
   * it. Everything the factory reads — the state root, and the installer it
   * provisions a base checkout with — arrives through this and nowhere else.
   */
  const apiWithInstaller = (
    install: (tree: string) => Promise<void>,
  ): FlumeApi => ({
    ...buildFlumeApi({ repoRoot: fixture, configDir: flumeDir, flumeDir }),
    setupWorktree: install,
  });

  /**
   * The context a declared runner factory is called with, taken from the
   * real chain factory over a real declaration — so the provisioning a base
   * checkout gets here is the one this consumer's build worktrees get, never
   * one composed beside it.
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
          // The captured declaration's runner is never driven; the
          // capture is the whole point of this factory.
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
  }, 60_000);

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
  }, 120_000);

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
  }, 180_000);

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
  }, 240_000);

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
  }, 240_000);

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
  }, 180_000);

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
  }, 180_000);

  it("the vitest runner provisions a base checkout through the declared setup", async () => {
    const installs: string[] = [];
    const recording = apiWithInstaller(async (tree) => {
      installs.push(tree);
      await link(tree);
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
  }, 180_000);

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
  }, 180_000);

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
  }, 60_000);

  it("refuses a run that produced no report rather than reading one as empty", async () => {
    const silent = vitestRunner({
      invoke: () => ({ command: process.execPath, args: ["-e", ""] }),
    })(ctx);
    await expect(silent.run(["anything"], fixture)).rejects.toThrow(/wrote no JSON report/);
  }, SPAWN_BUDGET_MS);
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
