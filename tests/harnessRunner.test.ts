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
import { readdirSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { judgeNamedLines, vitestRunner, type Lane } from "../harness/index.ts";

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

describe("the vitest runner", () => {
  let fixture: string;
  let baseSha: string;

  /** `node_modules` for a tree that has none of its own. */
  const link = async (tree: string): Promise<void> => {
    await symlink(join(REPO_ROOT, "node_modules"), join(tree, "node_modules"), "dir");
  };

  const runner = vitestRunner({ prepare: link });

  beforeAll(async () => {
    fixture = await mkdtemp(join(tmpdir(), "flume-harness-runner-"));
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
    const r = await runner.runAtBase(
      ["carries the merged widget", "runs wherever it is laid down"],
      ["tests/widget.test.ts"],
      baseSha,
      fixture,
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
    expect(r.failingFiles).toEqual(["tests/widget.test.ts"]);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.name).toBe("widget carries the merged widget");
    expect(r.failures[0]!.message).toContain("base");

    // The checkout is gone with the run — a default `worktreeRoot` owns its
    // temp directory and removes it.
    expect(git(fixture, ["worktree", "list"]).split("\n")).toHaveLength(1);
  }, 180_000);

  it("the judge proves a named line over the real vitest runner's merged-tree and base reports", async () => {
    const test = "carries the merged widget";
    const pin = "runs wherever it is laid down";

    const verdict = await judgeNamedLines(runner, {
      tests: [test],
      pins: [pin],
      baseSha,
      cwd: fixture,
    });

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

    // The base checkout is gone with the ruling, as it is with a bare run.
    expect(git(fixture, ["worktree", "list"]).split("\n")).toHaveLength(1);
  }, 240_000);

  it("the judge reports green-on-base for a line the real vitest runner already carries at the base", async () => {
    // The fixture's second name passes wherever its file is laid down, so the
    // base run carries it — the shape of a `tests[]` line that pins nothing
    // the change introduced.
    const line = "runs wherever it is laid down";

    const verdict = await judgeNamedLines(runner, {
      tests: [line],
      pins: [],
      baseSha,
      cwd: fixture,
    });

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

  it("reports its lanes and the files each excludes", () => {
    const declared: Lane[] = [
      { name: "fast", excludes: ["**/*.integration.test.ts"], runs: true },
      { name: "integration", excludes: ["**/*.unit.test.ts"], runs: false },
    ];
    expect(vitestRunner({ lanes: declared }).lanes).toEqual(declared);

    // Unsplit by default: one lane, nothing excluded — no consumer inherits
    // another's split.
    expect(vitestRunner().lanes).toEqual([
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
    await expect(runner.runAtBase(["x"], [], baseSha, fixture)).rejects.toThrow(
      /no files to lay over the base/,
    );
    await expect(
      runner.runAtBase(["x"], ["tests/absent.test.ts"], baseSha, fixture),
    ).rejects.toThrow(/tests\/absent\.test\.ts is not in the tree/);
  }, 60_000);

  it("refuses a run that produced no report rather than reading one as empty", async () => {
    const silent = vitestRunner({ invoke: () => ({ command: process.execPath, args: ["-e", ""] }) });
    await expect(silent.run(["anything"], fixture)).rejects.toThrow(/wrote no JSON report/);
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
    const modules = readdirSync(srcDir, { recursive: true, encoding: "utf8" }).filter((f) =>
      f.endsWith(".ts"),
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
