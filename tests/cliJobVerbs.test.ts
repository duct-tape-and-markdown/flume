/**
 * `flume job <verb>` seam — split from tests/cli.test.ts along the same seam
 * as `src/cliJobVerbs.ts` (`.claude/rules/posture-sweep.md`, "A violation
 * counts only when verified on disk this tick").
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";

import { hermeticEnv, runCli } from "./helpers/subprocess.ts";

const exec = promisify(execFile);

/**
 * CLI-JOBNEW-CJS-EXIT-CODE — `job new` is the outlier in the exit-code
 * contract cluster (spec/cli.md, "A CJS-context host is refused, never
 * relayed"): `runJobVerb`'s `new` catch checked only `JobUsageError`, so a
 * `CjsContextLoadError` thrown by `jobNew`'s own `loadChainModule` call fell
 * through to the operational branch — exit 1, refusal buried behind
 * `[flume] job new failed:`. `tick` already headlines the same error at exit
 * 2 (`CJS-context usage error` test above); this asserts `job new` now
 * matches.
 */
describe("flume job new — CJS-context host refusal via the real CLI (CLI-JOBNEW-CJS-EXIT-CODE)", () => {
  const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
  const TSC_BIN = fileURLToPath(
    new URL("../node_modules/typescript/bin/tsc", import.meta.url),
  );
  const DIST_CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

  beforeAll(async () => {
    await exec(process.execPath, [TSC_BIN, "-p", "tsconfig.build.json"], {
      cwd: REPO_ROOT,
    });
  }, 60_000);

  async function runDistCli(
    cwd: string,
    args: string[],
  ): Promise<{ out: string; code: number }> {
    try {
      const { stdout, stderr } = await exec(process.execPath, [DIST_CLI, ...args], {
        cwd,
        env: hermeticEnv(),
      });
      return { out: stdout + stderr, code: 0 };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.code ?? 1 };
    }
  }

  it(
    'a CJS-context host (package.json missing "type": "module") refuses `job new`\'s chain load, headlining the fix, and exits 2',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-cjs-jobnew-"));
      try {
        await writeFile(
          join(dir, "package.json"),
          JSON.stringify({ name: "cjs-host", type: "commonjs" }),
          "utf8",
        );
        await mkdir(join(dir, ".flume"), { recursive: true });
        await writeFile(
          join(dir, ".flume", "chain.ts"),
          `import { join as pathJoin } from "node:path";\n` +
            `export default { phases: [], humanOnly: [], _j: pathJoin };\n`,
          "utf8",
        );

        const result = await runDistCli(dir, ["job", "new", "probe"]);

        expect(result.code).toBe(2);
        expect(result.out).toContain("[flume]");
        expect(result.out).toContain('"type": "module"');
        expect(result.out).not.toContain("job new failed");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

async function makeJobRepo(branch: string): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "flume-job-"));
  const opts = { cwd: dir };
  await exec("git", ["init", "-q", "-b", branch], opts);
  await exec("git", ["config", "user.email", "test@example.com"], opts);
  await exec("git", ["config", "user.name", "Test User"], opts);
  await exec("git", ["config", "commit.gpgsign", "false"], opts);
  await writeFile(join(dir, "README.md"), "seed\n");
  await exec("git", ["add", "."], opts);
  await exec("git", ["commit", "-q", "-m", "seed"], opts);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Materialize the repo-resident config (v0.6 §2): `chain.ts` at
 * `<root>/.flume/` with its sibling `prompts/` dir — the shape every chain
 * fixture in this suite loads from, job resolution or not. `promptPath`
 * stays a plain configDir-relative join (§3: the shared-prompts case).
 */
async function writeRepoConfig(
  root: string,
  chainSrc: string,
  promptContent = "job probe prompt\n",
): Promise<string> {
  const cfg = join(root, ".flume");
  await mkdir(join(cfg, "prompts"), { recursive: true });
  await writeFile(join(cfg, "chain.ts"), chainSrc, "utf8");
  await writeFile(join(cfg, "prompts", "prompt.md"), promptContent, "utf8");
  return cfg;
}

function minimalChainSrc(friction?: string): string {
  return (
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: "probe",\n` +
    `    description: "",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    (friction !== undefined
      ? `  friction: ${JSON.stringify(friction)},\n`
      : ``) +
    `} });\n`
  );
}

/**
 * §6 (v0.6.2) — `flume job status`'s per-job friction count
 * (`runJobVerb`'s `status` branch, `src/cli.ts`): the repo chain's
 * declared friction dir, resolved job-dir-relative per job. Jobs are built
 * as plain directories under `.flume/jobs/` — `job status` is purely
 * observational (v0.5 §5d), so no real `jobNew`/branch is needed to exercise it.
 */
describe("flume job status — friction line (§6)", () => {
  it("appends a friction count for a job whose declared friction dir holds files", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      const jobDir = join(repo.dir, ".flume", "jobs", "j1");
      await mkdir(join(jobDir, "friction"), { recursive: true });
      await writeFile(join(jobDir, "friction", "note.md"), "blocked\n");

      const r = await runCli(repo.dir, ["job", "status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("j1");
      expect(r.out).toContain("friction: 1 note(s) await routing");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("omits the friction segment for a job whose declared friction dir is empty", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      const jobDir = join(repo.dir, ".flume", "jobs", "j1");
      await mkdir(join(jobDir, "friction"), { recursive: true });

      const r = await runCli(repo.dir, ["job", "status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("j1");
      expect(r.out).not.toContain("friction:");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("omits the friction segment for every job when Chain.friction is undeclared", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc());
      const jobDir = join(repo.dir, ".flume", "jobs", "j1");
      await mkdir(join(jobDir, "friction"), { recursive: true });
      await writeFile(join(jobDir, "friction", "note.md"), "blocked\n");

      const r = await runCli(repo.dir, ["job", "status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("j1");
      expect(r.out).not.toContain("friction:");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);
});

/**
 * §3 — `flume job status` and `flume status` share one pending-count probe
 * (`readPendingLoose`, `src/job.ts`): a job's corrupt pending.json reads
 * "pending: unparsable" through the real `job status` CLI path exactly as
 * `flume status` does for the top-level file, and a valid job pending.json
 * is byte-unchanged from its pre-shared-probe count line.
 */
describe("flume job status — pending entry count via the shared probe (§3)", () => {
  it('reports "pending: unparsable" for a job whose pending.json is corrupt', async () => {
    const repo = await makeJobRepo("main");
    try {
      const jobDir = join(repo.dir, ".flume", "jobs", "j1");
      await mkdir(join(jobDir, "plan"), { recursive: true });
      await writeFile(join(jobDir, "plan", "pending.json"), "not json{", "utf8");

      const r = await runCli(repo.dir, ["job", "status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("j1");
      expect(r.out).toContain("pending: unparsable");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("counts a valid job pending.json unchanged", async () => {
    const repo = await makeJobRepo("main");
    try {
      const jobDir = join(repo.dir, ".flume", "jobs", "j1");
      await mkdir(join(jobDir, "plan"), { recursive: true });
      await writeFile(
        join(jobDir, "plan", "pending.json"),
        JSON.stringify([
          {
            tag: "A",
            gate: { kind: "open" },
            dependsOnForks: [],
            files: { new: [], edit: [{ path: "src/a.ts", description: "a" }], retire: [] },
          },
        ]),
        "utf8",
      );

      const r = await runCli(repo.dir, ["job", "status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("j1");
      expect(r.out).toContain("pending: 1");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);
});

/**
 * v0.7 §9, real CLI — the acceptance-level claim: `cd .flume && flume job
 * status` resolves the same bay as running from the repo root (no false
 * "no jobs" lie), and so does invocation from any subdirectory below the
 * bay. A tree with no `.flume` anywhere above cwd keeps today's
 * cwd-as-root default, so bootstrapping a fresh bay is unaffected.
 */
describe("flume job status — §9 bay discovery walk-up (real CLI)", () => {
  it("invocation from inside .flume resolves the same bay as the repo root", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc());
      await mkdir(join(repo.dir, ".flume", "jobs", "j1"), { recursive: true });

      const fromRoot = await runCli(repo.dir, ["job", "status"]);
      const fromDotFlume = await runCli(join(repo.dir, ".flume"), ["job", "status"]);

      expect(fromRoot.code).toBe(0);
      expect(fromRoot.out).toContain("j1");
      expect(fromDotFlume.code).toBe(0);
      expect(fromDotFlume.out).toBe(fromRoot.out);
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("invocation from a subdirectory below the bay resolves the same bay as the repo root", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc());
      await mkdir(join(repo.dir, ".flume", "jobs", "j1"), { recursive: true });
      const nested = join(repo.dir, "src", "deep");
      await mkdir(nested, { recursive: true });

      const fromRoot = await runCli(repo.dir, ["job", "status"]);
      const fromNested = await runCli(nested, ["job", "status"]);

      expect(fromRoot.out).toContain("j1");
      expect(fromNested.code).toBe(0);
      expect(fromNested.out).toBe(fromRoot.out);
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("no .flume anywhere above cwd: keeps cwd-as-root, a fresh undocked repo prints 'no jobs' rather than erroring", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-walkup-undocked-"));
    try {
      const r = await runCli(dir, ["job", "status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("no jobs");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("flume job extract — removed (v0.11 §3)", () => {
  it("exits as an unrecognized verb rather than running", async () => {
    const repo = await makeJobRepo("main");
    try {
      const r = await runCli(repo.dir, [
        "job",
        "extract",
        "j1",
        "--onto",
        "main",
      ]);
      expect(r.code).toBe(2);
      expect(r.out).toContain("unknown job verb: extract");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);
});
