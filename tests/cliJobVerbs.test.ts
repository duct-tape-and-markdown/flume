/**
 * `flume job <verb>` seam — split from tests/cli.test.ts along the same seam
 * as `src/cliJobVerbs.ts` (`.claude/rules/posture-sweep.md`, "A violation
 * counts only when verified on disk this tick").
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { denyDirectory } from "./helpers/denial.ts";
import { mkTempDir } from "./helpers/fixtureRoot.ts";
import { hermeticEnv } from "./helpers/gitEnv.ts";
import {
  SPAWN_BUDGET_MS,
  exec,
  runCli,
  runNodeStreams,
} from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

/**
 * JOBRUN-CJS-EXIT-CODE — every CLI surface that loads a chain refuses a
 * CJS-context host identically (spec/cli.md, "A CJS-context host is refused,
 * never relayed"): the refusal is the headline and the exit code is 2, never
 * an operational relay at exit 1 behind a `<verb> failed:` prefix. `job new`
 * was the first outlier (CLI-JOBNEW-CJS-EXIT-CODE); `job run`'s preflight
 * catch was the second, and the arm now has one home
 * (`refuseCjsContextHost`, src/cliChainLoad.ts) that all four reach.
 *
 * Driven through the real `dist/src/cli.js` rather than a unit call: the
 * refusal only exists because tsx's ESM loader fails on a CJS-context host,
 * which no in-process fake reproduces.
 */
