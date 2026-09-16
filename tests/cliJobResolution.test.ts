/**
 * State-root and config-dir resolution seam — split from tests/cli.test.ts
 * along the same seam as `src/cliJobResolution.ts`
 * (`.claude/rules/posture-sweep.md`, "A violation counts only when verified
 * on disk this tick"). Unit-level `resolveStateDirs`/`resolveRepoRoot` cases
 * plus the real-CLI job-resolution and cross-repo-inheritance suites that
 * exercise the same seam end-to-end.
 */

import { execFile } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  CrossRepoFlumeDirError,
  JobResolutionConflictError,
  resolveRepoRoot,
  resolveStateDirs,
} from "../src/cliJobResolution.ts";
import { Baton } from "../src/Baton.ts";
import { EX_IOERR } from "../src/cli.ts";
import { jobNew } from "../src/job.ts";
import { mkFixtureRoot } from "./helpers/fixtureRoot.ts";
import { hermeticEnv } from "./helpers/gitEnv.ts";
import {
  SPAWN_BUDGET_MS,
  gitOut,
  runCli,
  runCliStreams,
} from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

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
 * Job resolution at the seam. `--job <name>` (or `FLUME_JOB`)
 * retargets only the state root (`flumeDir` → `<repoRoot>/.flume/jobs/<name>`);
 * `configDir` never retargets — the chain is repo-resident, so it stays
 * `<repoRoot>/.flume` or explicit `FLUME_CONFIG_DIR`. All three env vars are
 * written back, so loop-spawned children inherit the whole resolution. The
 * flag is a strict authority over state: an explicit `FLUME_DIR` beside it
 * is a conflict (exit 2 at the CLI boundary); an explicit `FLUME_CONFIG_DIR`
 * composes — env owns config, job owns state.
 */
