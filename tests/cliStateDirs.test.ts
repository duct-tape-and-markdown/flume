/**
 * State-root and config-dir resolution seam — the suite that moves with
 * `src/cliStateDirs.ts`. Unit-level `resolveStateDirs`/`resolveRepoRoot`
 * cases plus the real-CLI resolution and cross-repo-inheritance suites that
 * exercise the same seam end-to-end.
 *
 * `FLUME_DIR` is the one authority over the state root (spec/cli.md,
 * *State-root and config-dir resolution*), so the cases below that name
 * `--job` / `FLUME_JOB` are absence cases: the selector is gone, and the
 * variable it rode on retargets nothing and is written back nowhere.
 */

import { existsSync, lstatSync, readdirSync } from "node:fs";
import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CrossRepoFlumeDirError,
  resolveRepoRoot,
  resolveStateDirs,
} from "../src/cliStateDirs.ts";
import { Baton } from "../src/Baton.ts";
import { EX_IOERR } from "../src/cli.ts";
import { mkFixtureRoot, mkTempDir } from "./helpers/fixtureRoot.ts";
import { hermeticEnv } from "./helpers/gitEnv.ts";
import { minimalChainSrc, writeRepoConfig } from "./helpers/repoChain.ts";
import { makeScratchRepo } from "./helpers/scratchRepo.ts";
import {
  SPAWN_BUDGET_MS,
  runCli,
  runCliStreams,
} from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

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
 * The selector's absence at the arithmetic. `FLUME_JOB` was the env half of a
 * `--job <name>` that resolved `flumeDir` to `<repoRoot>/.flume/jobs/<name>`;
 * one checkout resolves one state root (`spec/jobs.md`, *The checkout is the
 * unit of isolation*), so the variable is now an ordinary string in the
 * environment that this resolution neither reads nor writes.
 */