describe("CJS-context host refusal across the chain-loading CLI surfaces (JOBRUN-CJS-EXIT-CODE)", () => {
  const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
  const TSC_BIN = fileURLToPath(
    new URL("../node_modules/typescript/bin/tsc", import.meta.url),
  );
  const DIST_CLI = fileURLToPath(new URL("../dist/src/cli.js", import.meta.url));

  beforeAll(async () => {
    await exec(process.execPath, [TSC_BIN, "-p", "tsconfig.build.json"], {
      cwd: REPO_ROOT,
    });
  }, SPAWN_BUDGET_MS);

  /**
   * A host repo whose own package.json declares `type: commonjs`, carrying a
   * chain.ts with a real `import` statement — the tsx 4.21 signature
   * (`src/chainLoad.ts`, `CjsContextLoadError`).
   */
  async function withCjsHost(
    run: (dir: string) => Promise<void>,
  ): Promise<void> {
    const dir = await mkTempDir("flume-cjs-host-");
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
      await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * One surface's case: the argv that reaches a chain load, and the relay
   * prefix that surface would have printed had it fallen through to its
   * operational branch — the exact string the refusal must displace.
   */
  const SURFACES: readonly {
    title: string;
    argv: readonly string[];
    relayPrefix: string;
  }[] = [
    {
      // `job run`'s preflight (`src/cli.ts`) loads the chain to name the
      // entry phase whenever the baton is hibernating, which a bare state
      // root always is.
      title: "flume job run refuses a CJS-context host as the headline and exits 2",
      argv: ["job", "run", "probe"],
      relayPrefix: "job run failed",
    },
    {
      title: "flume check refuses a CJS-context host as the headline and exits 2",
      argv: ["check"],
      relayPrefix: "check: chain failed to load",
    },
    {
      title: "flume friction refuses a CJS-context host as the headline and exits 2",
      argv: ["friction"],
      relayPrefix: "friction: chain failed to load",
    },
    {
      title: "flume job new refuses a CJS-context host as the headline and exits 2",
      argv: ["job", "new", "probe"],
      relayPrefix: "job new failed",
    },
  ];

  for (const surface of SURFACES) {
    it(
      surface.title,
      async () => {
        await withCjsHost(async (dir) => {
          const { stdout, stderr, code } = await runNodeStreams(
            dir,
            [DIST_CLI, ...surface.argv],
            hermeticEnv(),
          );
          const out = stdout + stderr;

          expect(out).toContain("[flume]");
          // The fix, named — not a raw loader stack.
          expect(out).toContain('"type": "module"');
          // Headline, not relay: the refusal carries no operational prefix.
          expect(out).not.toContain(surface.relayPrefix);
          expect(code).toBe(2);
        });
      },
      SPAWN_BUDGET_MS,
    );
  }
});

async function makeJobRepo(branch: string): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkTempDir("flume-job-");
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
 * Materialize the repo-resident config: `chain.ts` at
 * `<root>/.flume/` with its sibling `prompts/` dir — the shape every chain
 * fixture in this suite loads from, job resolution or not. `promptPath`
 * stays a plain configDir-relative join (the shared-prompts case).
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
 * `flume job status`'s per-job friction count
 * (`runJobVerb`'s `status` branch, `src/cli.ts`): the repo chain's
 * declared friction dir, resolved job-dir-relative per job. Jobs are built
 * as plain directories under `.flume/jobs/` — `job status` is purely
 * observational, so no real `jobNew`/branch is needed to exercise it.
 */
describe("flume job status — friction line", () => {
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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);
});

/**
 * FRICTION-LINE-ONE-RENDERER — the two status surfaces render one wording.
 *
 * An agreement gate (`.claude/rules/engineering.md`, *A seam gate reads what
 * the real writer wrote*): both real CLIs run over the same files, and the
 * friction segment each prints is compared against the other's. Neither side
 * is a fixture string, so a one-sided reword — a count phrasing changed on
 * `flume status` alone, an "unreadable" spelled differently in the job row —
 * fails here rather than shipping as two surfaces that disagree about the
 * same dir.
 *
 * The counted arm and the unreadable arm are both exercised: `unreadable` is
 * the arm with no visible count to give it away, so it is the one a
 * hand-kept second copy drifts on silently.
 */
describe("flume status / flume job status — one friction renderer (FRICTION-LINE-ONE-RENDERER)", () => {
  /** The `friction: …` segment of a status surface's output, or undefined. */
  const segment = (out: string): string | undefined =>
    out.match(/friction:.*/)?.[0];

  it("`flume job status` and `flume status` render the same friction wording for the same count, unreadable included", async () => {
    const repo = await makeJobRepo("main");
    const repoFriction = join(repo.dir, ".flume", "friction");
    const jobFriction = join(repo.dir, ".flume", "jobs", "j1", "friction");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));

      // Same contents on both sides: the repo-level dir `flume status`
      // counts against `flumeDir`, and the job-level dir `flume job status`
      // counts job-dir-relative.
      for (const dir of [repoFriction, jobFriction]) {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "a.md"), "blocked on owner input\n");
        await writeFile(join(dir, "b.md"), "second note\n");
      }

      const counted = {
        status: await runCli(repo.dir, ["status"]),
        job: await runCli(repo.dir, ["job", "status"]),
      };
      expect(counted.status.code).toBe(0);
      expect(counted.job.code).toBe(0);
      // Non-vacuity (`.claude/rules/engineering.md`, *A green verdict is
      // proven non-vacuous*): a comparison of two undefineds would pass over
      // two surfaces that printed nothing at all.
      expect(segment(counted.status.out)).toBe("friction: 2 note(s) await routing");
      expect(segment(counted.job.out)).toBe(segment(counted.status.out));

      // Unreadable: the dirs are there but are not dirs to read (ENOTDIR,
      // not ENOENT) — the arm that carries no count to give a drifted
      // wording away. Structural, so the win32 lane exercises it too
      // (`tests/helpers/denial.ts`).
      denyDirectory(repoFriction);
      denyDirectory(jobFriction);

      const unreadable = {
        status: await runCli(repo.dir, ["status"]),
        job: await runCli(repo.dir, ["job", "status"]),
      };
      expect(unreadable.status.code).toBe(0);
      expect(unreadable.job.code).toBe(0);
      expect(segment(unreadable.status.out)).toBe("friction: unreadable");
      expect(segment(unreadable.job.out)).toBe(segment(unreadable.status.out));
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * JOB-EXISTSSYNC-NARROW-ENOENT — the render leg. `jobStatus` reports a job
 * whose `awake/` dir exists but cannot be read as `awake: null`; the row must
 * carry that as its own reading. Printing it as `hibernating` is the lie the
 * null exists to prevent, and letting the read escape would fail the verb for
 * every sibling job (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * All three readings ride one invocation, so the unreadable row is compared
 * against a live one and a genuinely hibernating one from the same output
 * rather than against a remembered format.
 */
describe("flume job status — an unreadable baton is its own reading (JOB-EXISTSSYNC-NARROW-ENOENT)", () => {
  it("flume job status renders a null awake as unreadable, distinct from a hibernating job", async () => {
    const repo = await makeJobRepo("main");
    const sealedAwake = join(repo.dir, ".flume", "jobs", "sealed", "awake");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc());
      const jobs = join(repo.dir, ".flume", "jobs");
      // "live": an ordinary awake baton.
      await mkdir(join(jobs, "live", "awake"), { recursive: true });
      await writeFile(join(jobs, "live", "awake", "build"), "");
      // "quiet": no awake dir at all — hibernating.
      await mkdir(join(jobs, "quiet"), { recursive: true });
      // "sealed": an awake dir that is there but cannot be read (ENOTDIR,
      // not ENOENT), denied structurally (`tests/helpers/denial.ts`).
      await mkdir(sealedAwake, { recursive: true });
      await writeFile(join(sealedAwake, "plan"), "");
      denyDirectory(sealedAwake);

      const r = await runCli(repo.dir, ["job", "status"]);
      expect(r.code).toBe(0);
      const row = (name: string): string | undefined =>
        r.out.split("\n").find((l) => l.startsWith(name));
      // Non-vacuity (`.claude/rules/engineering.md`, *A green verdict is
      // proven non-vacuous*): the two readable rows prove the verb enumerated
      // all three jobs rather than dying on the sealed one.
      expect(row("live")).toContain("awake: build");
      expect(row("quiet")).toContain("hibernating");
      expect(row("sealed")).toContain("awake: unreadable");
      expect(row("sealed")).not.toContain("hibernating");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * `flume job status` and `flume status` share one pending-count probe
 * (`readPendingLoose`, `src/job.ts`): a job's corrupt pending.json reads
 * "pending: unparsable" through the real `job status` CLI path exactly as
 * `flume status` does for the top-level file, and a valid job pending.json
 * is byte-unchanged from its pre-shared-probe count line.
 */
describe("flume job status — pending entry count via the shared probe", () => {
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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);
});

/**
 * Real CLI — the acceptance-level claim: `cd .flume && flume job
 * status` resolves the same bay as running from the repo root (no false
 * "no jobs" lie), and so does invocation from any subdirectory below the
 * bay. A tree with no `.flume` anywhere above cwd keeps today's
 * cwd-as-root default, so bootstrapping a fresh bay is unaffected.
 */
describe("flume job status — bay discovery walk-up (real CLI)", () => {
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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

  it("no .flume anywhere above cwd: keeps cwd-as-root, a fresh undocked repo prints 'no jobs' rather than erroring", async () => {
    const dir = await mkTempDir("flume-walkup-undocked-");
    try {
      const r = await runCli(dir, ["job", "status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("no jobs");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * CHAIN-LOAD-FAILURE-REPORTED — `job status` loads the repo chain for its
 * declared friction dir and queue path, best-effort. When that load fails
 * every job's pending count silently rebases on the default queue path
 * (`resolvePendingPath`, `src/paths.ts`); the shared load
 * (`loadChainForObservation`, `src/cliChainLoad.ts`) now says so instead
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 */
describe("flume job status — a chain that fails to load (CHAIN-LOAD-FAILURE-REPORTED)", () => {
  it("flume job status names the chain-load failure it proceeded past", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(
        repo.dir,
        `export default () => {\n  throw new Error("chain factory exploded");\n};\n`,
      );
      const jobDir = join(repo.dir, ".flume", "jobs", "j1");
      await mkdir(join(jobDir, "plan"), { recursive: true });
      await writeFile(join(jobDir, "plan", "pending.json"), "[]", "utf8");

      const r = await runCli(repo.dir, ["job", "status"]);

      expect(r.code).toBe(0);
      expect(r.out).toContain("job status: chain failed to load");
      expect(r.out).toContain("chain factory exploded");
      expect(r.out).toContain("the pending count reads the default queue path");
      // Non-vacuity: the job row the degraded counts describe still printed.
      expect(r.out).toContain("j1");
      expect(r.out).toContain("pending: 0");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);
});

describe("flume job extract — removed", () => {
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
  }, SPAWN_BUDGET_MS);
});
