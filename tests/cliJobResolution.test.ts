/**
 * State-root and config-dir resolution seam — split from tests/cli.test.ts
 * along the same seam as `src/cliJobResolution.ts`
 * (`.claude/rules/posture-sweep.md`, "A violation counts only when verified
 * on disk this tick"). Unit-level `resolveStateDirs`/`resolveRepoRoot` cases
 * plus the real-CLI job-resolution and cross-repo-inheritance suites that
 * exercise the same seam end-to-end.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  CrossRepoFlumeDirError,
  JobResolutionConflictError,
  resolveRepoRoot,
  resolveStateDirs,
} from "../src/cliJobResolution.ts";
import { Baton } from "../src/Baton.ts";
import { gitOut, hermeticEnv, runCli } from "./helpers/subprocess.ts";

const exec = promisify(execFile);

const repoRoot = "/repo/root";

describe("resolveStateDirs", () => {
  it("defaults both roots to <repoRoot>/.flume and writes them back absolute when env is unset", () => {
    const env: NodeJS.ProcessEnv = {};
    const { flumeDir, configDir } = resolveStateDirs(env, repoRoot);

    const expected = join(repoRoot, ".flume");
    expect(flumeDir).toBe(expected);
    expect(configDir).toBe(expected);
    expect(isAbsolute(flumeDir)).toBe(true);
    expect(isAbsolute(configDir)).toBe(true);

    // Canonicalized back into the env for later chain loads / spawned children.
    expect(env.FLUME_DIR).toBe(expected);
    expect(env.FLUME_CONFIG_DIR).toBe(expected);
    // The provenance stamp rides every write-back alongside the dirs (CLI-FLUMEDIR-PROVENANCE-STAMP).
    expect(env.FLUME_DIR_RESOLVED_FOR).toBe(resolve(repoRoot));
  });

  it("resolves a set-but-relative FLUME_DIR / FLUME_CONFIG_DIR to absolute and writes it back", () => {
    const env: NodeJS.ProcessEnv = {
      FLUME_DIR: "tmp/dock",
      FLUME_CONFIG_DIR: "tmp/cfg",
    };
    const { flumeDir, configDir } = resolveStateDirs(env, repoRoot);

    // resolve() is cwd-relative — the canonical form is absolute regardless.
    expect(flumeDir).toBe(resolve("tmp/dock"));
    expect(configDir).toBe(resolve("tmp/cfg"));
    expect(isAbsolute(flumeDir)).toBe(true);
    expect(isAbsolute(configDir)).toBe(true);

    expect(env.FLUME_DIR).toBe(flumeDir);
    expect(env.FLUME_CONFIG_DIR).toBe(configDir);
  });

  it("leaves FLUME_JOB unset on a bare invocation — HEAD-is-truth untouched", () => {
    const env: NodeJS.ProcessEnv = {};
    const { flumeDir, job } = resolveStateDirs(env, repoRoot);

    expect(job).toBeUndefined();
    expect(env.FLUME_JOB).toBeUndefined();
    expect(flumeDir).toBe(join(repoRoot, ".flume"));
  });

  it("leaves an already-absolute FLUME_DIR untouched and independent of configDir", () => {
    // resolve() drive-qualifies on win32, so the fixture is absolute on
    // every platform — the untouched assertion needs a true absolute input.
    const dockState = resolve("/var/dock/state");
    const flumeConfig = resolve("/etc/flume/config");
    const env: NodeJS.ProcessEnv = {
      FLUME_DIR: dockState,
      FLUME_CONFIG_DIR: flumeConfig,
    };
    const { flumeDir, configDir } = resolveStateDirs(env, repoRoot);

    expect(flumeDir).toBe(dockState);
    expect(configDir).toBe(flumeConfig);
    expect(env.FLUME_DIR).toBe(dockState);
    expect(env.FLUME_CONFIG_DIR).toBe(flumeConfig);
  });
});

/**
 * v0.6 §3 — job resolution at the seam. `--job <name>` (or `FLUME_JOB`)
 * retargets only the state root (`flumeDir` → `<repoRoot>/.flume/jobs/<name>`);
 * `configDir` never retargets — the chain is repo-resident (§2), so it stays
 * `<repoRoot>/.flume` or explicit `FLUME_CONFIG_DIR`. All three env vars are
 * written back, so loop-spawned children inherit the whole resolution. The
 * flag is a strict authority over state: an explicit `FLUME_DIR` beside it
 * is a conflict (exit 2 at the CLI boundary); an explicit `FLUME_CONFIG_DIR`
 * composes — env owns config, job owns state.
 */