it("FLUME_JOB in the environment does not retarget the state root", () => {
  const env: NodeJS.ProcessEnv = { FLUME_JOB: "alpha" };
  const { flumeDir, configDir } = resolveStateDirs(env, repoRoot);

  const bay = join(repoRoot, ".flume");
  expect(flumeDir).toBe(bay);
  expect(configDir).toBe(bay);
  // Untouched, not consumed: the resolution has no opinion on a var it does
  // not read, so it neither rewrites nor clears the caller's own value.
  expect(env.FLUME_JOB).toBe("alpha");
  // And the state root the write-back publishes is the bay, not a job dir.
  expect(env.FLUME_DIR).toBe(bay);
  expect(env.FLUME_DIR).not.toContain("alpha");
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
  // the behavior under test. It stays on a bare root and stays vulnerable to
  // a `.flume` littered above the host temp dir — a red here means the host
  // has one, not that the fallback regressed.
  it("no .flume anywhere above cwd: falls back to cwd unchanged", async () => {
    const dir = await mkTempDir("flume-walkup-nodock-");
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
  // past the operator's own bay — retargeting `repoRoot` and both state dirs
  // at an unrelated ancestor, with no line saying so. The probe now splits
  // ENOENT from the rest (`existsLoud`, src/fsProbe.ts).
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
  // `status` probes do.
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
 * A chain.ts whose singleton phase records every `FLUME_*` key it observes
 * *inside the child tick process* to `<FLUME_DIR>/observed-env.json`. The
 * supervisor spawns the tick with no `env:` override, so what lands in that
 * file is exactly what the child inherited across the loop → tick boundary —
 * the write-back's reach made observable end-to-end.
 */
function envProbeChainSrc(phaseName: string): string {
  return (
    `import { writeFileSync } from "node:fs";\n` +
    `import { join } from "node:path";\n` +
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "env probe",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `},\n` +
    `agent: {\n` +
    `  name: "env-probe",\n` +
    `  async invoke() {\n` +
    `    writeFileSync(\n` +
    `      join(process.env.FLUME_DIR ?? "", "observed-env.json"),\n` +
    `      JSON.stringify(\n` +
    `        Object.fromEntries(\n` +
    `          Object.entries(process.env).filter(([k]) => k.startsWith("FLUME_")),\n` +
    `        ),\n` +
    `      ),\n` +
    `    );\n` +
    `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
    `  },\n` +
    `} });\n`
  );
}

/**
 * CLI-STATEROOT-RESOLVE-BEFORE-DISPATCH — a chain whose factory (not a phase
 * agent) records `process.env.FLUME_DIR` to `<cwd>/observed-flume-dir.json`
 * at load time. Every chain-loading verb invokes the factory synchronously
 * (`loadChainModule`, `src/chainLoad.ts`), so the probe writes beside the
 * repo root the verb ran in.
 */
function loadTimeProbeChainSrc(): string {
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

describe("state-dir resolution — real CLI", () => {
  it(
    "the CLI resolves flumeDir/configDir ahead of dispatch: a chain factory reading process.env.FLUME_DIR sees the canonicalized value, not the caller's raw relative one (CLI-STATEROOT-RESOLVE-BEFORE-DISPATCH)",
    async () => {
      const repo = await makeScratchRepo("flume-state-dirs-", "main");
      try {
        await writeRepoConfig(repo.dir, loadTimeProbeChainSrc());
        const observedPath = join(repo.dir, "observed-flume-dir.json");

        const ran = await runCli(repo.dir, ["check"], {
          ...hermeticEnv(),
          FLUME_DIR: "tmp/relative-state",
        });
        // Non-vacuity: the verb really loaded the chain, so the probe below
        // is reading a value this run wrote.
        expect(ran.code).toBe(0);
        expect(existsSync(observedPath)).toBe(true);

        const observed = JSON.parse(
          await readFile(observedPath, "utf8"),
        ) as { FLUME_DIR: string };
        expect(observed.FLUME_DIR).toBe(resolve(repo.dir, "tmp/relative-state"));
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  /**
   * The selector's absence at the command line. `--job <name>` was extracted
   * wherever it appeared and composed with every subcommand; nothing extracts
   * it now, so the leading spelling is an unknown command and the trailing one
   * is a stray positional the verb refuses. Both land on exit 2 — a typed
   * `--job` never silently resolves a root again.
   */
  it(
    "an invocation carrying --job exits 2",
    async () => {
      const repo = await makeScratchRepo("flume-state-dirs-", "main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        // The state root `--job foo` used to resolve: on disk, so the refusal
        // below is the selector's absence and not a missing directory.
        await mkdir(join(repo.dir, ".flume", "jobs", "foo"), {
          recursive: true,
        });

        // Control: the same fixture answers the subcommand on its own.
        const bare = await runCli(repo.dir, ["status"]);
        expect(bare.code).toBe(0);

        const leading = await runCli(repo.dir, ["--job", "foo", "status"]);
        expect(leading.code).toBe(2);
        expect(leading.out).toContain("unknown command: --job");

        // Trailing, on a verb that consumes no positional of its own.
        const trailing = await runCli(repo.dir, ["tick", "--job", "foo"]);
        expect(trailing.code).toBe(2);

        const valueless = await runCli(repo.dir, ["--job"]);
        expect(valueless.code).toBe(2);
        expect(valueless.out).toContain("unknown command: --job");

        // Nothing was resolved under the name: no run touched the directory.
        expect(
          readdirSync(join(repo.dir, ".flume", "jobs", "foo")),
        ).toEqual([]);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  /**
   * The write-back's vocabulary, read off the child that consumes it. The
   * resolution publishes the two dirs and the provenance stamp; `FLUME_JOB`
   * was the fourth, and a var this resolution never reads is a var it never
   * writes.
   */
  it(
    "FLUME_JOB is not written back into a spawned tick's environment",
    async () => {
      const repo = await makeScratchRepo("flume-state-dirs-", "main");
      try {
        await writeRepoConfig(repo.dir, envProbeChainSrc("probe"));
        const bay = join(repo.dir, ".flume");
        new Baton(bay).wake("probe");

        const loop = await runCli(repo.dir, ["loop", "--max", "1"]);
        expect(loop.code).toBe(0);

        // Non-vacuity: the child tick really ran and really reported its env.
        const observed = JSON.parse(
          await readFile(join(bay, "observed-env.json"), "utf8"),
        ) as Record<string, string>;
        expect(observed.FLUME_DIR).toBe(bay);
        expect(observed.FLUME_CONFIG_DIR).toBe(bay);
        expect(observed.FLUME_DIR_RESOLVED_FOR).toBe(repo.dir);

        expect(Object.keys(observed)).not.toContain("FLUME_JOB");
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
      const outer = await makeScratchRepo("flume-state-dirs-", "main");
      const inner = await makeScratchRepo("flume-state-dirs-", "main");
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
      const outer = await makeScratchRepo("flume-state-dirs-", "main");
      const inner = await makeScratchRepo("flume-state-dirs-", "main");
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
