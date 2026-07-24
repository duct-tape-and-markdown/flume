/**
 * v0.5 §5a / v0.6 §4 — `flume job new <name>`: a job is a branch plus a
 * state root, both named by convention, seeded from the repo chain's
 * declared `Chain.seedDir` (no more `--template`). The suite runs against
 * scratch git repos: seeding, ignore-ensure idempotence, link provisioning
 * (junction on win32), baseline-commit hygiene, and name validation. The
 * no-dep-tree fixture proves the provisioned link is what resolves
 * `@dtmd/flume` at chain load — the version-coherence claim (§5a-4).
 */

import { execFile } from "node:child_process";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  ensureRuntimeIgnores,
  jobExtract,
  jobNew,
  jobRm,
  jobRun,
  jobStatus,
  JobUsageError,
  RUNTIME_IGNORES,
  validateJobName,
} from "../src/job.ts";
import { Baton } from "../src/Baton.ts";
import { loadChainModule } from "../src/Dispatcher.ts";

const exec = promisify(execFile);

// Run the source CLI through the project's own `tsx` (no build step) — via
// `node <tsx cli.mjs>`, not the `.bin/tsx` shim (a `.cmd` shell script on
// win32 that `execFile` cannot spawn without a shell).
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TSX_CLI = fileURLToPath(
  new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url),
);

/** The flume checkout root — the default link target (`resolve(HERE, "..")`). */
const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Strip the harness's canonical FLUME_* vars so spawned CLIs stay hermetic. */
function hermeticEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.FLUME_DIR;
  delete env.FLUME_CONFIG_DIR;
  delete env.FLUME_JOB;
  return env;
}

async function runCli(
  cwd: string,
  args: string[],
): Promise<{ out: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [TSX_CLI, CLI, ...args],
      { cwd, env: hermeticEnv() },
    );
    return { out: stdout + stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.code ?? 1 };
  }
}

/** Scratch git repo on `main` with one seed commit. */
async function makeRepo(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "flume-job-new-"));
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", "main"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  // Byte-exact content assertions (intake sync, unwind restore) — keep the
  // host's autocrlf from rewriting checkouts.
  await exec("git", ["config", "core.autocrlf", "false"], opts);
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function gitOut(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
}

/** Minimal valid chain, no `seedDir` declared — the chain-load precondition `jobNew` enforces (v0.6 §4/§9-7): a chainless repo cannot create a job. */
const MINIMAL_CHAIN_SRC =
  `export default {\n` +
  `  phases: [{\n` +
  `    name: "probe",\n` +
  `    description: "",\n` +
  `    promptPath: "prompt.md",\n` +
  `    concurrency: "singleton",\n` +
  `    writablePaths: ["**"],\n` +
  `    gates: [],\n` +
  `    handoff: () => [],\n` +
  `  }],\n` +
  `  humanOnly: [],\n` +
  `};\n`;

/**
 * Commit the repo chain at `<repoDir>/.flume/chain.ts` — repo-resident
 * (v0.6 §2), so it rides every branch. Every `jobNew` call now requires this
 * to exist; pass `seedDir` to exercise the v0.6 §4 seed path (any seed
 * content under `.flume/` written before this call rides the same commit).
 */
async function writeRepoChain(
  repoDir: string,
  opts: { seedDir?: string } = {},
): Promise<void> {
  await mkdir(join(repoDir, ".flume"), { recursive: true });
  const src =
    opts.seedDir === undefined
      ? MINIMAL_CHAIN_SRC
      : MINIMAL_CHAIN_SRC.replace(
          "humanOnly: [],",
          `humanOnly: [],\n  seedDir: ${JSON.stringify(opts.seedDir)},`,
        );
  await writeFile(join(repoDir, ".flume", "chain.ts"), src, "utf8");
  await exec("git", ["add", ".flume"], { cwd: repoDir });
  await exec("git", ["commit", "-q", "-m", "chore: repo chain fixture"], {
    cwd: repoDir,
  });
}

describe("validateJobName — single-segment shape, checked before dir+branch construction", () => {
  it("rejects path separators (both kinds), emptiness, and non-name segments", () => {
    expect(validateJobName("a/b")).toContain("path separator");
    expect(validateJobName("a\\b")).toContain("path separator");
    expect(validateJobName("")).toBeTruthy();
    expect(validateJobName(".")).toBeTruthy();
    expect(validateJobName("..")).toBeTruthy();
  });

  it("accepts an ordinary segment", () => {
    expect(validateJobName("docs-refresh")).toBeNull();
  });
});

