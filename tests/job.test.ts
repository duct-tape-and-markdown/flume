/**
 * v0.5 §5a / v0.6 §4 — `flume job new <name>`: a job is a branch plus a
 * state root, both named by convention, seeded from the repo chain's
 * declared `Chain.seedDir` (no more `--template`). The suite runs against
 * scratch git repos: seeding, ignore-ensure idempotence, baseline-commit
 * hygiene, and name validation. Job-dir `@dtmd/flume` link provisioning is
 * removed (v0.9 §3): a bay-resolution fixture proves a job chain's
 * `import "@dtmd/flume"` resolves through the bay's own `node_modules`, with
 * no per-job link involved.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  ensureRuntimeIgnores,
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
import { gitOut, runCli } from "./helpers/subprocess.ts";

const exec = promisify(execFile);

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

/** Minimal valid chain, no `seedDir` declared — the chain-load precondition `jobNew` enforces (v0.6 §4/§9-7): a chainless repo cannot create a job. */
const MINIMAL_CHAIN_SRC =
  `export default () => ({ chain: {\n` +
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
  `} });\n`;

/**
 * Commit the repo chain at `<repoDir>/.flume/chain.ts` — repo-resident
 * (v0.6 §2), so it rides every branch. Every `jobNew` call now requires this
 * to exist; pass `seedDir` to exercise the v0.6 §4 seed path (any seed
 * content under `.flume/` written before this call rides the same commit).
 */
