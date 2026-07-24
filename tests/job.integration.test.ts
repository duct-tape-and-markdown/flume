/**
 * v0.5 §5b + §6/§7 — `flume job new` → `flume job run` end-to-end on a
 * scratch repo, with the run executing INSIDE a linked worktree
 * (`git worktree add .git/flume-jobs/<name> job/<name>` — the §6 concurrency
 * recipe, so its viability is proven here per §7). The run path is the
 * standard loop under the job resolution: same `loop.pid` lock, same
 * one-child-per-tick supervisor, same exit codes as `flume loop`.
 *
 * Chain residency (v0.6 §2): the chain + prompts are committed at the repo
 * `.flume/` — one chain per `.flume`, tracked so a linked worktree's checkout
 * carries it — and job dirs stay thin (state only, no chain shims).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function gitOut(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trimEnd();
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
  // Byte-exact content assertions (intake sync, unwind restore) — keep the
  // host's autocrlf from rewriting checkouts.
  await exec("git", ["config", "core.autocrlf", "false"], opts);
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Commit a chain + prompt at `<repo>/.flume/` — the repo-resident config
 * (v0.6 §2), tracked so every branch (and every linked worktree's checkout)
 * carries it. `promptPath` is a configDir-relative join into the sibling
 * `prompts/` dir — the §3 shared-prompt shape.
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
  `export default {\n` +
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
    "new creates a thin job, run (in the worktree) loads the repo chain off the branch's checkout, wakes the entry phase, ticks it, and releases the lock",
    async () => {
      const repo = await makeRepo();
      try {
        // The chain rides the repo (§2) — committed on main BEFORE the job
        // exists, so job/itest (and its linked-worktree checkout) carries it.
        await commitRepoConfig(repo.dir, PROBE_CHAIN_SRC);

        // §5a: create the job from the root checkout, then step off the
        // branch so the linked worktree can hold it (§6: one working tree
        // per job; a branch can only be checked out in one worktree). The
        // job dir is thin: state only, no chain, no prompts.
        const created = await runCli(repo.dir, ["job", "new", "itest"]);
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
        // rooted in the WORKTREE, not the root checkout: state in the job
        // dir, config at the worktree's own repo .flume (chain residency —
        // each worktree resolves its own checkout's chain).
        const observed = JSON.parse(
          await readFile(join(jobDir, "observed-env.json"), "utf8"),
        ) as { FLUME_DIR: string; FLUME_CONFIG_DIR: string; FLUME_JOB: string };
        expect(observed.FLUME_DIR).toBe(jobDir);
        expect(observed.FLUME_CONFIG_DIR).toBe(join(wt, ".flume"));
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
      try {
        await commitRepoConfig(repo.dir, PROBE_CHAIN_SRC);
        const created = await runCli(repo.dir, ["job", "new", "rme"]);
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

        // The repo chain survives the removed job (§2) — rm sweeps only the
        // job's state root.
        expect(existsSync(join(repo.dir, ".flume", "chain.ts"))).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    240_000,
  );
});

/**
 * Chain whose agent does real work: writes `derived.txt` at the repo root
 * and commits it itself (one tick = one commit), then hands off to nobody —
 * one tick, hibernation. This is the commit `job extract` must cherry-pick.
 */
