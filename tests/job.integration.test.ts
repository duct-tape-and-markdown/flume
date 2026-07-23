/**
 * v0.5 §5b + §6/§7 — `flume job new` → `flume job run` end-to-end on a
 * scratch repo, with the run executing INSIDE a linked worktree
 * (`git worktree add .git/flume-jobs/<name> job/<name>` — the §6 concurrency
 * recipe, so its viability is proven here per §7). The run path is the
 * standard loop under the job resolution: same `loop.pid` lock, same
 * one-child-per-tick supervisor, same exit codes as `flume loop`.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const exec = promisify(execFile);

// Run the source CLI through the project's own `tsx` (no build step) — via
// `node <tsx cli.mjs>`, not the `.bin/tsx` shim (a `.cmd` shell script on
// win32 that `execFile` cannot spawn without a shell).
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TSX_CLI = fileURLToPath(
  new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url),
);

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
  const dir = await mkdtemp(join(tmpdir(), "flume-job-run-"));
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

/**
 * Template chain: one singleton entry phase whose agent records the
 * FLUME_DIR / FLUME_CONFIG_DIR / FLUME_JOB it observes *inside the child
 * tick process* to `<FLUME_DIR>/observed-env.json`, commits nothing, and
 * hands off to nobody — so one tick runs, then the baton hibernates and the
 * supervisor stops. What lands in the file is exactly what the child
 * inherited across the run → loop → tick boundary.
 */
const PROBE_CHAIN_SRC =
  `import { writeFileSync } from "node:fs";\n` +
  `import { join } from "node:path";\n` +
  `export default {\n` +
  `  phases: [{\n` +
  `    name: "probe",\n` +
  `    description: "job run probe",\n` +
  `    promptPath: "prompt.md",\n` +
  `    concurrency: "singleton",\n` +
  `    writablePaths: ["**"],\n` +
  `    gates: [],\n` +
  `    handoff: () => [],\n` +
  `  }],\n` +
  `  humanOnly: [],\n` +
  `};\n` +
  `export const agent = {\n` +
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
  `};\n`;

describe("§5b integration — job new → job run inside a linked worktree", () => {
  it(
    "new seeds the job, run (in the worktree) wakes the entry phase, ticks it under the job resolution, and releases the lock",
    async () => {
      const repo = await makeRepo();
      const tpl = await mkdtemp(join(tmpdir(), "flume-job-run-tpl-"));
      try {
        await writeFile(join(tpl, "chain.ts"), PROBE_CHAIN_SRC, "utf8");
        await writeFile(join(tpl, "prompt.md"), "job run probe prompt\n", "utf8");

        // §5a: create the job from the root checkout, then step off the
        // branch so the linked worktree can hold it (§6: one working tree
        // per job; a branch can only be checked out in one worktree).
        const created = await runCli(repo.dir, [
          "job",
          "new",
          "itest",
          "--template",
          tpl,
        ]);
        expect(created.code).toBe(0);
        await exec("git", ["checkout", "-q", "main"], { cwd: repo.dir });

        // The §6 recipe verbatim: `.git/` placement is legal.
        const wt = join(repo.dir, ".git", "flume-jobs", "itest");
        await exec("git", ["worktree", "add", wt, "job/itest"], {
          cwd: repo.dir,
        });

        const jobDir = join(wt, ".flume", "jobs", "itest");
        const run = await runCli(wt, ["job", "run", "itest", "--max", "5"]);
        expect(run.code).toBe(0);

        // §5b-1: HEAD was already job/itest in the worktree — assert passed,
        // no checkout. §5b-2: hibernating baton → phases[0] woken.
        expect(run.out).toContain("on job/itest");
        expect(run.out).toContain("woke probe (entry phase)");

        // §5b-3: the standard supervisor ran the tick and stopped on
        // hibernation (handoff → []), well under --max.
        expect(run.out).toMatch(/tick → probe \(singleton\)/);
        expect(run.out).toContain("hibernating after 1 tick(s)");

        // The child tick observed the full §3 job resolution via env —
        // rooted in the WORKTREE, not the root checkout.
        const observed = JSON.parse(
          await readFile(join(jobDir, "observed-env.json"), "utf8"),
        ) as { FLUME_DIR: string; FLUME_CONFIG_DIR: string; FLUME_JOB: string };
        expect(observed.FLUME_DIR).toBe(jobDir);
        expect(observed.FLUME_CONFIG_DIR).toBe(jobDir);
        expect(observed.FLUME_JOB).toBe("itest");

        // Lock taken in the job state root and dropped on exit; baton
        // hibernating after the handoff.
        expect(existsSync(join(jobDir, "loop.pid"))).toBe(false);
        expect(existsSync(join(jobDir, "awake", "probe"))).toBe(false);

        // A second run resumes identically: baton hibernating again, so the
        // entry phase re-wakes and the loop re-runs to hibernation.
        const rerun = await runCli(wt, ["job", "run", "itest", "--max", "5"]);
        expect(rerun.code).toBe(0);
        expect(rerun.out).toContain("woke probe (entry phase)");
      } finally {
        await repo.cleanup();
        await rm(tpl, { recursive: true, force: true });
      }
    },
    240_000,
  );

  it(
    "run refuses while another live loop holds the job's loop.pid — the standard lock, unchanged",
    async () => {
      const repo = await makeRepo();
      const tpl = await mkdtemp(join(tmpdir(), "flume-job-run-lock-tpl-"));
      try {
        await writeFile(join(tpl, "chain.ts"), PROBE_CHAIN_SRC, "utf8");
        await writeFile(join(tpl, "prompt.md"), "job run probe prompt\n", "utf8");

        const created = await runCli(repo.dir, [
          "job",
          "new",
          "lk",
          "--template",
          tpl,
        ]);
        expect(created.code).toBe(0);

        // The vitest worker plays the live prior supervisor — its pid is
        // alive for the duration of the spawned run. Stays on job/lk (run
        // from the root checkout: assert passes, no worktree needed here).
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
        await rm(tpl, { recursive: true, force: true });
      }
    },
    120_000,
  );
});

