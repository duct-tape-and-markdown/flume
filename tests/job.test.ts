/**
 * v0.5 §5a — `flume job new <name> [--template <dir>]`: a job is a branch
 * plus a state root, both named by convention. The suite runs against
 * scratch git repos: seeding, ignore-ensure idempotence, link provisioning
 * (junction on win32), baseline-commit hygiene, and name validation. The
 * no-dep-tree fixture proves the provisioned link is what resolves
 * `@dtmd/flume` at chain load — the version-coherence claim (§5a-4).
 */

import { execFile } from "node:child_process";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  ensureRuntimeIgnores,
  jobNew,
  JobUsageError,
  RUNTIME_IGNORES,
  validateJobName,
} from "../src/job.ts";
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
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function gitOut(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
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
    "seeds from a template: branch, files, merged ignores, link, baseline commit excluding runtime + junction; re-run is idempotent",
    async () => {
      const repo = await makeRepo();
      const tpl = await mkdtemp(join(tmpdir(), "flume-tpl-"));
      try {
        await mkdir(join(tpl, "prompts"), { recursive: true });
        await writeFile(join(tpl, "chain.ts"), "// template chain\n");
        await writeFile(join(tpl, "prompts", "build.md"), "template prompt\n");
        await writeFile(join(tpl, ".gitignore"), "sessions/\n");

        const r = await runCli(repo.dir, ["job", "new", "t1", "--template", tpl]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("created branch job/t1");

        // 1. On the conventional branch, staying there (§5a-1, §5a-7).
        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "job/t1",
        );

        // 2. Verbatim seed.
        const jobDir = join(repo.dir, ".flume", "jobs", "t1");
        expect(await readFile(join(jobDir, "chain.ts"), "utf8")).toBe(
          "// template chain\n",
        );
        expect(existsSync(join(jobDir, "prompts", "build.md"))).toBe(true);

        // 3. Runtime ignores merged into the template's .gitignore.
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
        expect(committed).toContain(".flume/jobs/t1/chain.ts");
        expect(committed).toContain(".flume/jobs/t1/prompts/build.md");
        expect(committed).not.toContain("node_modules");
        expect(await gitOut(repo.dir, ["status", "--porcelain"])).toBe("");

        // Runtime state stays invisible to git — the ignore entries at work.
        await mkdir(join(jobDir, "awake"), { recursive: true });
        await writeFile(join(jobDir, "awake", "build"), "");
        await writeFile(join(jobDir, "loop.pid"), "12345");
        await mkdir(join(jobDir, "prior-attempts"), { recursive: true });
        await writeFile(join(jobDir, "prior-attempts", "x.md"), "attempt");
        expect(await gitOut(repo.dir, ["status", "--porcelain"])).toBe("");

        // Re-run: branch reused, nothing re-committed, ignores unchanged.
        const before = await gitOut(repo.dir, ["rev-list", "--count", "HEAD"]);
        const again = await runCli(repo.dir, [
          "job",
          "new",
          "t1",
          "--template",
          tpl,
        ]);
        expect(again.code).toBe(0);
        expect(again.out).toContain("reusing branch job/t1");
        expect(again.out).toContain("nothing to commit");
        expect(await gitOut(repo.dir, ["rev-list", "--count", "HEAD"])).toBe(
          before,
        );
        expect(await readFile(join(jobDir, ".gitignore"), "utf8")).toBe(ignores);
      } finally {
        await repo.cleanup();
        await rm(tpl, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it(
    "template-less new warns, seeds only the runtime .gitignore, and still baselines",
    async () => {
      const repo = await makeRepo();
      try {
        const r = await runCli(repo.dir, ["job", "new", "bare"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("warning");
        expect(r.out).toContain("populate");

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
    "--template pointing at a file exits 2; no branch or dir is created",
    async () => {
      const repo = await makeRepo();
      try {
        const file = join(repo.dir, "tpl-as-file");
        await writeFile(file, "exists, but is no directory\n");

        const r = await runCli(repo.dir, ["job", "new", "ft", "--template", file]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("--template is not a directory");

        expect(existsSync(join(repo.dir, ".flume"))).toBe(false);
        expect(await gitOut(repo.dir, ["branch", "--list", "job/*"])).toBe("");
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "usage errors exit 2 before any dir or branch is constructed: separator name, missing name, missing template dir, unknown verb",
    async () => {
      const repo = await makeRepo();
      try {
        const slash = await runCli(repo.dir, ["job", "new", "a/b"]);
        expect(slash.code).toBe(2);
        expect(slash.out).toContain("path separator");

        const backslash = await runCli(repo.dir, ["job", "new", "a\\b"]);
        expect(backslash.code).toBe(2);
        expect(backslash.out).toContain("path separator");

        // Nothing was built: no job dirs, no job/* branches.
        expect(existsSync(join(repo.dir, ".flume"))).toBe(false);
        expect(await gitOut(repo.dir, ["branch", "--list", "job/*"])).toBe("");

        const noName = await runCli(repo.dir, ["job", "new"]);
        expect(noName.code).toBe(2);
        expect(noName.out).toContain("usage: flume job new");

        const badTpl = await runCli(repo.dir, [
          "job",
          "new",
          "ok",
          "--template",
          join(repo.dir, "no-such-dir"),
        ]);
        expect(badTpl.code).toBe(2);
        expect(badTpl.out).toContain("--template dir not found");

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

// win32 lane (v0.4 §6): the junction + longpaths paths only exist on
// Windows hosts — assert them where they can actually run.
describe.runIf(process.platform === "win32")(
  "§5a win32 lane — junction + core.longpaths",
  () => {
    it("provisions a junction and pins core.longpaths repo-locally, idempotently", async () => {
      const repo = await makeRepo();
      try {
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