describe("resolveStateDirs — §3 job resolution", () => {
  const jobDir = join(repoRoot, ".flume", "jobs", "alpha");
  const repoConfig = join(repoRoot, ".flume");

  it("--job retargets flumeDir only; configDir stays <repoRoot>/.flume; all three env vars written back", () => {
    const env: NodeJS.ProcessEnv = {};
    const { flumeDir, configDir, job } = resolveStateDirs(env, repoRoot, "alpha");

    expect(flumeDir).toBe(jobDir);
    expect(configDir).toBe(repoConfig);
    expect(job).toBe("alpha");
    expect(isAbsolute(flumeDir)).toBe(true);

    // All three written back — children inherit the resolution via env.
    expect(env.FLUME_DIR).toBe(jobDir);
    expect(env.FLUME_CONFIG_DIR).toBe(repoConfig);
    expect(env.FLUME_JOB).toBe("alpha");
    expect(env.FLUME_DIR_RESOLVED_FOR).toBe(resolve(repoRoot));
  });

  it("FLUME_JOB set directly (no flag) is honored identically", () => {
    const env: NodeJS.ProcessEnv = { FLUME_JOB: "alpha" };
    const { flumeDir, configDir, job } = resolveStateDirs(env, repoRoot);

    expect(flumeDir).toBe(jobDir);
    expect(configDir).toBe(repoConfig);
    expect(job).toBe("alpha");
    expect(env.FLUME_DIR).toBe(jobDir);
    expect(env.FLUME_CONFIG_DIR).toBe(repoConfig);
    expect(env.FLUME_JOB).toBe("alpha");
  });

  it("--job alongside an explicit FLUME_DIR throws the conflict error", () => {
    expect(() =>
      resolveStateDirs({ FLUME_DIR: resolve("/x/state") }, repoRoot, "alpha"),
    ).toThrow(JobResolutionConflictError);
  });

  it("--job alongside an explicit FLUME_CONFIG_DIR composes: env owns config, job owns state", () => {
    const cfg = resolve("/x/cfg");
    const env: NodeJS.ProcessEnv = { FLUME_CONFIG_DIR: cfg };
    const { flumeDir, configDir, job } = resolveStateDirs(env, repoRoot, "alpha");

    expect(flumeDir).toBe(jobDir);
    expect(configDir).toBe(cfg);
    expect(job).toBe("alpha");
    expect(env.FLUME_DIR).toBe(jobDir);
    expect(env.FLUME_CONFIG_DIR).toBe(cfg);
    expect(env.FLUME_JOB).toBe("alpha");
  });

  it("env FLUME_JOB composes with explicit dirs (the loop → tick boundary): dirs win, job rides along", () => {
    // The parent's write-back sets all three; the child must not classify its
    // own inheritance as a conflict. The dir vars ARE the canonical job
    // resolution, so they win, and the job name survives for the fanout
    // namespace (v0.5 §4).
    // resolve() drive-qualifies on win32 — the untouched assertion needs a
    // true absolute input. The parent's write-back stamps
    // FLUME_DIR_RESOLVED_FOR alongside the dirs, and it agrees with this
    // (same-repo) child's freshly-resolved repoRoot — composes, no throw.
    const inherited = resolve(jobDir);
    const env: NodeJS.ProcessEnv = {
      FLUME_JOB: "alpha",
      FLUME_DIR: inherited,
      FLUME_CONFIG_DIR: inherited,
      FLUME_DIR_RESOLVED_FOR: resolve(repoRoot),
    };
    const { flumeDir, configDir, job } = resolveStateDirs(env, repoRoot);

    expect(flumeDir).toBe(inherited);
    expect(configDir).toBe(inherited);
    expect(job).toBe("alpha");
    expect(env.FLUME_JOB).toBe("alpha");
    expect(env.FLUME_DIR_RESOLVED_FOR).toBe(resolve(repoRoot));
  });
});