describe("§5c integration — job new → job run (tick) → job rm", () => {
  it(
    "rm after a ticked run sweeps the dir and runtime remnants, commits cleanup on the job branch, and leaves branch + history intact; re-run is a no-op",
    async () => {
      const repo = await makeRepo();
      const tpl = await mkdtemp(join(tmpdir(), "flume-job-rm-tpl-"));
      try {
        await writeFile(join(tpl, "chain.ts"), PROBE_CHAIN_SRC, "utf8");
        await writeFile(join(tpl, "prompt.md"), "job run probe prompt\n", "utf8");

        const created = await runCli(repo.dir, [
          "job",
          "new",
          "rme",
          "--template",
          tpl,
        ]);
        expect(created.code).toBe(0);

        // Run from the root checkout (stays on job/rme): one tick, then
        // hibernation — leaving runtime remnants in the state root.
        const run = await runCli(repo.dir, ["job", "run", "rme", "--max", "5"]);
        expect(run.code).toBe(0);
        const jobDir = join(repo.dir, ".flume", "jobs", "rme");
        expect(existsSync(join(jobDir, "observed-env.json"))).toBe(true);

        const removed = await runCli(repo.dir, ["job", "rm", "rme"]);
        expect(removed.code).toBe(0);
        expect(removed.out).toContain("cleanup commit on job/rme");
        expect(removed.out).toContain("branch job/rme survives");

        // State root gone — tracked harness and untracked remnants alike.
        expect(existsSync(jobDir)).toBe(false);

        // Branch survives with the full history: cleanup at the tip, the
        // seed beneath it; the tree is clean.
        expect(
          await exec("git", ["branch", "--list", "job/rme"], {
            cwd: repo.dir,
          }).then((r) => r.stdout),
        ).toContain("job/rme");
        const { stdout: subjects } = await exec(
          "git",
          ["log", "--format=%s", "job/rme"],
          { cwd: repo.dir },
        );
        expect(subjects.split("\n")[0]).toBe("chore(flume): rm job rme");
        expect(subjects).toContain("chore(flume): seed job rme");
        const { stdout: status } = await exec("git", ["status", "--porcelain"], {
          cwd: repo.dir,
        });
        expect(status.trim()).toBe("");

        // Already-clean job: rm again is a harmless no-op, not an error.
        const again = await runCli(repo.dir, ["job", "rm", "rme"]);
        expect(again.code).toBe(0);
        expect(again.out).toContain("nothing to commit");
      } finally {
        await repo.cleanup();
        await rm(tpl, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
