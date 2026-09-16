/**
 * `flume job new` → `flume job run` end-to-end on a
 * scratch repo. Branch grammar is retired: `job new` builds the state root
 * on whatever branch is current and touches no branch; `job run` wakes the
 * entry phase and loops there, asserting nothing about HEAD. The run path is
 * the standard loop under the job resolution: same `loop.pid` lock, same
 * one-child-per-tick supervisor, same exit codes as `flume loop`. Running
 * jobs hot simultaneously is now the operator's `git worktree add` on a
 * branch they create by hand — out of scope here.
 *
 * Chain residency: the chain + prompts are committed at the repo
 * `.flume/` — one chain per `.flume`, tracked — and job dirs stay thin
 * (state only, no chain shims).
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { exec, gitOut, runCli } from "./helpers/subprocess.ts";

/** Scratch git repo on `main` with one seed commit. */
async function makeRepo(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkTempDir("flume-job-run-");
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", "main"], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  // Keep the host's autocrlf from rewriting checkouts.
  await exec("git", ["config", "core.autocrlf", "false"], opts);
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Commit a chain + prompt at `<repo>/.flume/` — the repo-resident config
 *, tracked so every branch (and every linked worktree's checkout)
 * carries it. `promptPath` is a configDir-relative join into the sibling
 * `prompts/` dir — the shared-prompt shape.
 */
async function commitRepoConfig(
  dir: string,
  chainSrc: string,
  promptContent = "job run probe prompt\n",
): Promise<void> {
  await mkdir(join(dir, ".flume", "prompts"), { recursive: true });
  await writeFile(join(dir, ".flume", "chain.ts"), chainSrc, "utf8");
  await writeFile(join(dir, ".flume", "prompts", "prompt.md"), promptContent, "utf8");
  await exec("git", ["add", ".flume"], { cwd: dir });
  await exec("git", ["commit", "-q", "-m", "chore: repo-resident chain"], {
    cwd: dir,
  });
}

/**
 * Repo chain: one singleton entry phase whose agent records the
 * FLUME_DIR / FLUME_CONFIG_DIR / FLUME_JOB it observes *inside the child
 * tick process* to `<FLUME_DIR>/observed-env.json`, commits nothing, and
 * hands off to nobody — so one tick runs, then the baton hibernates and the
 * supervisor stops. What lands in the file is exactly what the child
 * inherited across the run → loop → tick boundary.
 */
const PROBE_CHAIN_SRC =
  `import { writeFileSync } from "node:fs";\n` +
  `import { join } from "node:path";\n` +
  `export default () => ({ chain: {\n` +
  `  phases: [{\n` +
  `    name: "probe",\n` +
  `    description: "job run probe",\n` +
  `    promptPath: "prompts/prompt.md",\n` +
  `    concurrency: "singleton",\n` +
  `    writablePaths: ["**"],\n` +
  `    gates: [],\n` +
  `    handoff: () => [],\n` +
  `  }],\n` +
  `  humanOnly: [],\n` +
  `},\n` +
  `agent: {\n` +
  `  name: "job-run-probe",\n` +
  `  async invoke() {\n` +
  `    writeFileSync(\n` +
  `      join(process.env.FLUME_DIR ?? "", "observed-env.json"),\n` +
  `      JSON.stringify({\n` +
  `        FLUME_DIR: process.env.FLUME_DIR,\n` +
  `        FLUME_CONFIG_DIR: process.env.FLUME_CONFIG_DIR,\n` +
  `        FLUME_JOB: process.env.FLUME_JOB,\n` +
  `      }),\n` +
  `    );\n` +
  `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
  `  },\n` +
  `} });\n`;

describe("integration — job new → job run", () => {
  it(
    "new creates a thin job on the current branch, run loads the repo chain, wakes the entry phase, ticks it, and releases the lock — no branch touched",
    async () => {
      const repo = await makeRepo();
      try {
        await commitRepoConfig(repo.dir, PROBE_CHAIN_SRC);

        const created = await runCli(repo.dir, ["job", "new", "itest"]);
        expect(created.code).toBe(0);
        // No branch created — HEAD stays where it started.
        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "main",
        );

        const jobDir = join(repo.dir, ".flume", "jobs", "itest");
        const run = await runCli(repo.dir, ["job", "run", "itest", "--max", "5"]);
        expect(run.code).toBe(0);

        // Hibernating baton → phases[0] woken. No branch assertion or
        // checkout.
        expect(run.out).toContain("woke probe (entry phase)");
        expect(run.out).not.toContain("checked out");

        // The standard supervisor ran the tick and stopped on
        // hibernation (handoff → []), well under --max.
        expect(run.out).toMatch(/tick → probe \(singleton\)/);
        expect(run.out).toContain("hibernating after 1 tick(s)");

        // The child tick observed the full job resolution via env: state
        // in the job dir, config at the repo's own .flume.
        const observed = JSON.parse(
          await readFile(join(jobDir, "observed-env.json"), "utf8"),
        ) as { FLUME_DIR: string; FLUME_CONFIG_DIR: string; FLUME_JOB: string };
        expect(observed.FLUME_DIR).toBe(jobDir);
        expect(observed.FLUME_CONFIG_DIR).toBe(join(repo.dir, ".flume"));
        expect(observed.FLUME_JOB).toBe("itest");

        // Lock taken in the job state root and dropped on exit; baton
        // hibernating after the handoff.
        expect(existsSync(join(jobDir, "loop.pid"))).toBe(false);
        expect(existsSync(join(jobDir, "awake", "probe"))).toBe(false);
        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "main",
        );

        // A second run resumes identically: baton hibernating again, so the
        // entry phase re-wakes and the loop re-runs to hibernation.
        const rerun = await runCli(repo.dir, ["job", "run", "itest", "--max", "5"]);
        expect(rerun.code).toBe(0);
        expect(rerun.out).toContain("woke probe (entry phase)");
      } finally {
        await repo.cleanup();
      }
    },
    240_000,
  );

  it(
    "run refuses while another live loop holds the job's loop.pid — the standard lock, unchanged",
    async () => {
      const repo = await makeRepo();
      try {
        await commitRepoConfig(repo.dir, PROBE_CHAIN_SRC);
        const created = await runCli(repo.dir, ["job", "new", "lk"]);
        expect(created.code).toBe(0);

        // The vitest worker plays the live prior supervisor — its pid is
        // alive for the duration of the spawned run.
        const jobDir = join(repo.dir, ".flume", "jobs", "lk");
        await writeFile(join(jobDir, "loop.pid"), String(process.pid), "utf8");

        const run = await runCli(repo.dir, ["job", "run", "lk", "--max", "0"]);
        expect(run.code).toBe(1);
        expect(run.out).toContain(`another loop (pid ${process.pid}) already runs`);
        expect(run.out).toContain("refusing");
        // The holder's pidfile survives the refused contender untouched.
        expect(await readFile(join(jobDir, "loop.pid"), "utf8")).toBe(
          String(process.pid),
        );
      } finally {
        await repo.cleanup();
      }
    },
    120_000,
  );

  it(
    "two state roots under one checkout each tick sequentially — no branch switch (a job is a state root)",
    async () => {
      const repo = await makeRepo();
      try {
        await commitRepoConfig(repo.dir, PROBE_CHAIN_SRC);

        const createdA = await runCli(repo.dir, ["job", "new", "coa"]);
        expect(createdA.code).toBe(0);
        const createdB = await runCli(repo.dir, ["job", "new", "cob"]);
        expect(createdB.code).toBe(0);

        const runA = await runCli(repo.dir, ["job", "run", "coa", "--max", "5"]);
        expect(runA.code).toBe(0);
        const runB = await runCli(repo.dir, ["job", "run", "cob", "--max", "5"]);
        expect(runB.code).toBe(0);

        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "main",
        );
        expect(
          existsSync(join(repo.dir, ".flume", "jobs", "coa", "observed-env.json")),
        ).toBe(true);
        expect(
          existsSync(join(repo.dir, ".flume", "jobs", "cob", "observed-env.json")),
        ).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    240_000,
  );
});

describe("integration — job new → job run (tick) → job rm", () => {
  it(
    "rm after a ticked run sweeps the dir and runtime remnants, commits cleanup on the current HEAD; second rm on the now-gone dir is a usage error",
    async () => {
      const repo = await makeRepo();
      try {
        await commitRepoConfig(repo.dir, PROBE_CHAIN_SRC);
        const created = await runCli(repo.dir, ["job", "new", "rme"]);
        expect(created.code).toBe(0);

        // One tick, then hibernation — leaving runtime remnants in the
        // state root. No branch is ever touched.
        const run = await runCli(repo.dir, ["job", "run", "rme", "--max", "5"]);
        expect(run.code).toBe(0);
        const jobDir = join(repo.dir, ".flume", "jobs", "rme");
        expect(existsSync(join(jobDir, "observed-env.json"))).toBe(true);

        const removed = await runCli(repo.dir, ["job", "rm", "rme"]);
        expect(removed.code).toBe(0);
        expect(removed.out).toContain("cleanup commit on current HEAD");

        // State root gone — tracked harness and untracked remnants alike.
        expect(existsSync(jobDir)).toBe(false);

        // Cleanup landed on HEAD, atop the seed commit; the tree is clean.
        expect(
          await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"]),
        ).toBe("main");
        const { stdout: subjects } = await exec(
          "git",
          ["log", "--format=%s"],
          { cwd: repo.dir },
        );
        expect(subjects.split("\n")[0]).toBe("chore(flume): rm job rme");
        expect(subjects).toContain("chore(flume): seed job rme");
        const { stdout: status } = await exec("git", ["status", "--porcelain"], {
          cwd: repo.dir,
        });
        expect(status.trim()).toBe("");

        // A job is exactly its state root — once the dir is gone,
        // there is no job left to remove, and a second rm says so.
        const again = await runCli(repo.dir, ["job", "rm", "rme"]);
        expect(again.code).toBe(2);
        expect(again.out).toContain("no job 'rme'");

        // The repo chain survives the removed job — rm sweeps only the
        // job's state root.
        expect(existsSync(join(repo.dir, ".flume", "chain.ts"))).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    240_000,
  );
});