/**
 * CLI-FLUMEDIR-PROVENANCE-STAMP — cross-repo `FLUME_DIR` inheritance refuses
 * off a stamped `FLUME_DIR_RESOLVED_FOR`, never off the path's shape.
 * Observed on disk 2026-08-03: a nested `flume wake groom` in a CI-smoke
 * scratch repo inherited its parent process's `FLUME_DIR`, landing
 * `.flume/awake/groom` in the wrong repo's live baton. The retired
 * path-shape detection (`impliedRepoRoot`) misfired on a deliberate
 * relocation typed fresh for this repo — spec/cli.md's drift note, closed
 * by this stamp (told, not inferred: `.claude/rules/engine-boundary.md`).
 */
describe("resolveStateDirs — cross-repo FLUME_DIR provenance-stamp refusal", () => {
  const otherRepoFlumeDir = resolve("/other/repo/.flume");
  const otherRepoRoot = resolve("/other/repo");

  it("a FLUME_DIR_RESOLVED_FOR stamp that disagrees with the freshly-resolved repoRoot throws", () => {
    const env: NodeJS.ProcessEnv = {
      FLUME_DIR: otherRepoFlumeDir,
      FLUME_DIR_RESOLVED_FOR: otherRepoRoot,
    };
    expect(() => resolveStateDirs(env, repoRoot)).toThrow(
      CrossRepoFlumeDirError,
    );
    try {
      resolveStateDirs(env, repoRoot);
    } catch (err) {
      expect((err as Error).message).toContain(otherRepoFlumeDir);
      expect((err as Error).message).toContain(otherRepoRoot);
      expect((err as Error).message).toContain(repoRoot);
    }
  });

  it("a stamp that agrees with the freshly-resolved repoRoot does not throw", () => {
    const env: NodeJS.ProcessEnv = {
      FLUME_DIR: resolve(join(repoRoot, ".flume")),
      FLUME_DIR_RESOLVED_FOR: resolve(repoRoot),
    };
    expect(() => resolveStateDirs(env, repoRoot)).not.toThrow();
  });

  it("an absolute FLUME_DIR with no FLUME_DIR_RESOLVED_FOR stamp never throws, whatever its shape (misfire repro)", () => {
    // Under the retired path-shape detection, an absolute FLUME_DIR whose
    // path happened to end in a `.flume` segment for what looks like a
    // different repo was refused even when typed fresh for THIS repo.
    // `/mnt/state/.flume` is exactly that shape — a deliberate relocation,
    // no stamp — and must compose.
    const env: NodeJS.ProcessEnv = { FLUME_DIR: resolve("/mnt/state/.flume") };
    expect(() => resolveStateDirs(env, repoRoot)).not.toThrow();
  });

  it("an other-repo-shaped FLUME_DIR with no stamp at all never throws either", () => {
    const env: NodeJS.ProcessEnv = { FLUME_DIR: otherRepoFlumeDir };
    expect(() => resolveStateDirs(env, repoRoot)).not.toThrow();
  });

  it("an out-of-tree relocation with no .flume ancestor at all composes", () => {
    const env: NodeJS.ProcessEnv = { FLUME_DIR: resolve("/var/dock/state") };
    expect(() => resolveStateDirs(env, repoRoot)).not.toThrow();
  });

  it("a relative FLUME_DIR resolves against this invocation's own cwd and carries no stamp, so it never triggers the check", () => {
    const env: NodeJS.ProcessEnv = { FLUME_DIR: "../other/repo/.flume" };
    expect(() => resolveStateDirs(env, repoRoot)).not.toThrow();
  });
});

/**
 * v0.7 §9 — bay discovery walk-up. `repoRoot` used to be a literal
 * `process.cwd()`; it now walks up looking for the nearest `.flume`,
 * mirroring git's `.git` resolution. `cwd` itself counts as inside the bay
 * (the `.flume`-resident-cwd special case skips the walk entirely); no
 * `.flume` anywhere up to the filesystem root falls back to `cwd` unchanged
 * so bootstrapping a fresh, undocked repo is unaffected.
 */
