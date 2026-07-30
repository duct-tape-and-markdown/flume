/**
 * §12 / §14 — CLI env canonicalization.
 *
 * After resolution, `process.env.FLUME_DIR` / `process.env.FLUME_CONFIG_DIR`
 * must hold the **absolute resolved** state root, so a chain loaded later in
 * the same process (and any spawned child) reads one canonical value rather
 * than re-deriving the default or a coincidentally-equal `configDir`. Exercised
 * at the resolution seam (`resolveStateDirs`) for the env-unset (default) and
 * env-set-relative cases.
 */

import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";

import {
  JobResolutionConflictError,
  isInvokedDirectly,
  resolveRepoRoot,
  resolveStateDirs,
  tickExitCode,
  loopExitCode,
  loopCompletionSummary,
} from "../src/cli.ts";
import { Baton } from "../src/Baton.ts";
import {
  EX_TERMINAL_MISCONFIG,
  EX_MOUNT_DEAD,
  type TickOutcome,
  type SuperviseResult,
} from "../src/Dispatcher.ts";

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
    // resolution, so they win, and the job name survives for the guard.
    // resolve() drive-qualifies on win32 — the untouched assertion needs a
    // true absolute input.
    const inherited = resolve(jobDir);
    const env: NodeJS.ProcessEnv = {
      FLUME_JOB: "alpha",
      FLUME_DIR: inherited,
      FLUME_CONFIG_DIR: inherited,
    };
    const { flumeDir, configDir, job } = resolveStateDirs(env, repoRoot);

    expect(flumeDir).toBe(inherited);
    expect(configDir).toBe(inherited);
    expect(job).toBe("alpha");
    expect(env.FLUME_JOB).toBe("alpha");
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
 * v0.7 §10 (amended 2026-07-30) — engine↔pin handshake via
 * launcher-defers-to-pin (the gradlew pattern). The handshake sits ahead of
 * every other line in `main()` (`src/cli.ts`), before `--job` extraction,
 * before `--help`/`--version`, before state-dir resolution — a subprocess is
 * the only way to prove it actually fires there rather than somewhere
 * downstream. `runCli` (defined below, hoisted for use here) spawns the real
 * CLI through tsx; each fixture distinguishes a fabricated local install
 * from the real running engine by version-stamping it well outside the real
 * engine's own version range.
 *
 * The amendment moved the check path from a fixed bay-root literal to the
 * `resolveStateDirs`-derived `flumeDir` — job-scoped
 * (`<repoRoot>/.flume/jobs/<name>/node_modules/@dtmd/flume`) under
 * `--job`/`FLUME_JOB`, the same link `job new`'s `ensureFlumeLink`
 * (`src/job.ts:133-150`) actually provisions; unscoped, it reduces to the
 * pre-amendment bare-bay literal. `writeLocalInstall` takes the job name so
 * both shapes share one fixture.
 */