describe("ensureRuntimeIgnores — §5a-3 create-or-merge", () => {
  it("creates .gitignore with exactly the runtime entries when absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-ignores-"));
    try {
      await ensureRuntimeIgnores(dir);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content).toBe(RUNTIME_IGNORES.join("\n") + "\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent: a second run leaves the file byte-identical", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-ignores-"));
    try {
      await ensureRuntimeIgnores(dir);
      const first = await readFile(join(dir, ".gitignore"), "utf8");
      await ensureRuntimeIgnores(dir);
      expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves template lines and order, appending only the missing entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-ignores-"));
    try {
      // Template already ignores one runtime entry and carries its own
      // chain-convention lines — merge must not duplicate or reorder.
      const template = "# harness scratch\nsessions/\nnode_modules/\n";
      await writeFile(join(dir, ".gitignore"), template, "utf8");
      await ensureRuntimeIgnores(dir);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content.startsWith(template)).toBe(true);
      for (const entry of RUNTIME_IGNORES) {
        expect(content).toContain(entry);
      }
      expect(content.match(/^node_modules\/$/gm)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("flume job new — real CLI on a scratch repo", () => {
  it(
    "seeds from Chain.seedDir: branch, files, merged ignores, link, baseline commit excluding runtime + junction; re-run preserves a worked file and fills a newly added stub",
    async () => {
      const repo = await makeRepo();
      try {
        await mkdir(join(repo.dir, ".flume", "job-seed"), { recursive: true });
        await writeFile(
          join(repo.dir, ".flume", "job-seed", "notes.md"),
          "seed notes\n",
        );
        await writeFile(
          join(repo.dir, ".flume", "job-seed", ".gitignore"),
          "sessions/\n",
        );
        await writeRepoChain(repo.dir, { seedDir: "job-seed" });

        const r = await runCli(repo.dir, ["job", "new", "t1"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("created branch job/t1");

        // 1. On the conventional branch, staying there (§5a-1, §5a-7).
        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "job/t1",
        );

        // 2. Verbatim seed.
        const jobDir = join(repo.dir, ".flume", "jobs", "t1");
        expect(await readFile(join(jobDir, "notes.md"), "utf8")).toBe(
          "seed notes\n",
        );

        // 3. Runtime ignores merged into the seed's .gitignore.
        const ignores = await readFile(join(jobDir, ".gitignore"), "utf8");
        expect(ignores.startsWith("sessions/\n")).toBe(true);
        for (const entry of RUNTIME_IGNORES) {
          expect(ignores).toContain(entry);
        }

        // 4. Link provisioned at node_modules/@dtmd/flume, resolving to the
        // running CLI's package root (version coherence).
        const link = join(jobDir, "node_modules", "@dtmd", "flume");
        expect(lstatSync(link).isSymbolicLink()).toBe(true);
        expect(statSync(link).isDirectory()).toBe(true);
        expect(realpathSync(link).toLowerCase()).toBe(
          realpathSync(PACKAGE_ROOT).toLowerCase(),
        );

        // 6. Baseline commit carries the harness, not the link (node_modules
        // is ignored before add), and leaves the tree clean.
        const committed = await gitOut(repo.dir, [
          "show",
          "--name-only",
          "--format=",
          "HEAD",
        ]);
        expect(committed).toContain(".flume/jobs/t1/.gitignore");
        expect(committed).toContain(".flume/jobs/t1/notes.md");
        expect(committed).not.toContain("node_modules");
        expect(await gitOut(repo.dir, ["status", "--porcelain"])).toBe("");

        // Runtime state stays invisible to git — the ignore entries at work.
        await mkdir(join(jobDir, "awake"), { recursive: true });
        await writeFile(join(jobDir, "awake", "build"), "");
        await writeFile(join(jobDir, "loop.pid"), "12345");
        await mkdir(join(jobDir, "prior-attempts"), { recursive: true });
        await writeFile(join(jobDir, "prior-attempts", "x.md"), "attempt");
        expect(await gitOut(repo.dir, ["status", "--porcelain"])).toBe("");

        // The operator works the seeded file, then a new stub is declared.
        await writeFile(join(jobDir, "notes.md"), "worked notes\n");
        await exec("git", ["add", "-A", "--", ".flume/jobs/t1"], {
          cwd: repo.dir,
        });
        await exec("git", ["commit", "-q", "-m", "job: work on notes"], {
          cwd: repo.dir,
        });
        await writeFile(
          join(repo.dir, ".flume", "job-seed", "stub.md"),
          "new stub\n",
        );

        // Re-run: branch reused, skip-existing preserves the worked file,
        // and the newly declared stub fills the gap.
        const before = await gitOut(repo.dir, ["rev-list", "--count", "HEAD"]);
        const again = await runCli(repo.dir, ["job", "new", "t1"]);
        expect(again.code).toBe(0);
        expect(again.out).toContain("reusing branch job/t1");
        expect(await gitOut(repo.dir, ["rev-list", "--count", "HEAD"])).not.toBe(
          before,
        );
        expect(await readFile(join(jobDir, "notes.md"), "utf8")).toBe(
          "worked notes\n",
        );
        expect(await readFile(join(jobDir, "stub.md"), "utf8")).toBe(
          "new stub\n",
        );
      } finally {
        await repo.cleanup();
      }
    },
    120_000,
  );

  it(
    "re-run with an unchanged seedDir commits nothing: reused branch, no new commit",
    async () => {
      const repo = await makeRepo();
      try {
        await mkdir(join(repo.dir, ".flume", "job-seed"), { recursive: true });
        await writeFile(
          join(repo.dir, ".flume", "job-seed", "notes.md"),
          "seed notes\n",
        );
        await writeRepoChain(repo.dir, { seedDir: "job-seed" });

        const first = await runCli(repo.dir, ["job", "new", "t2"]);
        expect(first.code).toBe(0);

        const before = await gitOut(repo.dir, ["rev-list", "--count", "HEAD"]);
        const again = await runCli(repo.dir, ["job", "new", "t2"]);
        expect(again.code).toBe(0);
        expect(again.out).toContain("reusing branch job/t2");
        expect(again.out).toContain("nothing to commit");
        expect(await gitOut(repo.dir, ["rev-list", "--count", "HEAD"])).toBe(
          before,
        );
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "absent seedDir seeds only the runtime .gitignore, logs no warning, and still baselines",
    async () => {
      const repo = await makeRepo();
      try {
        await writeRepoChain(repo.dir);

        const r = await runCli(repo.dir, ["job", "new", "bare"]);
        expect(r.code).toBe(0);
        expect(r.out).not.toContain("warning");

        const jobDir = join(repo.dir, ".flume", "jobs", "bare");
        const entries = (await readdir(jobDir)).sort();
        expect(entries).toEqual([".gitignore", "node_modules"]);

        const committed = await gitOut(repo.dir, [
          "show",
          "--name-only",
          "--format=",
          "HEAD",
        ]);
        expect(committed).toBe(".flume/jobs/bare/.gitignore");
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "leaves a pre-staged unrelated file staged and out of the seed commit",
    async () => {
      const repo = await makeRepo();
      try {
        await writeRepoChain(repo.dir);

        // Operator work in flight: staged before `job new` runs.
        await writeFile(join(repo.dir, "foreign.txt"), "in-flight edit\n");
        await exec("git", ["add", "foreign.txt"], { cwd: repo.dir });

        const r = await runCli(repo.dir, ["job", "new", "scoped"]);
        expect(r.code).toBe(0);

        // Seed commit carries only the harness — the foreign file is absent.
        const committed = await gitOut(repo.dir, [
          "show",
          "--name-only",
          "--format=",
          "HEAD",
        ]);
        expect(committed).toBe(".flume/jobs/scoped/.gitignore");

        // The operator's file is still staged, untouched.
        expect(await gitOut(repo.dir, ["diff", "--cached", "--name-only"])).toBe(
          "foreign.txt",
        );
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "no chain at <configDir>/chain.ts exits 2 after branching, before any state root is created",
    async () => {
      const repo = await makeRepo();
      try {
        const r = await runCli(repo.dir, ["job", "new", "nc"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("chain.ts");

        // The branch (§4 step 1) already exists — only the state root is
        // gated on the chain load (step 2): a job that could never `run`
        // must not be creatable.
        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "job/nc",
        );
        expect(existsSync(join(repo.dir, ".flume", "jobs", "nc"))).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "a declared-but-absent seedDir exits 2 after branching, before the state root is created",
    async () => {
      const repo = await makeRepo();
      try {
        await writeRepoChain(repo.dir, { seedDir: "no-such-seed" });

        const r = await runCli(repo.dir, ["job", "new", "ft"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("no-such-seed");

        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "job/ft",
        );
        expect(existsSync(join(repo.dir, ".flume", "jobs", "ft"))).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "usage errors exit 2: separator name, missing name, unknown verb, --template rejected as unknown flag",
    async () => {
      const repo = await makeRepo();
      try {
        const slash = await runCli(repo.dir, ["job", "new", "a/b"]);
        expect(slash.code).toBe(2);
        expect(slash.out).toContain("path separator");

        const backslash = await runCli(repo.dir, ["job", "new", "a\\b"]);
        expect(backslash.code).toBe(2);
        expect(backslash.out).toContain("path separator");

        // Nothing was built: no job dirs, no job/* branches (name validation
        // fails before the branch checkout).
        expect(existsSync(join(repo.dir, ".flume"))).toBe(false);
        expect(await gitOut(repo.dir, ["branch", "--list", "job/*"])).toBe("");

        const noName = await runCli(repo.dir, ["job", "new"]);
        expect(noName.code).toBe(2);
        expect(noName.out).toContain("usage: flume job new");

        // --template is gone (v0.6 §4): the CLI no longer parses it as a
        // flag, so it falls through to the two-positional-args usage error.
        const oldFlag = await runCli(repo.dir, [
          "job",
          "new",
          "ok",
          "--template",
          "somewhere",
        ]);
        expect(oldFlag.code).toBe(2);
        expect(oldFlag.out).toContain("usage: flume job new");
        expect(oldFlag.out).not.toContain("--template");

        const badVerb = await runCli(repo.dir, ["job", "frobnicate"]);
        expect(badVerb.code).toBe(2);
        expect(badVerb.out).toContain("unknown job verb: frobnicate");
      } finally {
        await repo.cleanup();
      }
    },
    120_000,
  );
});

describe("§5a-4 provisioning — no-dep-tree fixture", () => {
  it("chain load resolves @dtmd/flume through the provisioned link alone", async () => {
    // A repo with no package.json and no dependency tree anywhere up its
    // tmpdir ancestry: the ONLY way `@dtmd/flume` can resolve from chain.ts
    // is the link `job new` provisioned. The link-target seam points at a
    // fake package so the fixture doesn't depend on this checkout's dist/.
    const repo = await makeRepo();
    const fake = await mkdtemp(join(tmpdir(), "flume-fake-pkg-"));
    try {
      await writeFile(
        join(fake, "package.json"),
        JSON.stringify({
          name: "@dtmd/flume",
          version: "0.0.0-fixture",
          type: "module",
          exports: { ".": "./index.js" },
        }),
      );
      await writeFile(join(fake, "index.js"), 'export const marker = "linked";\n');

      await writeRepoChain(repo.dir);
      await jobNew({
        repoRoot: repo.dir,
        name: "ndt",
        linkTarget: fake,
        log: () => {},
      });

      const jobDir = join(repo.dir, ".flume", "jobs", "ndt");
      await writeFile(
        join(jobDir, "chain.ts"),
        `import { marker } from "@dtmd/flume";\n` +
          `export default {\n` +
          `  phases: [{\n` +
          `    name: "probe",\n` +
          `    description: marker,\n` +
          `    promptPath: "prompt.md",\n` +
          `    concurrency: "singleton",\n` +
          `    writablePaths: ["**"],\n` +
          `    gates: [],\n` +
          `    handoff: () => [],\n` +
          `  }],\n` +
          `  humanOnly: [],\n` +
          `};\n`,
      );

      const mod = await loadChainModule(join(jobDir, "chain.ts"));
      expect(mod.default.phases[0]?.description).toBe("linked");
    } finally {
      await repo.cleanup();
      await rm(fake, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses loudly when a non-link squats on the @dtmd/flume path", async () => {
    const repo = await makeRepo();
    try {
      const linkPath = join(
        repo.dir,
        ".flume",
        "jobs",
        "sq",
        "node_modules",
        "@dtmd",
        "flume",
      );
      await mkdir(linkPath, { recursive: true });
      await writeRepoChain(repo.dir);
      await expect(
        jobNew({ repoRoot: repo.dir, name: "sq", log: () => {} }),
      ).rejects.toThrow(/not a link/);
    } finally {
      await repo.cleanup();
    }
  });

  it("rejects a bad name in-process as JobUsageError before touching git", async () => {
    await expect(
      jobNew({ repoRoot: "irrelevant", name: "a/b", log: () => {} }),
    ).rejects.toBeInstanceOf(JobUsageError);
  });
});

// ---------- v0.5 §5b — `flume job run` preflight units ----------

/**
 * Minimal two-phase chain: `alpha` is `phases[0]` — the entry phase by
 * convention (decision 6) — and `beta` exists to prove the wake targets
 * position, not a name.
 */
function twoPhaseChainSrc(): string {
  const phase = (name: string) =>
    `{ name: ${JSON.stringify(name)}, description: "", promptPath: "p.md", ` +
    `concurrency: "singleton", writablePaths: ["**"], gates: [], ` +
    `handoff: () => [] }`;
  return `export default { phases: [${phase("alpha")}, ${phase("beta")}], humanOnly: [] };\n`;
}

/**
 * `job new` + a two-phase chain.ts at the repo `.flume` — the repo-resident
 * location (v0.6 §2) the CLI resolves `configDir` to; returns the job dir.
 */
async function makeRunnableJob(repoDir: string, name: string): Promise<string> {
  // The chain must exist before `jobNew` loads it (v0.6 §4/§9-7) — write it
  // first, then let `job new` seed against it (undeclared seedDir → bare).
  await mkdir(join(repoDir, ".flume"), { recursive: true });
  await writeFile(join(repoDir, ".flume", "chain.ts"), twoPhaseChainSrc(), "utf8");
  await jobNew({ repoRoot: repoDir, name, log: () => {} });
  return join(repoDir, ".flume", "jobs", name);
}

describe("jobRun preflight — §5b wake/branch-assert units", () => {
  it("errors as JobUsageError when the branch does not exist, touching neither HEAD nor the state root", async () => {
    const repo = await makeRepo();
    try {
      // The resolved shape the CLI hands in (v0.6 §3): state root in the job
      // dir, config at the repo .flume.
      const flumeDir = join(repo.dir, ".flume", "jobs", "ghost");
      const configDir = join(repo.dir, ".flume");
      await expect(
        jobRun({
          repoRoot: repo.dir,
          name: "ghost",
          flumeDir,
          configDir,
          log: () => {},
        }),
      ).rejects.toThrow(/branch job\/ghost does not exist.*flume job new ghost/);
      await expect(
        jobRun({
          repoRoot: repo.dir,
          name: "ghost",
          flumeDir,
          configDir,
          log: () => {},
        }),
      ).rejects.toBeInstanceOf(JobUsageError);

      // Nothing mutated: HEAD stays on main, no state root materialized.
      expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "main",
      );
      expect(existsSync(join(repo.dir, ".flume"))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("from hibernation, wakes exactly phases[0]; a re-run is idempotent", async () => {
    const repo = await makeRepo();
    try {
      const jobDir = await makeRunnableJob(repo.dir, "r1");
      const opts = {
        repoRoot: repo.dir,
        name: "r1",
        flumeDir: jobDir,
        configDir: join(repo.dir, ".flume"),
        log: () => {},
      };
      await jobRun(opts);
      expect(new Baton(jobDir).awake()).toEqual(["alpha"]);

      await jobRun(opts);
      expect(new Baton(jobDir).awake()).toEqual(["alpha"]);
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("leaves a non-hibernating baton untouched — mid-job resume never re-wakes the entry phase", async () => {
    const repo = await makeRepo();
    try {
      const jobDir = await makeRunnableJob(repo.dir, "r2");
      new Baton(jobDir).wake("beta");

      await jobRun({
        repoRoot: repo.dir,
        name: "r2",
        flumeDir: jobDir,
        configDir: join(repo.dir, ".flume"),
        log: () => {},
      });
      expect(new Baton(jobDir).awake()).toEqual(["beta"]);
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("checks out job/<name> when HEAD is elsewhere; no checkout when already on it", async () => {
    const repo = await makeRepo();
    try {
      const jobDir = await makeRunnableJob(repo.dir, "r3");
      await exec("git", ["checkout", "-q", "main"], { cwd: repo.dir });

      const lines: string[] = [];
      const opts = {
        repoRoot: repo.dir,
        name: "r3",
        flumeDir: jobDir,
        configDir: join(repo.dir, ".flume"),
        log: (l: string) => lines.push(l),
      };
      await jobRun(opts);
      expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "job/r3",
      );
      expect(lines.join("\n")).toContain("checked out job/r3");

      lines.length = 0;
      await jobRun(opts);
      expect(lines.join("\n")).toContain("on job/r3");
      expect(lines.join("\n")).not.toContain("checked out");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("real CLI: missing <name> and nonexistent branch both exit 2", async () => {
    const repo = await makeRepo();
    try {
      const noName = await runCli(repo.dir, ["job", "run"]);
      expect(noName.code).toBe(2);
      expect(noName.out).toContain("usage: flume job run <name> [--max N]");

      const ghost = await runCli(repo.dir, ["job", "run", "ghost"]);
      expect(ghost.code).toBe(2);
      expect(ghost.out).toContain("branch job/ghost does not exist");
      expect(ghost.out).toContain("flume job new ghost");
    } finally {
      await repo.cleanup();
    }
  }, 120_000);
});

// ---------- v0.5 §5c — `flume job rm` refusal + removal units ----------

describe("jobRm — §5c refusal + removal units", () => {
  it("refuses on a live loop.pid, touching neither dir, branch, nor history", async () => {
    const repo = await makeRepo();
    try {
      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "rm1", log: () => {} });
      const jobDir = join(repo.dir, ".flume", "jobs", "rm1");
      // The vitest worker plays the live loop — its pid is alive for the
      // duration of the call.
      await writeFile(join(jobDir, "loop.pid"), String(process.pid), "utf8");
      const before = await gitOut(repo.dir, ["rev-list", "--count", "HEAD"]);

      await expect(
        jobRm({ repoRoot: repo.dir, name: "rm1", log: () => {} }),
      ).rejects.toThrow(new RegExp(`live loop \\(pid ${process.pid}\\)`));

      expect(existsSync(join(jobDir, ".gitignore"))).toBe(true);
      expect(await readFile(join(jobDir, "loop.pid"), "utf8")).toBe(
        String(process.pid),
      );
      expect(await gitOut(repo.dir, ["rev-list", "--count", "HEAD"])).toBe(
        before,
      );
      expect(await gitOut(repo.dir, ["branch", "--list", "job/rm1"])).toContain(
        "job/rm1",
      );
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("removes tracked harness + untracked runtime, commits cleanup on job/<name>; branch, history, and link target survive; stale pid reclaimed", async () => {
    const repo = await makeRepo();
    try {
      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "rm2", log: () => {} });
      const jobDir = join(repo.dir, ".flume", "jobs", "rm2");

      // Runtime remnants a run leaves behind, plus a stale (dead-pid) lock.
      await mkdir(join(jobDir, "awake"), { recursive: true });
      await writeFile(join(jobDir, "awake", "build"), "");
      await mkdir(join(jobDir, "prior-attempts"), { recursive: true });
      await writeFile(join(jobDir, "prior-attempts", "x.md"), "attempt");
      await writeFile(join(jobDir, "loop.pid"), "999999999", "utf8");

      // rm from off-branch: the cleanup commit must land on job/rm2.
      await exec("git", ["checkout", "-q", "main"], { cwd: repo.dir });
      const mainBefore = await gitOut(repo.dir, ["rev-parse", "main"]);

      const lines: string[] = [];
      await jobRm({
        repoRoot: repo.dir,
        name: "rm2",
        log: (l: string) => lines.push(l),
      });

      // Dir gone — junction unlinked, not followed: the package root the
      // link resolved to is intact.
      expect(existsSync(jobDir)).toBe(false);
      expect(existsSync(join(PACKAGE_ROOT, "package.json"))).toBe(true);

      // Cleanup commit at the tip of job/rm2; the seed commit (history)
      // beneath it; main untouched.
      expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "job/rm2",
      );
      const subjects = await gitOut(repo.dir, ["log", "--format=%s"]);
      expect(subjects.split("\n")[0]).toBe("chore(flume): rm job rm2");
      expect(subjects).toContain("chore(flume): seed job rm2");
      expect(await gitOut(repo.dir, ["rev-parse", "main"])).toBe(mainBefore);
      expect(lines.join("\n")).toContain("cleanup commit on job/rm2");
      expect(lines.join("\n")).toContain("branch job/rm2 survives");

      // Nothing tracked under the job dir; tree clean.
      expect(
        await gitOut(repo.dir, ["ls-files", "--", ".flume/jobs/rm2"]),
      ).toBe("");
      expect(await gitOut(repo.dir, ["status", "--porcelain"])).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("leaves a pre-staged unrelated file staged and out of the cleanup commit", async () => {
    const repo = await makeRepo();
    try {
      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "rm3", log: () => {} });
      await writeFile(join(repo.dir, "foreign.txt"), "in-flight edit\n");
      await exec("git", ["add", "foreign.txt"], { cwd: repo.dir });

      await jobRm({ repoRoot: repo.dir, name: "rm3", log: () => {} });

      const committed = await gitOut(repo.dir, [
        "show",
        "--name-only",
        "--format=",
        "HEAD",
      ]);
      expect(committed).toBe(".flume/jobs/rm3/.gitignore");
      expect(await gitOut(repo.dir, ["diff", "--cached", "--name-only"])).toBe(
        "foreign.txt",
      );
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("rejects a bad name and a name that names no job as JobUsageError, touching nothing", async () => {
    await expect(
      jobRm({ repoRoot: "irrelevant", name: "a/b", log: () => {} }),
    ).rejects.toBeInstanceOf(JobUsageError);

    const repo = await makeRepo();
    try {
      await expect(
        jobRm({ repoRoot: repo.dir, name: "ghost", log: () => {} }),
      ).rejects.toThrow(/no job 'ghost'/);
      await expect(
        jobRm({ repoRoot: repo.dir, name: "ghost", log: () => {} }),
      ).rejects.toBeInstanceOf(JobUsageError);
      expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "main",
      );
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("real CLI: missing <name> and nonexistent job exit 2; live pid exits 1", async () => {
    const repo = await makeRepo();
    try {
      const noName = await runCli(repo.dir, ["job", "rm"]);
      expect(noName.code).toBe(2);
      expect(noName.out).toContain("usage: flume job rm <name>");

      const ghost = await runCli(repo.dir, ["job", "rm", "ghost"]);
      expect(ghost.code).toBe(2);
      expect(ghost.out).toContain("no job 'ghost'");

      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "rl", log: () => {} });
      await writeFile(
        join(repo.dir, ".flume", "jobs", "rl", "loop.pid"),
        String(process.pid),
        "utf8",
      );
      const live = await runCli(repo.dir, ["job", "rm", "rl"]);
      expect(live.code).toBe(1);
      expect(live.out).toContain(`live loop (pid ${process.pid})`);
    } finally {
      await repo.cleanup();
    }
  }, 120_000);
});

// ---------- v0.5 §5d — `flume job status` enumeration units ----------

/** Minimal valid pending entry (schema defaults fill the rest). */
function pendingEntry(tag: string): object {
  return {
    tag,
    summary: "a unit of work",
    per: { path: "spec/RELEASE-v0.5.md", section: "5d" },
    gate: { kind: "open" },
    files: {},
    acceptance: "suite green",
  };
}

describe("jobStatus — §5d enumeration units", () => {
  it("returns [] when .flume/jobs (or .flume itself) is absent, materializing nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-job-status-"));
    try {
      expect(jobStatus(dir)).toEqual([]);
      expect(existsSync(join(dir, ".flume"))).toBe(false);

      await mkdir(join(dir, ".flume", "jobs"), { recursive: true });
      expect(jobStatus(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("enumerates jobs sorted by name with awake phases + pending counts; skips plain files", async () => {
    // Pure filesystem convention — no git repo required to observe it.
    const dir = await mkdtemp(join(tmpdir(), "flume-job-status-"));
    try {
      const jobs = join(dir, ".flume", "jobs");

      // "beta": awake phases + a two-entry plan.
      await mkdir(join(jobs, "beta", "awake"), { recursive: true });
      await writeFile(join(jobs, "beta", "awake", "plan"), "");
      await writeFile(join(jobs, "beta", "awake", "build"), "");
      await mkdir(join(jobs, "beta", "plan"), { recursive: true });
      await writeFile(
        join(jobs, "beta", "plan", "pending.json"),
        JSON.stringify([pendingEntry("B-ONE"), pendingEntry("B-TWO")]),
      );

      // "alpha": hibernating (no awake dir), no plan yet.
      await mkdir(join(jobs, "alpha"), { recursive: true });

      // Not a job: a stray file under jobs/.
      await writeFile(join(jobs, "README.md"), "not a job\n");

      expect(jobStatus(dir)).toEqual([
        { name: "alpha", awake: [], pending: 0 },
        { name: "beta", awake: ["build", "plan"], pending: 2 },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is observational: a hibernating job gains no awake/ dir, no file anywhere changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-job-status-"));
    try {
      const jobDir = join(dir, ".flume", "jobs", "quiet");
      await mkdir(jobDir, { recursive: true });

      jobStatus(dir);

      // The Baton constructor would have mkdir'd awake/ — the read must not.
      expect(existsSync(join(jobDir, "awake"))).toBe(false);
      expect((await readdir(jobDir)).sort()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports null pending for an unparsable pending.json instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-job-status-"));
    try {
      const jobDir = join(dir, ".flume", "jobs", "broken");
      await mkdir(join(jobDir, "plan"), { recursive: true });
      await writeFile(join(jobDir, "plan", "pending.json"), "not json{");

      expect(jobStatus(dir)).toEqual([
        { name: "broken", awake: [], pending: null },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it(
    "real CLI: 'no jobs' on an empty repo; per-job lines with awake + pending; any argument exits 2",
    async () => {
      const repo = await makeRepo();
      try {
        const none = await runCli(repo.dir, ["job", "status"]);
        expect(none.code).toBe(0);
        expect(none.out).toContain("no jobs");

        await writeRepoChain(repo.dir);
        await jobNew({ repoRoot: repo.dir, name: "s1", log: () => {} });
        const jobDir = join(repo.dir, ".flume", "jobs", "s1");
        await mkdir(join(jobDir, "awake"), { recursive: true });
        await writeFile(join(jobDir, "awake", "build"), "");
        await mkdir(join(jobDir, "plan"), { recursive: true });
        await writeFile(
          join(jobDir, "plan", "pending.json"),
          JSON.stringify([pendingEntry("S-ONE")]),
        );

        const r = await runCli(repo.dir, ["job", "status"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("s1");
        expect(r.out).toContain("awake: build");
        expect(r.out).toContain("pending: 1");

        const extra = await runCli(repo.dir, ["job", "status", "s1"]);
        expect(extra.code).toBe(2);
        expect(extra.out).toContain("usage: flume job status");
      } finally {
        await repo.cleanup();
      }
    },
    120_000,
  );
});

// ---------- v0.5 §5e — `flume job extract` selection/refusal/unwind units ----------

/**
 * Extract scenario: INTAKE.md seeded on main; job "x" carrying a
 * non-harness work commit, an intake-only plan-side append, and a
 * harness-only friction/open-questions commit; main advanced past the fork
 * afterward. Ends with job/x checked out.
 */
async function makeExtractScenario(dir: string): Promise<void> {
  const opts = { cwd: dir };
  await writeFile(join(dir, "INTAKE.md"), "intake v1\n");
  await exec("git", ["add", "INTAKE.md"], opts);
  await exec("git", ["commit", "-q", "-m", "seed intake"], opts);

  await writeRepoChain(dir);
  await jobNew({ repoRoot: dir, name: "x", log: () => {} });
  const jobDir = join(dir, ".flume", "jobs", "x");

  await writeFile(join(dir, "work.txt"), "derived\n");
  await exec("git", ["add", "work.txt"], opts);
  await exec("git", ["commit", "-q", "-m", "job: add work"], opts);

  await appendFile(join(dir, "INTAKE.md"), "intake v2 (plan-side append)\n");
  await exec("git", ["add", "INTAKE.md"], opts);
  await exec("git", ["commit", "-q", "-m", "plan: append intake"], opts);

  await writeFile(join(jobDir, "friction.md"), "friction: template gap\n");
  await mkdir(join(jobDir, "plan"), { recursive: true });
  await writeFile(join(jobDir, "plan", "open-questions.md"), "q: naming?\n");
  await exec("git", ["add", ".flume/jobs/x"], opts);
  await exec(
    "git",
    ["commit", "-q", "-m", "chore(flume): friction + questions"],
    opts,
  );

  await exec("git", ["checkout", "-q", "main"], opts);
  await writeFile(join(dir, "mainline.txt"), "main advanced\n");
  await exec("git", ["add", "mainline.txt"], opts);
  await exec("git", ["commit", "-q", "-m", "main: advance"], opts);
  await exec("git", ["checkout", "-q", "job/x"], opts);
}

describe("jobExtract — §5e selection/refusal/unwind units", () => {
  it("forks off --onto, ships intake first, cherry-picks only non-harness commits oldest-first, harvests, and consumes the job", async () => {
    const repo = await makeRepo();
    try {
      await makeExtractScenario(repo.dir);
      const result = await jobExtract({
        repoRoot: repo.dir,
        name: "x",
        onto: "main",
        intake: ["INTAKE.md"],
        log: () => {},
      });

      // On the clean branch, forked off main's ADVANCED tip (throws if
      // main is not an ancestor of x).
      expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "x",
      );
      await exec("git", ["merge-base", "--is-ancestor", "main", "x"], {
        cwd: repo.dir,
      });

      // Intake commit first, then the work commit — the harness-only and
      // intake-only job commits were never picked.
      const subjects = (
        await gitOut(repo.dir, ["log", "--reverse", "--format=%s", "main..x"])
      ).split("\n");
      expect(subjects).toEqual([
        "intake: pass-through from job/x",
        "job: add work",
      ]);
      expect(result.picked).toBe(1);
      expect(result.intakeCommitted).toBe(true);

      // Intake synced to the job tip; work present; no harness tracked.
      expect(await readFile(join(repo.dir, "INTAKE.md"), "utf8")).toBe(
        "intake v1\nintake v2 (plan-side append)\n",
      );
      expect(await readFile(join(repo.dir, "work.txt"), "utf8")).toBe(
        "derived\n",
      );
      // No job harness on the clean branch; the repo chain survives the
      // consumed job (§2) — it was part of the base, not the job.
      expect(await gitOut(repo.dir, ["ls-files", "--", ".flume/jobs"])).toBe(
        "",
      );
      expect(
        await gitOut(repo.dir, ["ls-files", "--", ".flume/chain.ts"]),
      ).toBe(".flume/chain.ts");

      // Harvest came off the branch (git show), not the worktree.
      expect(result.harvest).toEqual([
        { path: "friction.md", content: "friction: template gap\n" },
        { path: "plan/open-questions.md", content: "q: naming?\n" },
      ]);

      // Consumed: job branch + dir gone; tree clean.
      expect(await gitOut(repo.dir, ["branch", "--list", "job/x"])).toBe("");
      expect(existsSync(join(repo.dir, ".flume", "jobs", "x"))).toBe(false);
      expect(await gitOut(repo.dir, ["status", "--porcelain"])).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, 120_000);

  it("with no intake and no harvest files: no intake commit, null harvest entries", async () => {
    const repo = await makeRepo();
    try {
      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "y", log: () => {} });
      await writeFile(join(repo.dir, "work.txt"), "derived\n");
      await exec("git", ["add", "work.txt"], { cwd: repo.dir });
      await exec("git", ["commit", "-q", "-m", "job: add work"], {
        cwd: repo.dir,
      });

      const result = await jobExtract({
        repoRoot: repo.dir,
        name: "y",
        onto: "main",
        log: () => {},
      });
      expect(result.picked).toBe(1);
      expect(result.intakeCommitted).toBe(false);
      expect(result.harvest).toEqual([
        { path: "friction.md", content: null },
        { path: "plan/open-questions.md", content: null },
      ]);
      const subjects = (
        await gitOut(repo.dir, ["log", "--reverse", "--format=%s", "main..y"])
      ).split("\n");
      expect(subjects).toEqual(["job: add work"]);
    } finally {
      await repo.cleanup();
    }
  }, 120_000);

  it("refuses clobber, dirty tracked tree, and a live loop — each leaving the job untouched", async () => {
    const repo = await makeRepo();
    try {
      await makeExtractScenario(repo.dir);
      const jobTip = await gitOut(repo.dir, ["rev-parse", "job/x"]);

      // Clobber (§5e-1): a pre-existing branch named like the job.
      await exec("git", ["branch", "x"], { cwd: repo.dir });
      const cleanTip = await gitOut(repo.dir, ["rev-parse", "x"]);
      await expect(
        jobExtract({ repoRoot: repo.dir, name: "x", onto: "main", log: () => {} }),
      ).rejects.toThrow(/already exists/);
      expect(await gitOut(repo.dir, ["rev-parse", "x"])).toBe(cleanTip);
      await exec("git", ["branch", "-D", "x"], { cwd: repo.dir });

      // Dirty tracked tree.
      await appendFile(join(repo.dir, "README.md"), "in-flight\n");
      await expect(
        jobExtract({ repoRoot: repo.dir, name: "x", onto: "main", log: () => {} }),
      ).rejects.toThrow(/uncommitted tracked changes/);
      await exec("git", ["checkout", "-q", "--", "README.md"], {
        cwd: repo.dir,
      });

      // Live loop (mirrors §5c-1) — the vitest worker plays the loop.
      const pidPath = join(repo.dir, ".flume", "jobs", "x", "loop.pid");
      await writeFile(pidPath, String(process.pid), "utf8");
      await expect(
        jobExtract({ repoRoot: repo.dir, name: "x", onto: "main", log: () => {} }),
      ).rejects.toThrow(new RegExp(`live loop \\(pid ${process.pid}\\)`));
      await rm(pidPath);

      // Nothing was consumed by any refusal: job branch at the same tip,
      // harness intact, HEAD unmoved, no clean branch left behind.
      expect(await gitOut(repo.dir, ["rev-parse", "job/x"])).toBe(jobTip);
      expect(
        existsSync(join(repo.dir, ".flume", "jobs", "x", ".gitignore")),
      ).toBe(true);
      expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "job/x",
      );
      expect(await gitOut(repo.dir, ["branch", "--list", "x"])).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, 120_000);

  it("refuses while another worktree holds job/<name> — job + tree untouched; from inside that worktree extract succeeds", async () => {
    const repo = await makeRepo();
    try {
      await makeExtractScenario(repo.dir);
      const jobTip = await gitOut(repo.dir, ["rev-parse", "job/x"]);

      // The §6 recipe shape: step the root checkout off the branch so the
      // linked worktree can hold it.
      await exec("git", ["checkout", "-q", "main"], { cwd: repo.dir });
      const wt = join(repo.dir, ".git", "flume-jobs", "x");
      await exec("git", ["worktree", "add", wt, "job/x"], { cwd: repo.dir });

      await expect(
        jobExtract({ repoRoot: repo.dir, name: "x", onto: "main", log: () => {} }),
      ).rejects.toThrow(/checked out in another worktree/);

      // Untouched: job branch at the same tip, HEAD unmoved, no clean
      // branch forked, the holding worktree intact on the branch.
      expect(await gitOut(repo.dir, ["rev-parse", "job/x"])).toBe(jobTip);
      expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "main",
      );
      expect(await gitOut(repo.dir, ["branch", "--list", "x"])).toBe("");
      expect(await gitOut(wt, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "job/x",
      );

      // From inside the holder the guard exempts the current worktree —
      // extract runs to completion and consumes the job.
      const result = await jobExtract({
        repoRoot: wt,
        name: "x",
        onto: "main",
        intake: ["INTAKE.md"],
        log: () => {},
      });
      expect(result.picked).toBe(1);
      expect(await gitOut(wt, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("x");
      expect(await gitOut(repo.dir, ["branch", "--list", "job/x"])).toBe("");
      expect(existsSync(join(wt, ".flume", "jobs", "x"))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  }, 120_000);

  it("rejects a bad name, a missing job, and an unresolvable --onto as JobUsageError", async () => {
    await expect(
      jobExtract({ repoRoot: "irrelevant", name: "a/b", onto: "main", log: () => {} }),
    ).rejects.toBeInstanceOf(JobUsageError);

    const repo = await makeRepo();
    try {
      await expect(
        jobExtract({ repoRoot: repo.dir, name: "ghost", onto: "main", log: () => {} }),
      ).rejects.toThrow(/no job 'ghost'/);
      await expect(
        jobExtract({ repoRoot: repo.dir, name: "ghost", onto: "main", log: () => {} }),
      ).rejects.toBeInstanceOf(JobUsageError);

      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "z", log: () => {} });
      await expect(
        jobExtract({ repoRoot: repo.dir, name: "z", onto: "no-such-ref", log: () => {} }),
      ).rejects.toThrow(/--onto 'no-such-ref' does not resolve/);
      await expect(
        jobExtract({ repoRoot: repo.dir, name: "z", onto: "no-such-ref", log: () => {} }),
      ).rejects.toBeInstanceOf(JobUsageError);
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("cherry-pick conflict aborts, unwinds to the job branch, and deletes the partial branch — job intact, retryable", async () => {
    const repo = await makeRepo();
    try {
      const opts = { cwd: repo.dir };
      await writeFile(join(repo.dir, "conflict.txt"), "base\n");
      await exec("git", ["add", "conflict.txt"], opts);
      await exec("git", ["commit", "-q", "-m", "seed conflict"], opts);

      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "u", log: () => {} });
      // A good pick before the conflicting one — the unwind must roll back
      // already-applied picks too.
      await writeFile(join(repo.dir, "good.txt"), "good\n");
      await exec("git", ["add", "good.txt"], opts);
      await exec("git", ["commit", "-q", "-m", "job: good"], opts);
      await writeFile(join(repo.dir, "conflict.txt"), "job change\n");
      await exec("git", ["add", "conflict.txt"], opts);
      await exec("git", ["commit", "-q", "-m", "job: conflicting"], opts);
      const jobTip = await gitOut(repo.dir, ["rev-parse", "job/u"]);

      await exec("git", ["checkout", "-q", "main"], opts);
      await writeFile(join(repo.dir, "conflict.txt"), "main change\n");
      await exec("git", ["add", "conflict.txt"], opts);
      await exec("git", ["commit", "-q", "-m", "main: conflicting"], opts);
      await exec("git", ["checkout", "-q", "job/u"], opts);

      await expect(
        jobExtract({ repoRoot: repo.dir, name: "u", onto: "main", log: () => {} }),
      ).rejects.toThrow(/retryable/);

      // Unwound: back on the job branch at the same tip, partial branch
      // gone, no cherry-pick in flight, tree clean and job-shaped.
      expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "job/u",
      );
      expect(await gitOut(repo.dir, ["rev-parse", "job/u"])).toBe(jobTip);
      expect(await gitOut(repo.dir, ["branch", "--list", "u"])).toBe("");
      expect(existsSync(join(repo.dir, ".git", "CHERRY_PICK_HEAD"))).toBe(false);
      expect(await readFile(join(repo.dir, "conflict.txt"), "utf8")).toBe(
        "job change\n",
      );
      expect(
        existsSync(join(repo.dir, ".flume", "jobs", "u", ".gitignore")),
      ).toBe(true);
      expect(await gitOut(repo.dir, ["status", "--porcelain"])).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, 120_000);

  it("real CLI: missing name, missing --onto, dangling flag values, and a ghost job exit 2", async () => {
    const repo = await makeRepo();
    try {
      const usage =
        "usage: flume job extract <name> --onto <base> [--intake <path>]...";

      const noName = await runCli(repo.dir, ["job", "extract"]);
      expect(noName.code).toBe(2);
      expect(noName.out).toContain(usage);

      // --onto is required, never guessed (§5e).
      const noOnto = await runCli(repo.dir, ["job", "extract", "x"]);
      expect(noOnto.code).toBe(2);
      expect(noOnto.out).toContain(usage);

      const danglingOnto = await runCli(repo.dir, ["job", "extract", "x", "--onto"]);
      expect(danglingOnto.code).toBe(2);

      const danglingIntake = await runCli(repo.dir, [
        "job", "extract", "x", "--onto", "main", "--intake",
      ]);
      expect(danglingIntake.code).toBe(2);

      const ghost = await runCli(repo.dir, [
        "job", "extract", "ghost", "--onto", "main",
      ]);
      expect(ghost.code).toBe(2);
      expect(ghost.out).toContain("no job 'ghost'");
    } finally {
      await repo.cleanup();
    }
  }, 120_000);
});

// win32 lane (v0.4 §6): the junction + longpaths paths only exist on
// Windows hosts — assert them where they can actually run.
describe.runIf(process.platform === "win32")(
  "§5a win32 lane — junction + core.longpaths",
  () => {
    it("provisions a junction and pins core.longpaths repo-locally, idempotently", async () => {
      const repo = await makeRepo();
      try {
        await writeRepoChain(repo.dir);
        await jobNew({ repoRoot: repo.dir, name: "w32", log: () => {} });

        // Junction: a symbolic-link-typed dirent that traverses as a dir —
        // created without admin rights, which is why win32 gets a junction
        // and not a true symlink.
        const link = join(
          repo.dir,
          ".flume",
          "jobs",
          "w32",
          "node_modules",
          "@dtmd",
          "flume",
        );
        expect(lstatSync(link).isSymbolicLink()).toBe(true);
        expect(statSync(link).isDirectory()).toBe(true);

        // Repo-local pin, not a global config mutation.
        expect(
          await gitOut(repo.dir, ["config", "--local", "--get", "core.longpaths"]),
        ).toBe("true");

        // Re-run: existing junction skipped, pin idempotent.
        await jobNew({ repoRoot: repo.dir, name: "w32", log: () => {} });
        expect(lstatSync(link).isSymbolicLink()).toBe(true);
      } finally {
        await repo.cleanup();
      }
    }, 60_000);
  },
);