describe("resolveStateDirs — job resolution", () => {
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
    // namespace.
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
 * path-shape detection misfired on a deliberate
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

  /**
   * Remedy agreement: the env var names the refusal *prints* are the ones the
   * test *applies*, so a message advertising a remedy that does not clear the
   * refusal fails here rather than at an operator's terminal.
   */
  const remedyVars = (message: string): string[] => {
    const at = message.indexOf("Unset ");
    expect(at).toBeGreaterThanOrEqual(0);
    return [...message.slice(at).matchAll(/FLUME_[A-Z_]+/g)].map((m) => m[0]);
  };

  const refusalOf = (env: NodeJS.ProcessEnv): Error => {
    try {
      resolveStateDirs(env, repoRoot);
    } catch (err) {
      return err as Error;
    }
    throw new Error("expected a cross-repo refusal, but resolution succeeded");
  };

  it("the cross-repo refusal names FLUME_DIR_RESOLVED_FOR as the stamp to unset", () => {
    // Both shapes the guard fires in: the stamp inherited beside its dir, and
    // the stamp inherited alone. The stamp is what the check keys on, so
    // neither remedy can omit it.
    const withDir = remedyVars(
      refusalOf({
        FLUME_DIR: otherRepoFlumeDir,
        FLUME_DIR_RESOLVED_FOR: otherRepoRoot,
      }).message,
    );
    const stampOnly = remedyVars(
      refusalOf({ FLUME_DIR_RESOLVED_FOR: otherRepoRoot }).message,
    );

    expect(withDir.length).toBeGreaterThan(0);
    expect(stampOnly.length).toBeGreaterThan(0);
    expect(withDir).toContain("FLUME_DIR_RESOLVED_FOR");
    expect(stampOnly).toContain("FLUME_DIR_RESOLVED_FOR");

    // And each stated remedy, applied verbatim, actually clears the refusal.
    const cases: Array<[NodeJS.ProcessEnv, string[]]> = [
      [
        {
          FLUME_DIR: otherRepoFlumeDir,
          FLUME_DIR_RESOLVED_FOR: otherRepoRoot,
        },
        withDir,
      ],
      [{ FLUME_DIR_RESOLVED_FOR: otherRepoRoot }, stampOnly],
    ];
    for (const [env, vars] of cases) {
      for (const name of vars) delete env[name];
      expect(resolveStateDirs(env, repoRoot).flumeDir).toBe(
        join(repoRoot, ".flume"),
      );
    }
  });

  it("the cross-repo refusal message omits an unset FLUME_DIR rather than printing undefined", () => {
    // An inherited stamp outlives the dir it was written beside whenever an
    // operator clears only FLUME_DIR. The refusal still fires — correctly —
    // but it has no dir value to quote.
    const message = refusalOf({
      FLUME_DIR_RESOLVED_FOR: otherRepoRoot,
    }).message;

    expect(message).not.toContain("undefined");
    expect(message).toContain("FLUME_DIR_RESOLVED_FOR");
    expect(message).toContain(otherRepoRoot);
    expect(message).toContain(repoRoot);
  });

  it("unsetting FLUME_DIR and FLUME_DIR_RESOLVED_FOR together resolves the state root under this repo", () => {
    const env: NodeJS.ProcessEnv = {
      FLUME_DIR: otherRepoFlumeDir,
      FLUME_DIR_RESOLVED_FOR: otherRepoRoot,
    };
    // Exactly this pair is what the message tells the operator to clear —
    // not FLUME_DIR alone (the stamp survives and re-refuses) and not the
    // stamp alone (resolution then lands in the other repo, the hazard).
    expect(new Set(remedyVars(refusalOf({ ...env }).message))).toEqual(
      new Set(["FLUME_DIR", "FLUME_DIR_RESOLVED_FOR"]),
    );

    delete env.FLUME_DIR;
    delete env.FLUME_DIR_RESOLVED_FOR;
    const { flumeDir, configDir } = resolveStateDirs(env, repoRoot);

    expect(flumeDir).toBe(join(repoRoot, ".flume"));
    expect(configDir).toBe(join(repoRoot, ".flume"));
    expect(env.FLUME_DIR_RESOLVED_FOR).toBe(resolve(repoRoot));
  });

  it("clearing FLUME_DIR alone leaves the stamp refusing, and clearing the stamp alone lands in the other repo", () => {
    // Why the remedy names the pair: each half taken alone is a trap. This is
    // the refusal's own justification, pinned.
    const dirCleared: NodeJS.ProcessEnv = {
      FLUME_DIR_RESOLVED_FOR: otherRepoRoot,
    };
    expect(() => resolveStateDirs(dirCleared, repoRoot)).toThrow(
      CrossRepoFlumeDirError,
    );

    const stampCleared: NodeJS.ProcessEnv = { FLUME_DIR: otherRepoFlumeDir };
    expect(resolveStateDirs(stampCleared, repoRoot).flumeDir).toBe(
      otherRepoFlumeDir,
    );
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
 * Bay discovery walk-up. `repoRoot` used to be a literal
 * `process.cwd()`; it now walks up looking for the nearest `.flume`,
 * mirroring git's `.git` resolution. `cwd` itself counts as inside the bay
 * (the `.flume`-resident-cwd special case skips the walk entirely); no
 * `.flume` anywhere up to the filesystem root falls back to `cwd` unchanged
 * so bootstrapping a fresh, undocked repo is unaffected.
 */
describe("resolveRepoRoot — bay discovery walk-up", () => {
  it("cwd itself holds .flume: returns cwd", async () => {
    const dir = await mkFixtureRoot("flume-walkup-");
    try {
      expect(resolveRepoRoot(dir)).toBe(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cwd nested several levels below the bay: walks up to the nearest .flume", async () => {
    const dir = await mkFixtureRoot("flume-walkup-");
    try {
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

  // The one fixture in this suite that cannot be rooted (`mkFixtureRoot`,
  // tests/helpers/fixtureRoot.ts): its subject *is* the walk reaching the
  // filesystem root without meeting a `.flume`, so planting one would delete
  // the behavior under test. It stays on a plain `mkdtemp` and stays
  // vulnerable to a `.flume` littered above `tmpdir()` — a red here means the
  // host has one, not that the fallback regressed.
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

  // `existsSync` collapsed every stat failure to `false`, so a `.flume` that
  // is on disk but unstattable read as "no bay here" and the walk carried on
  // past the operator's own bay — retargeting `repoRoot`, both state dirs,
  // and every `job` verb at an unrelated ancestor, with no line saying so.
  // The probe now splits ENOENT from the rest (`existsLoud`, src/fsProbe.ts).
  it("resolveRepoRoot throws when an ancestor .flume is present but unstattable", async () => {
    const outer = await mkFixtureRoot("flume-walkup-eloop-");
    try {
      const bay = join(outer, "bay");
      const nested = join(bay, "src", "deep");
      await mkdir(nested, { recursive: true });
      const unstattable = join(bay, ".flume");
      // Vacuity guard: the symlink below is the only thing at this path, so
      // the walk really does meet it first.
      expect(existsSync(unstattable)).toBe(false);
      // ELOOP — present, unstattable. Not a permission bit: a root-run test
      // would bypass that.
      await symlink(basename(unstattable), unstattable);
      expect(lstatSync(unstattable).isSymbolicLink()).toBe(true);
      // And the ancestor the old walk silently landed on is really there, so
      // the refusal replaces a wrong answer rather than a crash.
      expect(existsSync(join(outer, ".flume"))).toBe(true);

      expect(() => resolveRepoRoot(nested)).toThrow(/ELOOP/);
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });

  // The throw above is the walk's; this is what an operator sees. The call
  // sits ahead of every try/catch in `main()`, so the throw fell through to
  // `main().catch` — a raw stack on stderr and an unclassified exit 1, the
  // one stat refusal in the CLI a caller could not key on
  // (`.claude/rules/platform-facts.md`, "Exit codes come from
  // `sysexits.h`"). It now maps to EX_IOERR with a `[flume]` line, as the
  // `--job` state-root guard and the `status` probes below already do.
  it(
    "flume exits EX_IOERR naming the stat error when an ancestor .flume is present but unstattable",
    async () => {
      const outer = await mkFixtureRoot("flume-walkup-eloop-cli-");
      try {
        const bay = join(outer, "bay");
        const nested = join(bay, "src", "deep");
        await mkdir(nested, { recursive: true });
        const unstattable = join(bay, ".flume");
        // Vacuity guard: the symlink below is the only thing at this path, so
        // the walk out of `nested` really does meet it first.
        expect(existsSync(unstattable)).toBe(false);
        // ELOOP — present, unstattable. Not a permission bit: a root-run test
        // would bypass that.
        await symlink(basename(unstattable), unstattable);
        expect(lstatSync(unstattable).isSymbolicLink()).toBe(true);

        const status = await runCliStreams(nested, ["status"]);
        expect(status.code).toBe(EX_IOERR);
        expect(status.stderr).toContain("[flume]");
        expect(status.stderr).toMatch(/ELOOP/);
        // The walk's origin and the path it choked on are both named.
        expect(status.stderr).toContain(nested);
        expect(status.stderr).toContain(unstattable);
        // Not a raw stack dump through `main().catch`.
        expect(status.stderr).not.toMatch(/^\s+at /m);
        // And nothing ran over the unresolved root.
        expect(status.stdout).not.toContain("hibernating");
      } finally {
        await rm(outer, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );
});

/**
 * `flume tick` exit-code classification at the process
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
  const dir = await mkFixtureRoot("flume-job-");
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

/**
 * A job-dir `chain.ts` that detonates on load. Inert by construction:
 * the runtime never looks in the job dir for a chain, so any test that ticks
 * or loops past this file proves the repo chain is what loaded.
 */
const INERT_TRAP_CHAIN_SRC =
  `throw new Error("job-local chain.ts was loaded — chains are repo-resident");\n`;

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
 * inherited across the loop → tick boundary — the job-resolution inheritance
 * claim made observable end-to-end.
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
 * (`loadChainModule`, `src/chainLoad.ts`) before the job dir it creates
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
 * A fanout chain whose agent records the branch of the worktree it
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

describe("job resolution — real CLI", () => {
  it(
    "--job alongside explicit FLUME_DIR is a usage error (exit 2); a valueless --job likewise; FLUME_CONFIG_DIR beside --job is no conflict",
    async () => {
      const dir = await mkFixtureRoot("flume-job-conflict-");
      try {
        const conflict = await runCli(dir, ["--job", "foo", "status"], {
          ...hermeticEnv(),
          FLUME_DIR: dir,
        });
        expect(conflict.code).toBe(2);
        expect(conflict.out).toContain("--job foo");
        expect(conflict.out).toContain("FLUME_DIR");
        expect(conflict.out).toContain("one resolution authority");

        // The conflict narrowed to FLUME_DIR: config beside --job
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
    SPAWN_BUDGET_MS,
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

        // FLUME_JOB alone (no flag) refuses identically (resolution parity).
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
    SPAWN_BUDGET_MS,
  );

  // `existsSync` collapsed every stat failure to `false`, so a job state root
  // that is on disk but unstattable reported `does not exist` — sending the
  // operator to `job new` over a directory that is already there, and hiding
  // the mount/permission/symlink fault that is the real cause. The probe now
  // splits ENOENT from the rest (`existsLoud`, src/fsProbe.ts); the CLI maps
  // the throw to EX_IOERR at the process boundary, as the `status` probes do.
  it(
    "the --job state-root guard throws when the resolved flumeDir is present but unstattable",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const jobDir = join(repo.dir, ".flume", "jobs", "loopy");
        await mkdir(dirname(jobDir), { recursive: true });
        // Vacuity guard: the symlink below is the only thing at this path.
        expect(existsSync(jobDir)).toBe(false);
        // ELOOP — present, unstattable. Not a permission bit: a root-run test
        // would bypass that.
        await symlink(basename(jobDir), jobDir);
        expect(lstatSync(jobDir).isSymbolicLink()).toBe(true);

        const status = await runCliStreams(repo.dir, [
          "--job",
          "loopy",
          "status",
        ]);
        expect(status.code).toBe(EX_IOERR);
        expect(status.stderr).toContain("loopy");
        expect(status.stderr).toMatch(/ELOOP/);
        // Not the absence verdict: the state root is on disk.
        expect(status.stderr).not.toContain("does not exist");
        // And the refusal landed before `status` ran over the bad root.
        expect(status.stdout).not.toContain("hibernating");
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
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
    SPAWN_BUDGET_MS,
  );

  it(
    "tick/loop under --job succeed regardless of current branch (wrong-branch guard retired)",
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

        // The env var is honored identically to the flag.
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
    SPAWN_BUDGET_MS,
  );

  it(
    "two state roots under one checkout each run a tick sequentially, no branch switch (a job is a state root)",
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
    SPAWN_BUDGET_MS,
  );

  it(
    "read-only subcommands resolve state to the job root — a job-dir chain.ts is consulted by neither status nor wake nor sleep under --job",
    async () => {
      const repo = await makeJobRepo("main"); // deliberately NOT job/foo
      try {
        await writeRepoConfig(repo.dir, jobEnvProbeChainSrc("probe"));
        const jobDir = join(repo.dir, ".flume", "jobs", "foo");
        await mkdir(jobDir, { recursive: true });
        // Chain inertness: configDir never follows --job, so status's and
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

        // The trap is only a trap if detonating it shows. All three surfaces
        // take the same reported best-effort load (`loadChainForObservation`,
        // `src/cliChainLoad.ts`), so a configDir that had followed --job
        // would print this chain's throw on stderr — which `runCli` folds
        // into `out`. Its absence is what makes "never consulted" an
        // assertion rather than a comment; exit 0 alone never was one.
        for (const r of [status, wake, sleep]) {
          expect(r.out).not.toContain("chain failed to load");
          expect(r.out).not.toContain("job-local chain.ts was loaded");
        }
        // Non-vacuity: the repo chain really did load on all three — a
        // declared-phase wake/sleep that exits 0 over *no* chain would pass
        // the lines above for the wrong reason.
        expect(status.out).not.toContain("chain config not found");
        expect(wake.out).not.toContain("chain config not found");
        expect(sleep.out).not.toContain("chain config not found");
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "a loop-spawned child tick inherits all three env vars regardless of branch — configDir stays repo .flume, job-dir chain.ts inert",
    async () => {
      const repo = await makeJobRepo("job/foo");
      try {
        await writeRepoConfig(repo.dir, jobEnvProbeChainSrc("probe"));
        const jobDir = join(repo.dir, ".flume", "jobs", "foo");
        await mkdir(jobDir, { recursive: true });
        // Chain inertness under tick: the trap would fail the loop if loaded.
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
    SPAWN_BUDGET_MS,
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
    SPAWN_BUDGET_MS,
  );

  it(
    "fanout under FLUME_JOB names the worktree branch flume/<job>/<slug> — namespace flows CLI → dispatcher",
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
        // carry the namespace to the dispatcher identically (same parity).
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
    SPAWN_BUDGET_MS,
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
        // The inner fixture's bay is planted empty (`mkFixtureRoot`), so
        // "wrote nowhere" reads as "wrote nothing into its own bay either" —
        // a stricter claim than the bay's absence.
        expect(readdirSync(join(inner.dir, ".flume"))).toEqual([]);
      } finally {
        await outer.cleanup();
        await inner.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
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
    SPAWN_BUDGET_MS,
  );
});

/**
 * CLI-FIXTURE-ANCESTOR-PROOF — the job-verb half of the rooting pin (the
 * `flume status` half lives in tests/cli.test.ts). `job status` enumerates
 * `<repoRoot>/.flume/jobs`, so it reports the walk-up's answer directly:
 * whichever bay `repoRoot` landed on is the one whose jobs it lists.
 */
describe("CLI fixtures are rooted against an ancestor `.flume` (CLI-FIXTURE-ANCESTOR-PROOF)", () => {
  it("a `.flume` planted above the fixture does not change a job verb's resolved state root", async () => {
    const attic = await mkdtemp(join(tmpdir(), "flume-attic-job-"));
    try {
      // The litter: a bay above every fixture created under it, holding a
      // job no fixture below ever creates.
      await mkdir(join(attic, ".flume", "jobs", "ghostjob"), {
        recursive: true,
      });

      // Control: an unrooted sibling resolves through the litter and lists
      // the attic's job, so the rooted case below has a wrong answer
      // available to it.
      const stray = join(attic, "stray");
      await mkdir(stray, { recursive: true });
      const unrooted = await runCli(stray, ["job", "status"]);
      expect(unrooted.code).toBe(0);
      expect(unrooted.out).toContain("ghostjob");

      const dir = await mkFixtureRoot("flume-rooted-job-", attic);
      const rooted = await runCli(dir, ["job", "status"]);
      expect(rooted.code).toBe(0);
      expect(rooted.out).toContain("no jobs");
      expect(rooted.out).not.toContain("ghostjob");
    } finally {
      await rm(attic, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * Agreement pin (`.claude/rules/engineering.md`, *A seam gate reads what the
 * real writer wrote*): `job new` writes a job's state root and `--job`
 * resolves one, and the two used to spell `<repoRoot>/.flume/jobs/<name>`
 * apiece — a claim the unit cases above cannot reach, because each composes
 * its own expected path by the tester's hand and would ship a one-sided
 * rename green. Here the real `jobNew` seeds the job, the dir it actually
 * created is read back out of its own seed commit, and the real
 * `resolveStateDirs` is asked where `--job` points, with nothing composed by
 * this file in between.
 */
it("`--job <name>` resolves the state root `job new <name>` seeded", async () => {
  const repo = await makeJobRepo("main");
  try {
    await writeRepoConfig(repo.dir, minimalChainSrc());
    await jobNew({ repoRoot: repo.dir, name: "seeded", log: () => {} });

    // Where the writer put the job, taken from the seed commit it made.
    const tracked = (
      await gitOut(repo.dir, ["show", "--name-only", "--format=", "HEAD"])
    )
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(tracked.length).toBeGreaterThan(0);
    const seeded = new Set(tracked.map((p) => dirname(resolve(repo.dir, p))));
    expect(seeded.size).toBe(1);
    const seededDir = [...seeded][0]!;

    const env: NodeJS.ProcessEnv = {};
    const { flumeDir, configDir } = resolveStateDirs(env, repo.dir, "seeded");
    expect(flumeDir).toBe(seededDir);
    expect(existsSync(flumeDir)).toBe(true);

    // Config never follows the job: the chain `jobNew` loaded is still the
    // one `--job` resolves `configDir` to.
    expect(configDir).not.toBe(flumeDir);
    expect(existsSync(join(configDir, "chain.ts"))).toBe(true);
  } finally {
    await repo.cleanup();
  }
});