describe("resolveRepoRoot — §9 bay discovery walk-up", () => {
  it("cwd itself holds .flume: returns cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-walkup-"));
    try {
      await mkdir(join(dir, ".flume"), { recursive: true });
      expect(resolveRepoRoot(dir)).toBe(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cwd nested several levels below the bay: walks up to the nearest .flume", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-walkup-"));
    try {
      await mkdir(join(dir, ".flume"), { recursive: true });
      const nested = join(dir, "src", "deep", "here");
      await mkdir(nested, { recursive: true });
      expect(resolveRepoRoot(nested)).toBe(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cwd's basename is .flume: returns dirname(cwd) directly, no filesystem walk needed", () => {
    // A path that does not exist on disk at all — proves the special case
    // short-circuits on the basename check rather than falling into the
    // existsSync walk (which would otherwise fall back to cwd itself).
    const fake = join(resolve("/nonexistent-flume-fixture-root"), ".flume");
    expect(resolveRepoRoot(fake)).toBe(dirname(fake));
  });

  it("no .flume anywhere above cwd: falls back to cwd unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-walkup-nodock-"));
    try {
      const nested = join(dir, "sub");
      await mkdir(nested, { recursive: true });
      expect(resolveRepoRoot(nested)).toBe(nested);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * §3 / v0.7 §4 — `flume tick` exit-code classification at the process
 * boundary: 78 (`EX_CONFIG`) terminal misconfiguration, 69 (`EX_UNAVAILABLE`,
 * `EX_MOUNT_DEAD`) the mount-dead failure class (chain never resolved),
 * 0 clean hibernate or ordinary work. Exercised at the mapping seam
 * (`tickExitCode`); the loop-process-boundary integration suite proves 78
 * and 69 end-to-end through a real subprocess.
 */

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

/**
 * A job-dir `chain.ts` that detonates on load. Inert by construction (§2):
 * the runtime never looks in the job dir for a chain, so any test that ticks
 * or loops past this file proves the repo chain is what loaded.
 */
const INERT_TRAP_CHAIN_SRC =
  `throw new Error("job-local chain.ts was loaded — chains are repo-resident (v0.6 §2)");\n`;

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
 * A chain.ts whose singleton phase records the FLUME_DIR / FLUME_CONFIG_DIR /
 * FLUME_JOB it observes *inside the child tick process* to
 * `<FLUME_DIR>/observed-env.json`. The supervisor spawns the tick with no
 * `env:` override, so what lands in that file is exactly what the child
 * inherited across the loop → tick boundary — the §3 inheritance claim made
 * observable end-to-end.
 */
function jobEnvProbeChainSrc(phaseName: string): string {
  return (
    `import { writeFileSync } from "node:fs";\n` +
    `import { join } from "node:path";\n` +
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "job env probe",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `},\n` +
    `agent: {\n` +
    `  name: "job-env-probe",\n` +
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
    `} });\n`
  );
}

/**
 * CLI-STATEROOT-RESOLVE-BEFORE-DISPATCH — a chain whose factory (not a phase
 * agent) records `process.env.FLUME_DIR` to `<cwd>/observed-flume-dir.json`
 * at load time. `job new` invokes the factory synchronously
 * (`loadChainModule`, `src/Dispatcher.ts`) before the job dir it creates
 * exists, so the probe writes beside the repo root rather than under the
 * still-nonexistent job dir.
 */
function jobNewEnvProbeChainSrc(): string {
  return (
    `import { writeFileSync } from "node:fs";\n` +
    `import { join } from "node:path";\n` +
    `export default () => {\n` +
    `  writeFileSync(\n` +
    `    join(process.cwd(), "observed-flume-dir.json"),\n` +
    `    JSON.stringify({ FLUME_DIR: process.env.FLUME_DIR }),\n` +
    `  );\n` +
    `  return { chain: {\n` +
    `    phases: [{\n` +
    `      name: "probe",\n` +
    `      description: "",\n` +
    `      promptPath: "prompts/prompt.md",\n` +
    `      concurrency: "singleton",\n` +
    `      writablePaths: ["**"],\n` +
    `      gates: [],\n` +
    `      handoff: () => [],\n` +
    `    }],\n` +
    `    humanOnly: [],\n` +
    `  } };\n` +
    `};\n`
  );
}

/**
 * v0.5 §4 — a fanout chain whose agent records the branch of the worktree it
 * was invoked in to `<FLUME_DIR>/observed-branch.txt`. The agent commits
 * nothing (the tick falls through clean), so what lands in the file is purely
 * the branch `createWorktree` named — the namespace claim made observable
 * through the real CLI.
 */
function jobFanoutProbeChainSrc(phaseName: string): string {
  return (
    `import { execFileSync } from "node:child_process";\n` +
    `import { writeFileSync } from "node:fs";\n` +
    `import { join } from "node:path";\n` +
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "job fanout branch probe",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "fanout",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `},\n` +
    `agent: {\n` +
    `  name: "job-fanout-probe",\n` +
    `  async invoke(inv) {\n` +
    `    const branch = execFileSync(\n` +
    `      "git",\n` +
    `      ["rev-parse", "--abbrev-ref", "HEAD"],\n` +
    `      { cwd: inv.cwd, encoding: "utf8" },\n` +
    `    ).trim();\n` +
    `    writeFileSync(\n` +
    `      join(process.env.FLUME_DIR ?? "", "observed-branch.txt"),\n` +
    `      branch,\n` +
    `    );\n` +
    `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
    `  },\n` +
    `} });\n`
  );
}

describe("§3 job resolution — real CLI", () => {
  it(
    "--job alongside explicit FLUME_DIR is a usage error (exit 2); a valueless --job likewise; FLUME_CONFIG_DIR beside --job is no conflict",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-job-conflict-"));
      try {
        const conflict = await runCli(dir, ["--job", "foo", "status"], {
          ...hermeticEnv(),
          FLUME_DIR: dir,
        });
        expect(conflict.code).toBe(2);
        expect(conflict.out).toContain("--job foo");
        expect(conflict.out).toContain("FLUME_DIR");
        expect(conflict.out).toContain("one resolution authority");

        // The conflict narrowed to FLUME_DIR (§3): config beside --job
        // composes instead of erroring. Pre-existing per
        // CLI-JOB-FLAG-REFUSES-NONEXISTENT-STATE-ROOT: --job now refuses a
        // name with no state root, so this composition probe needs one.
        await mkdir(join(dir, ".flume", "jobs", "foo"), { recursive: true });
        const composed = await runCli(dir, ["--job", "foo", "status"], {
          ...hermeticEnv(),
          FLUME_CONFIG_DIR: dir,
        });
        expect(composed.code).toBe(0);
        expect(composed.out).toContain("hibernating");

        const bare = await runCli(dir, ["--job"]);
        expect(bare.code).toBe(2);
        expect(bare.out).toContain("usage: flume --job <name>");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    "--job <name> naming no existing state root refuses (exit 2), naming the job and the path, before status or tick ever run — creates no directory (CLI-JOB-FLAG-REFUSES-NONEXISTENT-STATE-ROOT)",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const jobDir = join(repo.dir, ".flume", "jobs", "ghost");

        const status = await runCli(repo.dir, ["--job", "ghost", "status"]);
        expect(status.code).toBe(2);
        expect(status.out).toContain("ghost");
        expect(status.out).toContain(jobDir);
        expect(existsSync(jobDir)).toBe(false);

        const tick = await runCli(repo.dir, ["--job", "ghost", "tick"]);
        expect(tick.code).toBe(2);
        expect(tick.out).toContain("ghost");
        expect(tick.out).toContain(jobDir);
        expect(existsSync(jobDir)).toBe(false);

        // FLUME_JOB alone (no flag) refuses identically (§3 parity).
        const envOnly = await runCli(repo.dir, ["status"], {
          ...hermeticEnv(),
          FLUME_JOB: "ghost",
        });
        expect(envOnly.code).toBe(2);
        expect(existsSync(jobDir)).toBe(false);

        // `job new` is the sole verb permitted to create it — unaffected by
        // the refusal above because it carries no --job flag of its own, so
        // `job` stays undefined through resolution and the existence guard
        // never fires (CLI-STATEROOT-RESOLVE-BEFORE-DISPATCH).
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const created = await runCli(repo.dir, ["job", "new", "ghost"]);
        expect(created.code).toBe(0);
        expect(existsSync(jobDir)).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "job new resolves flumeDir/configDir ahead of dispatch: a chain factory reading process.env.FLUME_DIR sees the canonicalized value, not the caller's raw relative one (CLI-STATEROOT-RESOLVE-BEFORE-DISPATCH)",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, jobNewEnvProbeChainSrc());
        const observedPath = join(repo.dir, "observed-flume-dir.json");

        const created = await runCli(repo.dir, ["job", "new", "probejob"], {
          ...hermeticEnv(),
          FLUME_DIR: "tmp/relative-state",
        });
        expect(created.code).toBe(0);

        const observed = JSON.parse(
          await readFile(observedPath, "utf8"),
        ) as { FLUME_DIR: string };
        expect(observed.FLUME_DIR).toBe(resolve(repo.dir, "tmp/relative-state"));
        expect(
          existsSync(join(repo.dir, ".flume", "jobs", "probejob")),
        ).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "tick/loop under --job succeed regardless of current branch (wrong-branch guard retired, v0.11 §2)",
    async () => {
      const repo = await makeJobRepo("main"); // deliberately not job/foo
      try {
        await writeRepoConfig(repo.dir, jobEnvProbeChainSrc("probe"));
        const jobDir = join(repo.dir, ".flume", "jobs", "foo");
        new Baton(jobDir).wake("probe");

        const tick = await runCli(repo.dir, ["--job", "foo", "tick"]);
        expect(tick.code).toBe(0);
        expect(tick.out).not.toContain("refusing");
        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "main",
        );

        // The env var is honored identically to the flag (§3).
        new Baton(jobDir).wake("probe");
        const envOnly = await runCli(repo.dir, ["loop", "--max", "1"], {
          ...hermeticEnv(),
          FLUME_JOB: "foo",
        });
        expect(envOnly.code).toBe(0);
        expect(envOnly.out).not.toContain("refusing");
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "two state roots under one checkout each run a tick sequentially, no branch switch (§2 acceptance fixture)",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, jobEnvProbeChainSrc("probe"));
        const jobA = join(repo.dir, ".flume", "jobs", "a");
        const jobB = join(repo.dir, ".flume", "jobs", "b");
        new Baton(jobA).wake("probe");
        new Baton(jobB).wake("probe");

        const tickA = await runCli(repo.dir, ["--job", "a", "tick"]);
        expect(tickA.code).toBe(0);
        const tickB = await runCli(repo.dir, ["--job", "b", "tick"]);
        expect(tickB.code).toBe(0);

        expect(await gitOut(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
          "main",
        );
        expect(existsSync(join(jobA, "observed-env.json"))).toBe(true);
        expect(existsSync(join(jobB, "observed-env.json"))).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "read-only subcommands (status, wake, sleep) resolve state to the job root — a job-dir chain.ts is never consulted by them",
    async () => {
      const repo = await makeJobRepo("main"); // deliberately NOT job/foo
      try {
        await writeRepoConfig(repo.dir, jobEnvProbeChainSrc("probe"));
        const jobDir = join(repo.dir, ".flume", "jobs", "foo");
        await mkdir(jobDir, { recursive: true });
        // §2 inertness: configDir never follows --job, so status's and
        // wake/sleep's best-effort chain loads all reach the repo chain
        // (which declares "probe"), never this job-dir trap.
        await writeFile(join(jobDir, "chain.ts"), INERT_TRAP_CHAIN_SRC, "utf8");

        const status = await runCli(repo.dir, ["--job", "foo", "status"]);
        expect(status.code).toBe(0);
        expect(status.out).toContain("hibernating");

        // wake lands the flag under the JOB state root — resolution proof.
        const wake = await runCli(repo.dir, ["--job", "foo", "wake", "probe"]);
        expect(wake.code).toBe(0);
        expect(existsSync(join(jobDir, "awake", "probe"))).toBe(true);

        const sleep = await runCli(repo.dir, ["--job", "foo", "sleep", "probe"]);
        expect(sleep.code).toBe(0);
        expect(existsSync(join(jobDir, "awake", "probe"))).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "a loop-spawned child tick inherits all three env vars regardless of branch — configDir stays repo .flume, job-dir chain.ts inert",
    async () => {
      const repo = await makeJobRepo("job/foo");
      try {
        await writeRepoConfig(repo.dir, jobEnvProbeChainSrc("probe"));
        const jobDir = join(repo.dir, ".flume", "jobs", "foo");
        await mkdir(jobDir, { recursive: true });
        // §2 inertness under tick: the trap would fail the loop if loaded.
        await writeFile(join(jobDir, "chain.ts"), INERT_TRAP_CHAIN_SRC, "utf8");
        new Baton(jobDir).wake("probe");

        const loop = await runCli(repo.dir, ["--job", "foo", "loop", "--max", "1"]);
        expect(loop.code).toBe(0);
        expect(loop.out).not.toContain("refusing");
        expect(loop.out).not.toContain("job-local chain.ts was loaded");
        expect(loop.out).toMatch(/tick → probe \(singleton\)/);

        // Written by the agent inside the CHILD tick process, under the dir
        // it saw as FLUME_DIR — presence + content prove the child inherited
        // the supervisor's canonical job resolution, not a re-derived default.
        const observed = JSON.parse(
          await readFile(join(jobDir, "observed-env.json"), "utf8"),
        ) as { FLUME_DIR: string; FLUME_CONFIG_DIR: string; FLUME_JOB: string };
        expect(observed.FLUME_DIR).toBe(jobDir);
        expect(observed.FLUME_CONFIG_DIR).toBe(join(repo.dir, ".flume"));
        expect(observed.FLUME_JOB).toBe("foo");
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "--job + explicit FLUME_CONFIG_DIR composes end-to-end: chain + prompt from the env dir, state in the job dir",
    async () => {
      const repo = await makeJobRepo("job/foo");
      const cfg = await mkdtemp(join(tmpdir(), "flume-env-cfg-"));
      try {
        // The ONLY config anywhere is the env dir — no repo .flume chain, so
        // a pass proves the dock seam is what loaded.
        await mkdir(join(cfg, "prompts"), { recursive: true });
        await writeFile(join(cfg, "chain.ts"), jobEnvProbeChainSrc("probe"), "utf8");
        await writeFile(join(cfg, "prompts", "prompt.md"), "env-dir prompt\n", "utf8");
        const env = { ...hermeticEnv(), FLUME_CONFIG_DIR: cfg };
        // Pre-existing per CLI-JOB-FLAG-REFUSES-NONEXISTENT-STATE-ROOT: --job
        // now refuses a name with no state root, so this composition probe
        // needs one before its first --job call.
        const jobDir = join(repo.dir, ".flume", "jobs", "foo");
        await mkdir(jobDir, { recursive: true });

        new Baton(jobDir).wake("probe");
        const tick = await runCli(repo.dir, ["--job", "foo", "tick"], env);
        expect(tick.code).toBe(0);

        // State stayed namespaced under the job dir; the child saw the
        // composed resolution: env config dir + job state root.
        const observed = JSON.parse(
          await readFile(join(jobDir, "observed-env.json"), "utf8"),
        ) as { FLUME_DIR: string; FLUME_CONFIG_DIR: string; FLUME_JOB: string };
        expect(observed.FLUME_DIR).toBe(jobDir);
        expect(observed.FLUME_CONFIG_DIR).toBe(cfg);
        expect(observed.FLUME_JOB).toBe("foo");
      } finally {
        await repo.cleanup();
        await rm(cfg, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    "fanout under FLUME_JOB names the worktree branch flume/<job>/<slug> — namespace flows CLI → dispatcher (v0.5 §4)",
    async () => {
      const repo = await makeJobRepo("job/foo");
      try {
        await writeRepoConfig(
          repo.dir,
          jobFanoutProbeChainSrc("probe"),
          "job fanout probe\n",
        );
        const jobDir = join(repo.dir, ".flume", "jobs", "foo");
        await mkdir(join(jobDir, "plan"), { recursive: true });
        await writeFile(
          join(jobDir, "plan", "pending.json"),
          JSON.stringify(
            [
              {
                tag: "NS-PROBE",
                gate: { kind: "open" },
                dependsOnForks: [],
                files: {
                  new: [],
                  edit: [{ path: "src/ns-probe.ts", description: "edit" }],
                  retire: [],
                },
              },
            ],
            null,
            2,
          ) + "\n",
          "utf8",
        );
        // Committed — a job's state is tracked, working-tree files
        // (spec/jobs.md "A job is a state root"), and the decide-read now
        // resolves the committed HEAD tip, never the working tree
        // (spec/pending.md "Dispatch reads come from the tip, not the
        // tree").
        await exec("git", ["add", "--", ".flume/jobs/foo/plan/pending.json"], {
          cwd: repo.dir,
        });
        await exec("git", ["commit", "-q", "-m", "test: seed NS-PROBE"], {
          cwd: repo.dir,
        });
        new Baton(jobDir).wake("probe");

        // FLUME_JOB alone, no --job flag: the env-var resolution path must
        // carry the namespace to the dispatcher identically (§3 parity).
        const tick = await runCli(repo.dir, ["tick"], {
          ...hermeticEnv(),
          FLUME_JOB: "foo",
        });
        expect(tick.code).toBe(0);

        const observed = await readFile(
          join(jobDir, "observed-branch.txt"),
          "utf8",
        );
        expect(observed).toBe("flume/foo/ns-probe");
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );
});

/**
 * CLI-FLUMEDIR-PROVENANCE-STAMP — end-to-end through the real CLI: an
 * inherited `FLUME_DIR_RESOLVED_FOR` stamp pointing at a *different* repo
 * refuses (exit 2) instead of writing there. Mirrors the 2026-08-03
 * incident: a nested `flume wake` inherited its parent's `FLUME_DIR` rather
 * than resolving fresh against its own cwd. The stamp — not the path's
 * shape — is what makes this genuine inheritance: the outer process's own
 * `resolveStateDirs` write-back is what would have set
 * `FLUME_DIR_RESOLVED_FOR=<outer.dir>` alongside `FLUME_DIR` in the first
 * place, so a bare absolute `FLUME_DIR` with no stamp does not reproduce it.
 */
describe("flume — cross-repo FLUME_DIR inheritance refuses via the real CLI (CLI-FLUMEDIR-PROVENANCE-STAMP)", () => {
  it(
    "a flume invocation inheriting another repo's FLUME_DIR + FLUME_DIR_RESOLVED_FOR stamp refuses instead of writing to it",
    async () => {
      const outer = await makeJobRepo("main");
      const inner = await makeJobRepo("main");
      try {
        const outerFlumeDir = join(outer.dir, ".flume");
        await mkdir(outerFlumeDir, { recursive: true });

        const wake = await runCli(inner.dir, ["wake", "groom"], {
          ...hermeticEnv(),
          FLUME_DIR: outerFlumeDir,
          FLUME_DIR_RESOLVED_FOR: outer.dir,
        });

        expect(wake.code).toBe(2);
        expect(wake.out).toContain(outerFlumeDir);
        expect(wake.out).toContain(outer.dir);
        expect(wake.out).toContain(inner.dir);
        expect(existsSync(join(outerFlumeDir, "awake", "groom"))).toBe(false);
        expect(existsSync(join(inner.dir, ".flume"))).toBe(false);
      } finally {
        await outer.cleanup();
        await inner.cleanup();
      }
    },
    30_000,
  );

  it(
    "a bare absolute FLUME_DIR shaped like another repo's .flume, with no stamp, composes rather than refusing (misfire repro)",
    async () => {
      const outer = await makeJobRepo("main");
      const inner = await makeJobRepo("main");
      try {
        const outerFlumeDir = join(outer.dir, ".flume");
        await mkdir(outerFlumeDir, { recursive: true });

        const wake = await runCli(inner.dir, ["wake", "groom"], {
          ...hermeticEnv(),
          FLUME_DIR: outerFlumeDir,
        });

        expect(wake.code).toBe(0);
        expect(existsSync(join(outerFlumeDir, "awake", "groom"))).toBe(true);
      } finally {
        await outer.cleanup();
        await inner.cleanup();
      }
    },
    30_000,
  );
});