async function writeRepoChain(
  repoDir: string,
  opts: { seedDir?: string; friction?: string } = {},
): Promise<void> {
  await mkdir(join(repoDir, ".flume"), { recursive: true });
  let src = MINIMAL_CHAIN_SRC;
  if (opts.seedDir !== undefined) {
    src = src.replace(
      "humanOnly: [],",
      `humanOnly: [],\n  seedDir: ${JSON.stringify(opts.seedDir)},`,
    );
  }
  if (opts.friction !== undefined) {
    src = src.replace(
      "humanOnly: [],",
      `humanOnly: [],\n  friction: ${JSON.stringify(opts.friction)},`,
    );
  }
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
      expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
      for (const entry of RUNTIME_IGNORES) {
        expect(content).toContain(entry);
      }
      expect(content.match(/^node_modules\/$/gm)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("folds caller-supplied extra entries (a declared friction dir, §3) alongside RUNTIME_IGNORES into a fresh .gitignore", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-ignores-"));
    try {
      await ensureRuntimeIgnores(dir, ["friction/"]);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content).toBe([...RUNTIME_IGNORES, "friction/"].join("\n") + "\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent with extra entries: a second run with the same extra list leaves the file byte-identical", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-ignores-"));
    try {
      await ensureRuntimeIgnores(dir, ["friction/"]);
      const first = await readFile(join(dir, ".gitignore"), "utf8");
      await ensureRuntimeIgnores(dir, ["friction/"]);
      expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not duplicate an extra entry already present in a template, and preserves the template verbatim", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-ignores-"));
    try {
      const template = "# harness scratch\nfriction/\n";
      await writeFile(join(dir, ".gitignore"), template, "utf8");
      await ensureRuntimeIgnores(dir, ["friction/"]);
      const content = await readFile(join(dir, ".gitignore"), "utf8");
      expect(content.startsWith(template)).toBe(true);
      expect(content.match(/^friction\/$/gm)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("flume job new — real CLI on a scratch repo", () => {
  it(
    "seeds from Chain.seedDir: files, merged ignores, no node_modules planted, baseline commit excluding runtime state; re-run preserves a worked file and fills a newly added stub",
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
        expect(r.out).toContain("baseline commit on current HEAD");

        // 1. No branch created — HEAD stays on whatever the operator started
        // on (v0.11 §2/§3).
        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "main",
        );

        // 2. Verbatim seed.
        const jobDir = join(repo.dir, ".flume", "jobs", "t1");
        expect(await readFile(join(jobDir, "notes.md"), "utf8")).toBe(
          "seed notes\n",
        );

        // 3. Runtime ignores merged into the seed's .gitignore.
        const ignores = await readFile(join(jobDir, ".gitignore"), "utf8");
        expect(ignores.startsWith("sessions/\n")).toBe(true);
        expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
        for (const entry of RUNTIME_IGNORES) {
          expect(ignores).toContain(entry);
        }

        // 4. No node_modules planted under the job dir (v0.9 §3): a job
        // chain's `@dtmd/flume` import resolves via the bay's own install,
        // not a provisioned link.
        expect(existsSync(join(jobDir, "node_modules"))).toBe(false);

        // 5. Baseline commit carries the harness (node_modules never exists,
        // so it can't ride along), and leaves the tree clean.
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

        // Re-run: skip-existing preserves the worked file, and the newly
        // declared stub fills the gap.
        const before = await gitOut(repo.dir, ["rev-list", "--count", "HEAD"]);
        const again = await runCli(repo.dir, ["job", "new", "t1"]);
        expect(again.code).toBe(0);
        expect(again.out).toContain("baseline commit on current HEAD");
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
    "re-run with an unchanged seedDir commits nothing",
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
        expect(entries).toEqual([".gitignore"]);

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
    "no chain at <configDir>/chain.ts exits 2 before any state root is created, HEAD untouched",
    async () => {
      const repo = await makeRepo();
      try {
        const r = await runCli(repo.dir, ["job", "new", "nc"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("chain.ts");

        // Nothing mutated: no branch, no state root — a job that could
        // never `run` must not be creatable.
        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "main",
        );
        expect(existsSync(join(repo.dir, ".flume", "jobs", "nc"))).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "a declared-but-absent seedDir exits 2 before the state root is created, HEAD untouched",
    async () => {
      const repo = await makeRepo();
      try {
        await writeRepoChain(repo.dir, { seedDir: "no-such-seed" });

        const r = await runCli(repo.dir, ["job", "new", "ft"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("no-such-seed");

        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "main",
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
        // fails before any mutation).
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

describe('jobNew/jobRm — commitMessage override (engine-boundary.md "Capability vs convention")', () => {
  it("a commitMessage override lands verbatim on jobNew's seed commit, receiving the job name", async () => {
    const repo = await makeRepo();
    try {
      await writeRepoChain(repo.dir);
      await jobNew({
        repoRoot: repo.dir,
        name: "cm1",
        log: () => {},
        commitMessage: (name) => `custom: seeded ${name}`,
      });

      const subjects = await gitOut(repo.dir, ["log", "--format=%s"]);
      expect(subjects.split("\n")[0]).toBe("custom: seeded cm1");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("omitting commitMessage reproduces jobNew's exact default seed-commit text", async () => {
    const repo = await makeRepo();
    try {
      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "cm2", log: () => {} });

      const subjects = await gitOut(repo.dir, ["log", "--format=%s"]);
      expect(subjects.split("\n")[0]).toBe("chore(flume): seed job cm2");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("a commitMessage override lands verbatim on jobRm's cleanup commit, receiving the job name", async () => {
    const repo = await makeRepo();
    try {
      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "cm3", log: () => {} });
      await jobRm({
        repoRoot: repo.dir,
        name: "cm3",
        log: () => {},
        commitMessage: (name) => `custom: removed ${name}`,
      });

      const subjects = await gitOut(repo.dir, ["log", "--format=%s"]);
      expect(subjects.split("\n")[0]).toBe("custom: removed cm3");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("omitting commitMessage reproduces jobRm's exact default cleanup-commit text", async () => {
    const repo = await makeRepo();
    try {
      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "cm4", log: () => {} });
      await jobRm({ repoRoot: repo.dir, name: "cm4", log: () => {} });

      const subjects = await gitOut(repo.dir, ["log", "--format=%s"]);
      expect(subjects.split("\n")[0]).toBe("chore(flume): rm job cm4");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);
});

describe("flume job new — Chain.friction pass-through (§3)", () => {
  it(
    "a declared friction dir lands in a fresh job's .gitignore, forward-slashed and single-trailing-slashed",
    async () => {
      const repo = await makeRepo();
      try {
        // Backslash + trailing-slash-free in the declaration — the ignore
        // line must normalize regardless of how the chain wrote it.
        await writeRepoChain(repo.dir, { friction: "notes\\loop" });

        const r = await runCli(repo.dir, ["job", "new", "f1"]);
        expect(r.code).toBe(0);

        const jobDir = join(repo.dir, ".flume", "jobs", "f1");
        const ignores = await readFile(join(jobDir, ".gitignore"), "utf8");
        expect(ignores.match(/^notes\/loop\/$/gm)).toHaveLength(1);
        expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
        for (const entry of RUNTIME_IGNORES) {
          expect(ignores).toContain(entry);
        }
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "re-run with an unchanged declared friction dir is idempotent: no duplicate line, no new commit",
    async () => {
      const repo = await makeRepo();
      try {
        await writeRepoChain(repo.dir, { friction: "friction" });

        const first = await runCli(repo.dir, ["job", "new", "f2"]);
        expect(first.code).toBe(0);

        const jobDir = join(repo.dir, ".flume", "jobs", "f2");
        const before = await readFile(join(jobDir, ".gitignore"), "utf8");
        const beforeRev = await gitOut(repo.dir, [
          "rev-list",
          "--count",
          "HEAD",
        ]);

        const again = await runCli(repo.dir, ["job", "new", "f2"]);
        expect(again.code).toBe(0);
        expect(again.out).toContain("nothing to commit");

        expect(await readFile(join(jobDir, ".gitignore"), "utf8")).toBe(
          before,
        );
        expect(await gitOut(repo.dir, ["rev-list", "--count", "HEAD"])).toBe(
          beforeRev,
        );
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "preserves the seedDir's template-authored .gitignore lines and order when a friction dir is also declared",
    async () => {
      const repo = await makeRepo();
      try {
        await mkdir(join(repo.dir, ".flume", "job-seed"), { recursive: true });
        await writeFile(
          join(repo.dir, ".flume", "job-seed", ".gitignore"),
          "# operator note\nsessions/\n",
          "utf8",
        );
        await writeRepoChain(repo.dir, {
          seedDir: "job-seed",
          friction: "friction",
        });

        const r = await runCli(repo.dir, ["job", "new", "f3"]);
        expect(r.code).toBe(0);

        const jobDir = join(repo.dir, ".flume", "jobs", "f3");
        const ignores = await readFile(join(jobDir, ".gitignore"), "utf8");
        expect(ignores.startsWith("# operator note\nsessions/\n")).toBe(true);
        expect(ignores.match(/^friction\/$/gm)).toHaveLength(1);
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "an undeclared friction field leaves a fresh job's .gitignore at exactly RUNTIME_IGNORES — no extra line",
    async () => {
      const repo = await makeRepo();
      try {
        await writeRepoChain(repo.dir);

        const r = await runCli(repo.dir, ["job", "new", "f4"]);
        expect(r.code).toBe(0);

        const jobDir = join(repo.dir, ".flume", "jobs", "f4");
        const ignores = await readFile(join(jobDir, ".gitignore"), "utf8");
        expect(ignores).toBe(RUNTIME_IGNORES.join("\n") + "\n");
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );
});

describe("§3 job-dir link provisioning removed — bay resolution", () => {
  it("plants no node_modules under the job dir", async () => {
    const repo = await makeRepo();
    try {
      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "nolink", log: () => {} });
      const jobDir = join(repo.dir, ".flume", "jobs", "nolink");
      expect(existsSync(join(jobDir, "node_modules"))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  });

  it('a job chain\'s `import "@dtmd/flume"` resolves through the bay\'s own node_modules, with no per-job link involved', async () => {
    const repo = await makeRepo();
    try {
      // The bay's own install (v0.9 §3) — the only place resolution can
      // reach, since `job new` provisions no per-job node_modules.
      const pkgDir = join(repo.dir, "node_modules", "@dtmd", "flume");
      await mkdir(pkgDir, { recursive: true });
      await writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@dtmd/flume",
          version: "0.0.0-fixture",
          type: "module",
          exports: { ".": "./index.js" },
        }),
      );
      const indexPath = join(pkgDir, "index.js");
      // Self-reports its own resolved path, so the assertion below proves
      // *where* Node resolved the import from, not merely that it succeeded.
      await writeFile(
        indexPath,
        `import { fileURLToPath } from "node:url";\n` +
          `export const resolvedFrom = fileURLToPath(import.meta.url);\n`,
      );

      await writeRepoChain(repo.dir);
      await jobNew({ repoRoot: repo.dir, name: "bay", log: () => {} });

      const jobDir = join(repo.dir, ".flume", "jobs", "bay");
      expect(existsSync(join(jobDir, "node_modules"))).toBe(false);
      await writeFile(
        join(jobDir, "chain.ts"),
        `import { resolvedFrom } from "@dtmd/flume";\n` +
          `export default () => ({ chain: {\n` +
          `  phases: [{\n` +
          `    name: "probe",\n` +
          `    description: resolvedFrom,\n` +
          `    promptPath: "prompt.md",\n` +
          `    concurrency: "singleton",\n` +
          `    writablePaths: ["**"],\n` +
          `    gates: [],\n` +
          `    handoff: () => [],\n` +
          `  }],\n` +
          `  humanOnly: [],\n` +
          `} });\n`,
      );

      const mod = await loadChainModule(join(jobDir, "chain.ts"));
      expect(mod.chain.phases[0]?.description.toLowerCase()).toBe(
        indexPath.toLowerCase(),
      );
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

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
  return `export default () => ({ chain: { phases: [${phase("alpha")}, ${phase("beta")}], humanOnly: [] } });\n`;
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

describe("jobRun preflight — §5b wake units (branch grammar retired, v0.11 §2/§3)", () => {
  it("from hibernation, wakes exactly phases[0]; a re-run is idempotent", async () => {
    const repo = await makeRepo();
    try {
      const jobDir = await makeRunnableJob(repo.dir, "r1");
      const opts = {
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

  it("wakes the entry phase regardless of which branch HEAD is on — no branch asserted or checked out", async () => {
    const repo = await makeRepo();
    try {
      const jobDir = await makeRunnableJob(repo.dir, "r3");
      await exec("git", ["checkout", "-q", "-b", "feature"], { cwd: repo.dir });

      const lines: string[] = [];
      await jobRun({
        name: "r3",
        flumeDir: jobDir,
        configDir: join(repo.dir, ".flume"),
        log: (l: string) => lines.push(l),
      });
      expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "feature",
      );
      expect(lines.join("\n")).not.toContain("checked out");
      expect(new Baton(jobDir).awake()).toEqual(["alpha"]);
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("no existence check: wakes the entry phase for a name never seeded by `job new`", async () => {
    const repo = await makeRepo();
    try {
      await mkdir(join(repo.dir, ".flume"), { recursive: true });
      await writeFile(
        join(repo.dir, ".flume", "chain.ts"),
        twoPhaseChainSrc(),
        "utf8",
      );
      const flumeDir = join(repo.dir, ".flume", "jobs", "ghost");

      await jobRun({
        name: "ghost",
        flumeDir,
        configDir: join(repo.dir, ".flume"),
        log: () => {},
      });
      expect(new Baton(flumeDir).awake()).toEqual(["alpha"]);
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("real CLI: missing <name> exits 2", async () => {
    const repo = await makeRepo();
    try {
      const noName = await runCli(repo.dir, ["job", "run"]);
      expect(noName.code).toBe(2);
      expect(noName.out).toContain("usage: flume job run <name> [--max N]");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);
});

// ---------- v0.5 §5c — `flume job rm` refusal + removal units ----------

describe("jobRm — §5c refusal + removal units", () => {
  it("refuses on a live loop.pid, touching neither dir nor history", async () => {
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
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("removes tracked harness + untracked runtime, commits cleanup on the current HEAD; history survives; stale pid reclaimed", async () => {
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

      const lines: string[] = [];
      await jobRm({
        repoRoot: repo.dir,
        name: "rm2",
        log: (l: string) => lines.push(l),
      });

      // Dir gone.
      expect(existsSync(jobDir)).toBe(false);

      // Cleanup commit at the tip of HEAD; the seed commit (history) beneath
      // it. No branch was ever created or touched.
      expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "main",
      );
      const subjects = await gitOut(repo.dir, ["log", "--format=%s"]);
      expect(subjects.split("\n")[0]).toBe("chore(flume): rm job rm2");
      expect(subjects).toContain("chore(flume): seed job rm2");
      expect(lines.join("\n")).toContain("cleanup commit on current HEAD");

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

  it("§6 (v0.6.2): a supplied frictionDir counts files under <jobdir>/<frictionDir>, per job", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-job-status-"));
    try {
      const jobs = join(dir, ".flume", "jobs");
      await mkdir(join(jobs, "alpha", "friction"), { recursive: true });
      await writeFile(join(jobs, "alpha", "friction", "a.md"), "x\n");
      await writeFile(join(jobs, "alpha", "friction", "b.md"), "y\n");
      // "beta" declares no friction files of its own — dir absent.
      await mkdir(join(jobs, "beta"), { recursive: true });

      expect(jobStatus(dir, "friction")).toEqual([
        { name: "alpha", awake: [], pending: 0, frictionCount: 2 },
        { name: "beta", awake: [], pending: 0, frictionCount: 0 },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("omits frictionCount entirely when no frictionDir is supplied", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-job-status-"));
    try {
      const jobs = join(dir, ".flume", "jobs");
      await mkdir(join(jobs, "alpha", "friction"), { recursive: true });
      await writeFile(join(jobs, "alpha", "friction", "a.md"), "x\n");

      const rows = jobStatus(dir);
      expect(rows).toEqual([{ name: "alpha", awake: [], pending: 0 }]);
      expect("frictionCount" in rows[0]!).toBe(false);
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

// win32 lane (v0.4 §6): the core.longpaths pin only exists on Windows
// hosts — assert it where it can actually run.
describe.runIf(process.platform === "win32")(
  "§5a win32 lane — core.longpaths",
  () => {
    it("pins core.longpaths repo-locally, idempotently", async () => {
      const repo = await makeRepo();
      try {
        await writeRepoChain(repo.dir);
        await jobNew({ repoRoot: repo.dir, name: "w32", log: () => {} });

        // Repo-local pin, not a global config mutation.
        expect(
          await gitOut(repo.dir, ["config", "--local", "--get", "core.longpaths"]),
        ).toBe("true");

        // Re-run: pin idempotent.
        await jobNew({ repoRoot: repo.dir, name: "w32", log: () => {} });
        expect(
          await gitOut(repo.dir, ["config", "--local", "--get", "core.longpaths"]),
        ).toBe("true");
      } finally {
        await repo.cleanup();
      }
    }, 60_000);
  },
);

describe.runIf(process.platform === "win32")(
  "jobStatus frictionCount — win32 total-path limit (FRICTIONCOUNT-WIN32-PATH-TOTAL-LIMIT)",
  () => {
    it("resolves a real count when frictionDir nests past win32's ~260-char limit", async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-job-status-w32-"));
      try {
        const jobs = join(dir, ".flume", "jobs");
        // Same deep-friction shape as the Dispatcher.ts win32 suites
        // (WRITEREVERTNOTE-WIN32-PATH-TOTAL-LIMIT et al., tests/Dispatcher.test.ts):
        // <jobDir>/<frictionDir> alone clears win32's ~260-char total-path
        // limit.
        const deepFriction = join(
          "friction",
          ...Array.from({ length: 6 }, (_, i) => `seg-${i}-`.padEnd(50, "x")),
        );
        const frictionDir = join(jobs, "alpha", deepFriction);
        await mkdir(frictionDir, { recursive: true });
        await writeFile(join(frictionDir, "a.md"), "x\n");
        await writeFile(join(frictionDir, "b.md"), "y\n");

        expect(frictionDir.length).toBeGreaterThan(260);
        expect(jobStatus(dir, deepFriction)).toEqual([
          { name: "alpha", awake: [], pending: 0, frictionCount: 2 },
        ]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  },
);