describe("engine↔pin handshake — v0.7 §10", () => {
  const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

  async function engineVersion(): Promise<string> {
    const pkg = JSON.parse(
      await readFile(join(REPO_ROOT, "package.json"), "utf8"),
    ) as { version: string };
    return pkg.version;
  }

  /**
   * A runnable stand-in for a provisioned local install — the same junction
   * target shape `job new` links to (`src/job.ts:133-150`), fabricated
   * directly here rather than through `job new` since the handshake only
   * ever reads it. Bare bay (no `job`): `<dir>/.flume/node_modules/@dtmd/flume`.
   * Job-scoped: `<dir>/.flume/jobs/<job>/node_modules/@dtmd/flume`.
   */
  async function writeLocalInstall(
    dir: string,
    version: string,
    job?: string,
  ): Promise<void> {
    const root = job
      ? join(dir, ".flume", "jobs", job, "node_modules", "@dtmd", "flume")
      : join(dir, ".flume", "node_modules", "@dtmd", "flume");
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "@dtmd/flume",
        version,
        bin: { flume: "./bin/fake.js" },
      }),
      "utf8",
    );
    await writeFile(
      join(root, "bin", "fake.js"),
      `console.log("LOCAL-INSTALL-RAN ${version} " + process.argv.slice(2).join(" "));\n`,
      "utf8",
    );
  }

  it(
    "a bare bay with the local install present re-execs it regardless of the global engine's own version",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-pin-local-"));
      try {
        await writeLocalInstall(dir, "9.9.9-local-fixture");

        const result = await runCli(dir, ["status"]);

        expect(result.code).toBe(0);
        expect(result.out).toContain(
          "LOCAL-INSTALL-RAN 9.9.9-local-fixture status",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "the same bare bay with the local install removed refuses (exit 2), naming the pin, both versions, and the bare-bay literal path — unchanged by the amendment",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-pin-absent-"));
      try {
        await mkdir(join(dir, ".flume"), { recursive: true });
        await writeFile(
          join(dir, "package.json"),
          JSON.stringify({
            name: "host",
            dependencies: { "@dtmd/flume": "9.9.9-pinned" },
          }),
          "utf8",
        );

        const result = await runCli(dir, ["status"]);

        expect(result.code).toBe(2);
        expect(result.out).toContain("9.9.9-pinned");
        expect(result.out).toContain(await engineVersion());
        expect(result.out).toContain(
          join(dir, ".flume", "node_modules", "@dtmd", "flume"),
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "an unpinned bay behaves byte-identical to today: no local install, no pin, the handshake is a no-op",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-pin-unpinned-"));
      try {
        const result = await runCli(dir, ["job", "status"]);

        expect(result.code).toBe(0);
        expect(result.out).toContain("no jobs");
        expect(result.out).not.toContain("LOCAL-INSTALL-RAN");
        expect(result.out).not.toContain("pins @dtmd/flume");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "a --job-scoped bay checks the job-scoped install path (v0.7 §10 amendment): re-execs the install at <repoRoot>/.flume/jobs/<name>/node_modules/@dtmd/flume, not the bare-bay literal",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-pin-job-local-"));
      try {
        await writeLocalInstall(dir, "9.9.9-job-fixture", "alpha");

        const result = await runCli(dir, ["--job", "alpha", "status"]);

        expect(result.code).toBe(0);
        expect(result.out).toContain(
          "LOCAL-INSTALL-RAN 9.9.9-job-fixture --job alpha status",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "a FLUME_JOB-scoped bay (env instead of --job) checks the same job-scoped install path",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-pin-flumejob-local-"));
      try {
        await writeLocalInstall(dir, "9.9.9-envjob-fixture", "alpha");

        const result = await runCli(dir, ["status"], {
          ...hermeticEnv(),
          FLUME_JOB: "alpha",
        });

        expect(result.code).toBe(0);
        expect(result.out).toContain(
          "LOCAL-INSTALL-RAN 9.9.9-envjob-fixture status",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "a --job-scoped bay pinned but not provisioned at the job-scoped path refuses (exit 2) naming the job-scoped path, even if a bare-bay install exists",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-pin-job-absent-"));
      try {
        await writeFile(
          join(dir, "package.json"),
          JSON.stringify({
            name: "host",
            dependencies: { "@dtmd/flume": "9.9.9-pinned" },
          }),
          "utf8",
        );
        // A bare-bay install exists but must not satisfy a job-scoped check.
        await writeLocalInstall(dir, "9.9.9-bare-fixture");

        const result = await runCli(dir, ["--job", "alpha", "status"]);

        expect(result.code).toBe(2);
        expect(result.out).not.toContain("LOCAL-INSTALL-RAN");
        expect(result.out).toContain("9.9.9-pinned");
        expect(result.out).toContain(await engineVersion());
        expect(result.out).toContain(
          join(dir, ".flume", "jobs", "alpha", "node_modules", "@dtmd", "flume"),
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "a bay invoked via `job run <name>` (no --job flag) checks the same job-scoped install path the job-run rewrite would land on",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-pin-jobrun-local-"));
      try {
        await writeLocalInstall(dir, "9.9.9-jobrun-fixture", "alpha");

        const result = await runCli(dir, ["job", "run", "alpha"]);

        expect(result.code).toBe(0);
        expect(result.out).toContain(
          "LOCAL-INSTALL-RAN 9.9.9-jobrun-fixture job run alpha",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

/**
 * §3 / v0.7 §4 — `flume tick` exit-code classification at the process
 * boundary: 78 (`EX_CONFIG`) terminal misconfiguration, 69 (`EX_UNAVAILABLE`,
 * `EX_MOUNT_DEAD`) the mount-dead failure class (chain never resolved),
 * 0 clean hibernate or ordinary work. Exercised at the mapping seam
 * (`tickExitCode`); the loop-process-boundary integration suite proves 78
 * and 69 end-to-end through a real subprocess.
 */
describe("tickExitCode — §3 axis classification", () => {
  it("terminal misconfiguration → 78 (EX_CONFIG)", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      terminal: { kind: "orphaned-awake", phases: ["ghost"] },
      awakeAfter: ["ghost"],
      summary: "awake flags reference unknown phases: ghost",
    };
    expect(EX_TERMINAL_MISCONFIG).toBe(78);
    expect(tickExitCode(outcome)).toBe(78);
  });

  it("clean hibernation → 0", () => {
    const outcome: TickOutcome = {
      hibernated: true,
      awakeAfter: [],
      summary: "no phases awake; hibernating",
    };
    expect(tickExitCode(outcome)).toBe(0);
  });

  it("mount-dead: chain resolution failure (v0.7 §4) → 69 (EX_UNAVAILABLE)", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      failed: true,
      awakeAfter: ["plan"],
      summary: "chain resolution failed: boom; no work",
    };
    expect(EX_MOUNT_DEAD).toBe(69);
    expect(tickExitCode(outcome)).toBe(EX_MOUNT_DEAD);
  });

  it("ordinary work tick → 0", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      phaseName: "plan",
      awakeAfter: ["build"],
      summary: "plan committed abcd1234 → build",
    };
    expect(tickExitCode(outcome)).toBe(0);
  });

  it("CJS-context usage error (v0.7 §5) → 2, checked ahead of the mount-dead fallback", () => {
    const outcome: TickOutcome = {
      hibernated: false,
      usageError: true,
      awakeAfter: ["plan"],
      summary: '.flume/chain.ts failed to load: ... add "type": "module" ...',
    };
    expect(tickExitCode(outcome)).toBe(2);

    // usageError and failed are documented as mutually exclusive, but the
    // mapping itself must still prefer 2 if both were ever set — the §5
    // usage refusal is never allowed to collapse back into EX_MOUNT_DEAD.
    const both: TickOutcome = { ...outcome, failed: true };
    expect(tickExitCode(both)).toBe(2);
  });
});

/**
 * v0.7 §4 amendment — `flume loop` / `job run`'s own exit-code decision at
 * the CLI/loop boundary: non-zero iff at least one child tick errored AND
 * the run shipped nothing; `terminal`/`mountDead` still propagate their own
 * distinct codes unchanged. The completion summary names surfaced tick
 * errors even on a 0 exit (partial success) — they must not vanish
 * silently. Exercised at the mapping seam (`loopExitCode` /
 * `loopCompletionSummary`), mirroring `tickExitCode` above; the real
 * process-boundary mechanics (child spawn, disk artifact) are proved in
 * `Dispatcher.test.ts`'s `superviseLoop` suite.
 */
describe("loopExitCode / loopCompletionSummary — §4 amended exit-code contract", () => {
  it("a run with one errored tick and one shipped entry: exits 0, summary names the error", () => {
    const result: SuperviseResult = {
      ticks: 2,
      hibernated: true,
      shippedTags: ["SHIPPED-ENTRY"],
      erroredTicks: ["build: no commit (gate-revert) → hibernate"],
    };
    expect(loopExitCode(result)).toBe(0);
    expect(loopCompletionSummary(result)).toContain("SHIPPED-ENTRY");
    expect(loopCompletionSummary(result)).toContain("gate-revert");
  });

  it("at least one errored tick AND nothing shipped → 1", () => {
    const result: SuperviseResult = {
      ticks: 1,
      hibernated: true,
      shippedTags: [],
      erroredTicks: ["plan: no commit (voluntary-bail) → hibernate"],
    };
    expect(loopExitCode(result)).toBe(1);
    expect(loopCompletionSummary(result)).toContain("voluntary-bail");
  });

  it("settled with nothing to do (no errors, nothing shipped) → 0, no completion summary", () => {
    const result: SuperviseResult = {
      ticks: 1,
      hibernated: true,
      shippedTags: [],
      erroredTicks: [],
    };
    expect(loopExitCode(result)).toBe(0);
    expect(loopCompletionSummary(result)).toBeUndefined();
  });

  it("terminal misconfiguration propagates 78 regardless of shipped/errored counts", () => {
    const result: SuperviseResult = {
      ticks: 1,
      hibernated: false,
      terminal: { kind: "orphaned-awake", phases: ["ghost"] },
      shippedTags: [],
      erroredTicks: [],
    };
    expect(loopExitCode(result)).toBe(EX_TERMINAL_MISCONFIG);
  });

  it("mount-dead propagates 69 regardless of shipped/errored counts", () => {
    const result: SuperviseResult = {
      ticks: 1,
      hibernated: false,
      mountDead: true,
      shippedTags: [],
      erroredTicks: [],
    };
    expect(loopExitCode(result)).toBe(EX_MOUNT_DEAD);
  });
});

/**
 * v0.4 §2a — cross-process loop lock at `<flumeDir>/loop.pid`. One supervisor
 * per state root: a second `flume loop` is refused while the recorded pid is
 * alive; a stale pidfile (dead pid) is reclaimed.
 *
 * The lock branch resolves before `superviseLoop` spawns any child tick, so
 * `--max 0` exercises both outcomes with a single real CLI subprocess each —
 * no chain.ts, no git repo, no child processes. That keeps these fast-lane
 * safe despite spawning the real `flume loop` (the lock lives inline in the
 * CLI's `main()`; only a real process can exercise it).
 */

// Run the source CLI through the project's own `tsx` (no build step) — via
// `node <tsx cli.mjs>`, not the `.bin/tsx` shim, which is a `.cmd` shell
// script on win32 that `execFile` cannot spawn without a shell (§6 spawn
// discipline). Absolute paths so cwd can be the temp state root.
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TSX_CLI = fileURLToPath(
  new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url),
);

/**
 * §3 — `isInvokedDirectly` (`src/cli.ts:854`), the seam gating `main()`.
 * Unit-level rather than a subprocess: the seam takes `argv1` and answers
 * against this module's own `import.meta.url`, so calling it directly with
 * `CLI` (this file's own import of cli.ts) exercises the exact comparison
 * `main()` gates on, without the overhead of spawning `tsx` per case.
 */
describe("isInvokedDirectly — §3 CLI entry survives junctions", () => {
  it("argv[1] undefined is never direct (unchanged guard)", () => {
    expect(isInvokedDirectly(undefined)).toBe(false);
  });

  it("a plain module import runs nothing: this test process's own argv[1] never matches cli.ts", () => {
    // This suite imports cli.ts without ever invoking it as the entry
    // script — process.argv[1] here is the test runner's own entry, not
    // cli.ts's URL, so the seam must refuse it exactly as it would refuse
    // any other importer (tests, embedding).
    expect(isInvokedDirectly(process.argv[1])).toBe(false);
  });

  it("realpathSync throwing on a nonexistent argv[1] falls back to the raw comparison instead of crashing the import", () => {
    const missing = join(tmpdir(), "flume-cli-junction-missing", "cli.js");
    expect(() => isInvokedDirectly(missing)).not.toThrow();
    expect(isInvokedDirectly(missing)).toBe(false);
  });

  it("a directory-junction-equivalent argv[1] — raw path differs from the realpath — still resolves as direct", async () => {
    const linkParent = await mkdtemp(join(tmpdir(), "flume-cli-junction-"));
    const linkDir = join(linkParent, "src-link");
    try {
      await symlink(
        dirname(CLI),
        linkDir,
        process.platform === "win32" ? "junction" : "dir",
      );
      const junctioned = join(linkDir, "cli.ts");

      // The DEV-9191 shape: the raw invoked path differs from the file's
      // realpath — exactly what a junction- or symlink-based install
      // (pnpm's linked store, v0.5 §4) produces.
      expect(junctioned).not.toBe(CLI);
      expect(realpathSync(junctioned)).toBe(realpathSync(CLI));

      expect(isInvokedDirectly(junctioned)).toBe(true);
    } finally {
      await rm(linkParent, { recursive: true, force: true });
    }
  });
});

/**
 * A copy of this process's env with the canonical FLUME_DIR /
 * FLUME_CONFIG_DIR / FLUME_JOB stripped, so the spawned CLI resolves the temp
 * dir's `.flume` default (or the test's own job resolution). Without this the
 * suite is not hermetic: run under a flume harness (whose canonicalized env
 * the vitest process inherits), the child would lock — or refuse against —
 * the outer state root.
 */
function hermeticEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.FLUME_DIR;
  delete env.FLUME_CONFIG_DIR;
  delete env.FLUME_JOB;
  return env;
}

/** Spawn one real `flume <args>`; collect combined output + exit code. */
async function runCli(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = hermeticEnv(),
): Promise<{ out: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [TSX_CLI, CLI, ...args],
      { cwd, env },
    );
    return { out: stdout + stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.code ?? 1 };
  }
}

/**
 * v0.7 §5, render-command seam: `main()`'s `render` branch wraps
 * `resolveChain()` in its own try/catch for `CjsContextLoadError`
 * (`src/cli.ts:872-881`) — independent of, and exercised separately from,
 * Dispatcher.tick()'s `usageError` path (`tickExitCode` above,
 * `Dispatcher.test.ts`'s loadChainModule suite).
 *
 * `runCli` above cannot reproduce the bug: it boots the whole CLI through
 * tsx's own CLI entry (`tsx/dist/cli.mjs`), which registers ESM loader
 * hooks for the *entire* process, so the nested load of the fixture's
 * `.flume/chain.ts` parses fine regardless of the host's package.json
 * (verified by hand — same fixture, `runCli` exits 0). Production's real
 * shape (`bin/flume.js`) is a plain, non-tsx-bootstrapped `node` process
 * that calls `tsImport` only for that nested chain load — reproduced here
 * by building `dist/` once and spawning the compiled `dist/cli.js`
 * directly, matching `bin/flume.js`'s own invocation.
 */
describe("flume render — CJS-context host refusal via the real CLI (v0.7 §5)", () => {
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
    'a CJS-context host (package.json missing "type": "module") refuses render\'s chain load, naming the fix, and exits 2',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-cjs-render-"));
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

        const result = await runDistCli(dir, ["render", "probe"]);

        expect(result.code).toBe(2);
        expect(result.out).toContain("[flume]");
        expect(result.out).toContain('"type": "module"');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

describe("§2a cross-process loop lock — real `flume loop` against <flumeDir>/loop.pid", () => {
  it(
    "refuses a second loop while the recorded pid is alive, leaving the pidfile untouched",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-loop-lock-"));
      try {
        const flumeDir = join(dir, ".flume");
        const pidPath = join(flumeDir, "loop.pid");
        // The vitest worker itself plays the live prior supervisor — its pid
        // is guaranteed alive for the duration of the spawned loop.
        await mkdir(flumeDir, { recursive: true });
        await writeFile(pidPath, String(process.pid), "utf8");

        const r = await runCli(dir, ["loop", "--max", "0"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain(
          `another loop (pid ${process.pid}) already runs`,
        );
        // The refusal names the state root — the lock's scope is flumeDir,
        // not the repo (§2a: a relocated dock carries its lock with it).
        expect(r.out).toContain(flumeDir);
        expect(r.out).toContain("refusing");
        // The holder's pidfile survives the refused contender untouched.
        expect(await readFile(pidPath, "utf8")).toBe(String(process.pid));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "reclaims a stale pidfile (dead pid): the loop runs and drops the lock on exit",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-loop-lock-"));
      try {
        const flumeDir = join(dir, ".flume");
        const pidPath = join(flumeDir, "loop.pid");
        // Harvest a genuinely dead pid: spawn a no-op node child and wait
        // for it to exit before recording its pid as the stale holder.
        const probe = exec(process.execPath, ["-e", ""]);
        const deadPid = probe.child.pid;
        await probe;
        expect(deadPid).toBeDefined();
        await mkdir(flumeDir, { recursive: true });
        await writeFile(pidPath, String(deadPid), "utf8");

        const r = await runCli(dir, ["loop", "--max", "0"]);

        // Not refused — the dead holder was reclaimed and the loop ran to
        // its --max 0 stop.
        expect(r.code).toBe(0);
        expect(r.out).not.toContain("refusing");
        expect(r.out).toContain("reached --max 0");
        // The reclaiming loop took the lock over and dropped it on exit; a
        // refusal would have left the stale pidfile in place.
        expect(existsSync(pidPath)).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

// ---------- v0.6 §2/§3 — job resolution through the real CLI ----------

/**
 * Scratch git repo on a chosen branch — the wrong-branch guard reads HEAD via
 * `git rev-parse`, so only a real repo can exercise it.
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
 * or renders past this file proves the repo chain is what loaded.
 */
const INERT_TRAP_CHAIN_SRC =
  `throw new Error("job-local chain.ts was loaded — chains are repo-resident (v0.6 §2)");\n`;

/**
 * A minimal, otherwise-valid chain — never ticked in the §6 friction tests
 * below, just loaded for its declared fields. `friction` omitted leaves the
 * field undeclared entirely (§2: undeclared turns every §6 behavior off).
 */
function minimalChainSrc(friction?: string): string {
  return (
    `export default {\n` +
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
    `};\n`
  );
}

/**
 * §6 (v0.6.2) — `flume status`'s friction line (`src/cli.ts:660-667`,
 * `frictionCountLine`): a count of files in the declared friction dir,
 * appended only when declared and non-empty. Best-effort: a missing/broken
 * chain never fails `status` (covered elsewhere); these tests hold the
 * chain fixed and vary only the friction declaration/dir contents.
 */
describe("flume status — friction line (§6)", () => {
  it("appends a friction count line when Chain.friction is declared and its dir holds files", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      const frictionDir = join(repo.dir, ".flume", "friction");
      await mkdir(frictionDir, { recursive: true });
      await writeFile(join(frictionDir, "a.md"), "note a\n");
      await writeFile(join(frictionDir, "b.md"), "note b\n");

      const r = await runCli(repo.dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("hibernating");
      expect(r.out).toContain("friction: 2 note(s) await routing");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("omits the friction line when the declared dir exists but holds no files", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      await mkdir(join(repo.dir, ".flume", "friction"), { recursive: true });

      const r = await runCli(repo.dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("friction:");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("omits the friction line when Chain.friction is undeclared, even with a stray same-named dir present", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc());
      const strayDir = join(repo.dir, ".flume", "friction");
      await mkdir(strayDir, { recursive: true });
      await writeFile(join(strayDir, "a.md"), "note a\n");

      const r = await runCli(repo.dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("friction:");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);
});

/**
 * §6 (v0.6.2) — `flume job status`'s per-job friction count
 * (`src/cli.ts:356-387`, `runJobVerb`'s `status` branch): the repo chain's
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
    `export default {\n` +
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
    `};\n` +
    `export const agent = {\n` +
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
    `export default {\n` +
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
    `};\n` +
    `export const agent = {\n` +
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
    `};\n`
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
        // composes instead of erroring.
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
    "wrong-branch guard refuses tick and loop off job/<name>, naming both branches; FLUME_JOB alone triggers it identically",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const tick = await runCli(repo.dir, ["--job", "foo", "tick"]);
        expect(tick.code).toBe(1);
        expect(tick.out).toContain("'job/foo'");
        expect(tick.out).toContain("'main'");
        expect(tick.out).toContain("refusing tick");

        const loop = await runCli(repo.dir, ["--job", "foo", "loop", "--max", "0"]);
        expect(loop.code).toBe(1);
        expect(loop.out).toContain("refusing loop");
        // Refused before dispatch — the loop never took its lock.
        expect(
          existsSync(join(repo.dir, ".flume", "jobs", "foo", "loop.pid")),
        ).toBe(false);

        // The env var is honored identically to the flag (§3).
        const envOnly = await runCli(repo.dir, ["tick"], {
          ...hermeticEnv(),
          FLUME_JOB: "foo",
        });
        expect(envOnly.code).toBe(1);
        expect(envOnly.out).toContain("'job/foo'");
      } finally {
        await repo.cleanup();
      }
    },
    60_000,
  );

  it(
    "read-only subcommands (status, wake, sleep, render) skip the guard: state lands in the job root, chain + prompt load from repo .flume — a job-dir chain.ts is inert",
    async () => {
      const repo = await makeJobRepo("main"); // deliberately NOT job/foo
      try {
        await writeRepoConfig(repo.dir, jobEnvProbeChainSrc("probe"));
        const jobDir = join(repo.dir, ".flume", "jobs", "foo");
        await mkdir(jobDir, { recursive: true });
        // §2 inertness: if resolution ever looked here, render would explode.
        await writeFile(join(jobDir, "chain.ts"), INERT_TRAP_CHAIN_SRC, "utf8");

        const status = await runCli(repo.dir, ["--job", "foo", "status"]);
        expect(status.code).toBe(0);
        expect(status.out).toContain("hibernating");

        // wake lands the flag under the JOB state root — resolution proof.
        const wake = await runCli(repo.dir, ["--job", "foo", "wake", "probe"]);
        expect(wake.code).toBe(0);
        expect(existsSync(join(jobDir, "awake", "probe"))).toBe(true);

        // render loads the REPO chain and its sibling prompts/ via the
        // unchanged promptPath join (§3/§6 shared-prompt case) — the trap
        // chain in the job dir never loads.
        const render = await runCli(repo.dir, ["--job", "foo", "render", "probe"]);
        expect(render.code).toBe(0);
        expect(render.out).toContain("job probe prompt");
        expect(render.out).not.toContain("job-local chain.ts was loaded");

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
    "on job/<name> the guard passes and a loop-spawned child tick inherits all three env vars — configDir stays repo .flume, job-dir chain.ts inert",
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

        const render = await runCli(repo.dir, ["--job", "foo", "render", "probe"], env);
        expect(render.code).toBe(0);
        expect(render.out).toContain("env-dir prompt");

        const jobDir = join(repo.dir, ".flume", "jobs", "foo");
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
                summary: "namespace probe entry",
                per: { path: "spec/RELEASE-v0.1.md", section: "5. Tests" },
                gate: { kind: "open" },
                dependsOnForks: [],
                files: {
                  new: [],
                  edit: [{ path: "src/ns-probe.ts", description: "edit" }],
                  retire: [],
                },
                schemaDelta: "none",
                tests: [],
                acceptance: "green",
              },
            ],
            null,
            2,
          ) + "\n",
          "utf8",
        );
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