const WORK_CHAIN_SRC =
  `import { execFileSync } from "node:child_process";\n` +
  `import { writeFileSync } from "node:fs";\n` +
  `import { join } from "node:path";\n` +
  `export default {\n` +
  `  phases: [{\n` +
  `    name: "work",\n` +
  `    description: "job extract probe",\n` +
  `    promptPath: "prompts/prompt.md",\n` +
  `    concurrency: "singleton",\n` +
  `    writablePaths: ["**"],\n` +
  `    gates: [],\n` +
  `    handoff: () => [],\n` +
  `  }],\n` +
  `  humanOnly: [],\n` +
  `  harvest: ["friction.md", "plan/open-questions.md"],\n` +
  `};\n` +
  `export const agent = {\n` +
  `  name: "job-extract-probe",\n` +
  `  async invoke({ cwd }) {\n` +
  `    writeFileSync(join(cwd, "derived.txt"), "derived by the job\\n");\n` +
  `    execFileSync("git", ["add", "derived.txt"], { cwd });\n` +
  `    execFileSync("git", ["commit", "-q", "-m", "work: derive output"], { cwd });\n` +
  `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
  `  },\n` +
  `};\n`;

describe("§5e integration — job new → job run → job extract", () => {
  it(
    "extracts a clean branch: clobber refused, intake-first ordering, non-harness picks only, harvest to stdout, job consumed",
    async () => {
      const repo = await makeRepo();
      try {
        // The intake file predates the job — plan-side ticks append to it.
        await writeFile(join(repo.dir, "INTAKE.md"), "intake v1\n");
        await exec("git", ["add", "INTAKE.md"], { cwd: repo.dir });
        await exec("git", ["commit", "-q", "-m", "seed intake"], {
          cwd: repo.dir,
        });

        // Chain on main, before the fork — part of the base, never a pick.
        await commitRepoConfig(repo.dir, WORK_CHAIN_SRC, "derive prompt\n");

        const created = await runCli(repo.dir, ["job", "new", "ext"]);
        expect(created.code).toBe(0);

        // §5b: the run does the job's real work — one tick, one commit.
        const run = await runCli(repo.dir, ["job", "run", "ext", "--max", "5"]);
        expect(run.code).toBe(0);
        expect(run.out).toContain("hibernating after 1 tick(s)");

        // Plan-side artifacts, committed the way ticks commit them: an
        // intake-only append, then a harness-only friction/questions note.
        const jobDir = join(repo.dir, ".flume", "jobs", "ext");
        await writeFile(
          join(repo.dir, "INTAKE.md"),
          "intake v1\nintake v2 (plan-side append)\n",
        );
        await exec("git", ["add", "INTAKE.md"], { cwd: repo.dir });
        await exec("git", ["commit", "-q", "-m", "plan: append intake"], {
          cwd: repo.dir,
        });
        await writeFile(join(jobDir, "friction.md"), "friction: template gap\n");
        await mkdir(join(jobDir, "plan"), { recursive: true });
        await writeFile(
          join(jobDir, "plan", "open-questions.md"),
          "q: naming?\n",
        );
        await exec("git", ["add", ".flume/jobs/ext"], { cwd: repo.dir });
        await exec(
          "git",
          ["commit", "-q", "-m", "chore(flume): friction + questions"],
          { cwd: repo.dir },
        );

        // Base moves on while the job runs — extract forks off its TIP.
        await exec("git", ["checkout", "-q", "main"], { cwd: repo.dir });
        await writeFile(join(repo.dir, "mainline.txt"), "main advanced\n");
        await exec("git", ["add", "mainline.txt"], { cwd: repo.dir });
        await exec("git", ["commit", "-q", "-m", "main: advance"], {
          cwd: repo.dir,
        });

        // Clobber refusal (§5e-1): a branch named like the job blocks it.
        await exec("git", ["branch", "ext"], { cwd: repo.dir });
        const refused = await runCli(repo.dir, [
          "job", "extract", "ext", "--onto", "main", "--intake", "INTAKE.md",
        ]);
        expect(refused.code).toBe(1);
        expect(refused.out).toContain("already exists");
        expect(await gitOut(repo.dir, ["branch", "--list", "job/ext"])).toContain(
          "job/ext",
        );
        // HEAD is on main here — the harness lives on the job branch.
        expect(
          await gitOut(repo.dir, [
            "ls-tree", "--name-only", "job/ext", "--", ".flume/jobs/ext/.gitignore",
          ]),
        ).toContain(".gitignore");
        await exec("git", ["branch", "-D", "ext"], { cwd: repo.dir });

        const extracted = await runCli(repo.dir, [
          "job", "extract", "ext", "--onto", "main", "--intake", "INTAKE.md",
        ]);
        expect(extracted.code).toBe(0);

        // §5e-4: harvest off the job branch to stdout, for operator routing.
        expect(extracted.out).toContain("--- job/ext:friction.md ---");
        expect(extracted.out).toContain("friction: template gap");
        expect(extracted.out).toContain(
          "--- job/ext:plan/open-questions.md ---",
        );
        expect(extracted.out).toContain("q: naming?");

        // Intake commit first, then the tick's work commit — the harness
        // commits (seed, friction) and the intake-only append never appear.
        const subjects = (
          await gitOut(repo.dir, [
            "log", "--reverse", "--format=%s", "main..ext",
          ])
        ).split("\n");
        expect(subjects).toEqual([
          "intake: pass-through from job/ext",
          "work: derive output",
        ]);

        // The clean branch carries the work and the synced intake, no
        // harness anywhere; HEAD ends on it.
        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "ext",
        );
        expect(await readFile(join(repo.dir, "derived.txt"), "utf8")).toBe(
          "derived by the job\n",
        );
        expect(await readFile(join(repo.dir, "INTAKE.md"), "utf8")).toBe(
          "intake v1\nintake v2 (plan-side append)\n",
        );
        // No job harness on the clean branch; the repo chain survives the
        // consumed job (§2) — it was part of the base, not the job.
        expect(await gitOut(repo.dir, ["ls-files", "--", ".flume/jobs"])).toBe("");
        expect(await gitOut(repo.dir, ["ls-files", "--", ".flume/chain.ts"])).toBe(
          ".flume/chain.ts",
        );

        // §5e-5: extract consumed the job — branch and dir both gone.
        expect(await gitOut(repo.dir, ["branch", "--list", "job/ext"])).toBe("");
        expect(existsSync(jobDir)).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    240_000,
  );

  it(
    "recipe worktree (§6): extract from the root refuses while the worktree holds job/<name>; from inside it, extract succeeds",
    async () => {
      const repo = await makeRepo();
      try {
        await commitRepoConfig(repo.dir, WORK_CHAIN_SRC, "derive prompt\n");
        const created = await runCli(repo.dir, ["job", "new", "wrk"]);
        expect(created.code).toBe(0);

        // The §6 recipe verbatim: root steps off the branch, the linked
        // worktree holds it, the loop runs inside the worktree.
        await exec("git", ["checkout", "-q", "main"], { cwd: repo.dir });
        const wt = join(repo.dir, ".git", "flume-jobs", "wrk");
        await exec("git", ["worktree", "add", wt, "job/wrk"], {
          cwd: repo.dir,
        });
        const run = await runCli(wt, ["job", "run", "wrk", "--max", "5"]);
        expect(run.code).toBe(0);
        expect(run.out).toContain("hibernating after 1 tick(s)");

        // Loop stopped, worktree still holds job/wrk — extract from the
        // root refuses up front (before this guard, `git branch -D` failed
        // AFTER the picks: harvest lost, clean branch stranded).
        const refused = await runCli(repo.dir, [
          "job", "extract", "wrk", "--onto", "main",
        ]);
        expect(refused.code).toBe(1);
        expect(refused.out).toContain("checked out in another worktree");
        expect(await gitOut(repo.dir, ["branch", "--list", "job/wrk"])).toContain(
          "job/wrk",
        );
        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "main",
        );
        expect(await gitOut(repo.dir, ["branch", "--list", "wrk"])).toBe("");

        // The refusal names the escape hatch this run takes: extract from
        // inside the holding worktree.
        const extracted = await runCli(wt, [
          "job", "extract", "wrk", "--onto", "main",
        ]);
        expect(extracted.code).toBe(0);
        const subjects = (
          await gitOut(wt, ["log", "--reverse", "--format=%s", "main..wrk"])
        ).split("\n");
        expect(subjects).toEqual(["work: derive output"]);
        expect(await gitOut(wt, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "wrk",
        );
        expect(await readFile(join(wt, "derived.txt"), "utf8")).toBe(
          "derived by the job\n",
        );

        // Consumed from the worktree, gone repo-wide.
        expect(await gitOut(repo.dir, ["branch", "--list", "job/wrk"])).toBe("");
        expect(existsSync(join(wt, ".flume", "jobs", "wrk"))).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    240_000,
  );

  it(
    "cherry-pick conflict unwinds via the CLI: exit 1, retryable, job branch + dir intact, partial branch gone",
    async () => {
      const repo = await makeRepo();
      try {
        const opts = { cwd: repo.dir };
        await writeFile(join(repo.dir, "conflict.txt"), "base\n");
        await exec("git", ["add", "conflict.txt"], opts);
        await exec("git", ["commit", "-q", "-m", "seed conflict"], opts);

        // `job new` now requires the repo chain to exist (v0.6 §4/§9-7) even
        // though this scenario never runs a tick.
        await commitRepoConfig(repo.dir, WORK_CHAIN_SRC, "derive prompt\n");

        const created = await runCli(repo.dir, ["job", "new", "cfl"]);
        expect(created.code).toBe(0);
        await writeFile(join(repo.dir, "conflict.txt"), "job change\n");
        await exec("git", ["add", "conflict.txt"], opts);
        await exec("git", ["commit", "-q", "-m", "job: conflicting"], opts);

        await exec("git", ["checkout", "-q", "main"], opts);
        await writeFile(join(repo.dir, "conflict.txt"), "main change\n");
        await exec("git", ["add", "conflict.txt"], opts);
        await exec("git", ["commit", "-q", "-m", "main: conflicting"], opts);
        await exec("git", ["checkout", "-q", "job/cfl"], opts);

        const r = await runCli(repo.dir, [
          "job", "extract", "cfl", "--onto", "main",
        ]);
        expect(r.code).toBe(1);
        expect(r.out).toContain("retryable");

        // §5e-3: nothing lost — job branch checked out and intact, partial
        // branch deleted, no cherry-pick in flight, tree clean.
        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "job/cfl",
        );
        expect(await gitOut(repo.dir, ["branch", "--list", "cfl"])).toBe("");
        expect(
          existsSync(join(repo.dir, ".flume", "jobs", "cfl", ".gitignore")),
        ).toBe(true);
        expect(await readFile(join(repo.dir, "conflict.txt"), "utf8")).toBe(
          "job change\n",
        );
        expect(existsSync(join(repo.dir, ".git", "CHERRY_PICK_HEAD"))).toBe(
          false,
        );
        expect(await gitOut(repo.dir, ["status", "--porcelain"])).toBe("");
      } finally {
        await repo.cleanup();
      }
    },
    120_000,
  );
});
