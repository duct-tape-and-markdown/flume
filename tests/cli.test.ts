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

import { execFile, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";

import {
  CrossRepoFlumeDirError,
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
  type TickVerdict,
} from "../src/Dispatcher.ts";
import { CLI, TSX_CLI, gitOut, hermeticEnv, runCli } from "./helpers/subprocess.ts";

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
 * CLI-HELP-TICK-MISSING-EXIT2 — `flume tick --help`'s documented exit-code
 * list must cover `tickExitCode`'s actual range (0/1/2/69/78), so the 2 the
 * CJS-context refusal returns (tested above) isn't a silent gap in the
 * runtime help text.
 */
describe("flume tick --help — exit-code list matches tickExitCode's range (CLI-HELP-TICK-MISSING-EXIT2)", () => {
  it("lists 0, 1, 2, 69, and 78", async () => {
    const { out, code } = await runCli(process.cwd(), ["tick", "--help"]);
    expect(code).toBe(0);
    for (const exitCode of ["0 ", "1 ", "2 ", "69 ", "78 "]) {
      expect(out).toContain(`\n  ${exitCode}`);
    }
  });
});

/**
 * CLI-RENDER-REMOVAL — `render` previewed with the wrong fence, the wrong
 * prior-attempt state, and its own re-derivation of pickability that
 * disagreed with the dispatcher's (operator ruling 2026-08-03). It is gone
 * from the subcommand surface entirely, not merely undocumented.
 */
describe("flume render — removed from the subcommand surface (CLI-RENDER-REMOVAL)", () => {
  it("is an unknown subcommand and exits 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-render-removed-"));
    try {
      const { out, code } = await runCli(dir, ["render", "probe"]);
      expect(code).toBe(2);
      expect(out).toContain("unknown command: render");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("no help text (flume --help, flume -h) names render", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-render-removed-help-"));
    try {
      const long = await runCli(dir, ["--help"]);
      expect(long.code).toBe(0);
      expect(long.out).not.toContain("render");

      const short = await runCli(dir, ["-h"]);
      expect(short.code).toBe(0);
      expect(short.out).not.toContain("render");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  // LOOP-ERRORED-TICKS-SILENT-EXIT: every tick refused before ever writing a
  // verdict (the CJS-context refusal, the detached-HEAD/harness-error
  // refusal, an uncaught throw) — `superviseLoop` now folds these into
  // `erroredTicks` even with nothing on disk to read (Dispatcher.test.ts
  // pins that accumulation). At this seam, the resulting shape — errored
  // ticks present, nothing shipped — must still exit non-zero rather than
  // read as a clean, silent 0.
  it("every tick refused before writing a verdict and nothing shipped → 1", () => {
    const result: SuperviseResult = {
      ticks: 3,
      hibernated: false,
      shippedTags: [],
      erroredTicks: [
        "tick process exited 1 with no verdict written to disk",
        "tick process exited 1 with no verdict written to disk",
        "tick process exited 1 with no verdict written to disk",
      ],
    };
    expect(loopExitCode(result)).toBe(1);
    expect(loopCompletionSummary(result)).toContain(
      "3 tick(s) errored",
    );
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

  // v0.7 §16 — the consecutive-provisioning-failure abort backstop: non-zero
  // and named in the summary regardless of how much the run shipped before
  // hitting the wall (unlike the plain errored/nothing-shipped rule above).
  it("repeatedFailure aborts non-zero and names the signature, even with entries shipped", () => {
    const result: SuperviseResult = {
      ticks: 3,
      hibernated: false,
      repeatedFailure: { signature: "EBUSY: resource busy or locked", count: 3 },
      shippedTags: ["SHIPPED-BEFORE-THE-WALL"],
      erroredTicks: [],
    };
    expect(loopExitCode(result)).toBe(1);
    expect(loopCompletionSummary(result)).toContain(
      "EBUSY: resource busy or locked",
    );
  });

  // v0.8 §8 — the abort threshold is chain-overridable, so the completion
  // summary must name the real streak count, not the v0.7 §16 literal 3.
  it("names the real repeatedFailure.count, not a hardcoded 3", () => {
    const result: SuperviseResult = {
      ticks: 2,
      hibernated: false,
      repeatedFailure: { signature: "EBUSY: resource busy or locked", count: 2 },
      shippedTags: [],
      erroredTicks: [],
    };
    expect(loopCompletionSummary(result)).toContain("2 consecutive ticks");
    expect(loopCompletionSummary(result)).not.toContain("3 consecutive ticks");
  });
});

/**
 * §3 — `isInvokedDirectly` (`src/cli.ts`), the seam gating `main()`.
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
 * The shared subprocess harness's `hermeticEnv()` (`tests/helpers/subprocess.ts`)
 * strips all three canonical FLUME_* vars, not just FLUME_DIR/FLUME_CONFIG_DIR
 * — a job resolution leaked from the vitest process's own env is exactly as
 * capable of retargeting a spawned CLI as a relocated state root is. Pinned
 * fast-lane so a future partial copy of the harness cannot ship green through
 * build's afterMerge gate.
 */
describe("hermeticEnv — strips all three canonical FLUME_* vars", () => {
  it("carries none of FLUME_DIR, FLUME_CONFIG_DIR, FLUME_JOB when all three are set", () => {
    const prior = {
      FLUME_DIR: process.env.FLUME_DIR,
      FLUME_CONFIG_DIR: process.env.FLUME_CONFIG_DIR,
      FLUME_JOB: process.env.FLUME_JOB,
    };
    try {
      process.env.FLUME_DIR = "/outer/state";
      process.env.FLUME_CONFIG_DIR = "/outer/config";
      process.env.FLUME_JOB = "outer-job";

      const env = hermeticEnv();

      expect(env.FLUME_DIR).toBeUndefined();
      expect(env.FLUME_CONFIG_DIR).toBeUndefined();
      expect(env.FLUME_JOB).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

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

function supervisorPolicyChainSrc(policy?: {
  quarantineScope?: "run" | "none";
  abortThreshold?: number;
}): string {
  return (
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: "build",\n` +
    `    description: "",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "fanout",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    // Re-wakes unconditionally so a real multi-tick loop is observable
    // through --max/the abort backstop alone, independent of any
    // pending-work-aware handoff convention a real chain might add.
    `    handoff: () => ["build"],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    (policy !== undefined
      ? `  supervisorPolicy: ${JSON.stringify(policy)},\n`
      : ``) +
    `} });\n`
  );
}

async function writeStuckEntryPending(root: string): Promise<void> {
  await mkdir(join(root, ".flume", "plan"), { recursive: true });
  await writeFile(
    join(root, ".flume", "plan", "pending.json"),
    JSON.stringify(
      [
        {
          tag: "STUCK-ENTRY",
          gate: { kind: "open" },
          dependsOnForks: [],
          files: {
            new: [],
            edit: [{ path: "src/stuck.ts", description: "never reached" }],
            retire: [],
          },
        },
      ],
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

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
describe("§2a cross-process loop lock — real `flume loop` against <flumeDir>/loop.pid", () => {
  // LOOP-MAX-NONNUMERIC-ACCEPTED: the --max bound below resolves before the
  // lock branch above it, so — like the lock cases in this suite — these
  // exercise the real CLI with no chain.ts, no git repo, no child tick.
  it(
    "`--max abc` (non-numeric) exits 2 naming usage and spawns no tick",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-loop-max-"));
      try {
        const r = await runCli(dir, ["loop", "--max", "abc"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume loop");
        expect(r.out).not.toContain("reached --max");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "`--max` with no following value exits 2 naming usage and spawns no tick",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-loop-max-"));
      try {
        const r = await runCli(dir, ["loop", "--max"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume loop");
        expect(r.out).not.toContain("reached --max");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "`--max -1` (negative) exits 2 naming usage and spawns no tick",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-loop-max-"));
      try {
        const r = await runCli(dir, ["loop", "--max", "-1"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume loop");
        expect(r.out).not.toContain("reached --max");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    "refuses a second loop while the recorded pid is alive, leaving the pidfile untouched",
    async () => {
      // A real git repo on a named branch (v0.11 §4: loop refuses outright
      // on detached HEAD, before ever reaching the lock check below).
      const repo = await makeJobRepo("main");
      try {
        const flumeDir = join(repo.dir, ".flume");
        const pidPath = join(flumeDir, "loop.pid");
        // The vitest worker itself plays the live prior supervisor — its pid
        // is guaranteed alive for the duration of the spawned loop.
        await mkdir(flumeDir, { recursive: true });
        await writeFile(pidPath, String(process.pid), "utf8");

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);

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
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "reclaims a stale pidfile (dead pid): the loop runs and drops the lock on exit",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const flumeDir = join(repo.dir, ".flume");
        const pidPath = join(flumeDir, "loop.pid");
        // Harvest a genuinely dead pid: spawn a no-op node child and wait
        // for it to exit before recording its pid as the stale holder.
        const probe = exec(process.execPath, ["-e", ""]);
        const deadPid = probe.child.pid;
        await probe;
        expect(deadPid).toBeDefined();
        await mkdir(flumeDir, { recursive: true });
        await writeFile(pidPath, String(deadPid), "utf8");

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);

        // Not refused — the dead holder was reclaimed and the loop ran to
        // its --max 0 stop.
        expect(r.code).toBe(0);
        expect(r.out).not.toContain("refusing");
        expect(r.out).toContain("reached --max 0");
        // The reclaiming loop took the lock over and dropped it on exit; a
        // refusal would have left the stale pidfile in place.
        expect(existsSync(pidPath)).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  // LOOP-LOCK-SHARES-LIVELOOPPID: the lock's liveness read and `flume
  // status`'s supervisor-liveness read (v0.7 §17) both go through
  // `liveLoopPid` (src/job.ts) — one probe, not two hand-rolled ones. This
  // pins agreement so a future one-sided change to either call site fails
  // here instead of silently diverging.
  it(
    "agrees with `flume status` on a live pid: loop refuses, status reports the same pid live",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const flumeDir = join(repo.dir, ".flume");
        const pidPath = join(flumeDir, "loop.pid");
        await mkdir(flumeDir, { recursive: true });
        await writeFile(pidPath, String(process.pid), "utf8");

        const loopResult = await runCli(repo.dir, ["loop", "--max", "0"]);
        const statusResult = await runCli(repo.dir, ["status"]);

        expect(loopResult.code).toBe(1);
        expect(loopResult.out).toContain(
          `another loop (pid ${process.pid}) already runs`,
        );
        expect(statusResult.out).toContain(
          `supervisor pid ${process.pid} live`,
        );
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "agrees with `flume status` on a stale pid: loop reclaims, status reports it dead",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const flumeDir = join(repo.dir, ".flume");
        const pidPath = join(flumeDir, "loop.pid");
        // Harvest a genuinely dead pid: spawn a no-op node child and wait
        // for it to exit before recording its pid as the stale holder.
        const probe = exec(process.execPath, ["-e", ""]);
        const deadPid = probe.child.pid;
        await probe;
        expect(deadPid).toBeDefined();
        await mkdir(flumeDir, { recursive: true });
        await writeFile(pidPath, String(deadPid), "utf8");

        // status first — before the loop below reclaims and removes the
        // pidfile out from under it.
        const statusResult = await runCli(repo.dir, ["status"]);
        const loopResult = await runCli(repo.dir, ["loop", "--max", "0"]);

        expect(statusResult.out).toContain(
          "loop.pid present, process dead — stale",
        );
        expect(loopResult.code).toBe(0);
        expect(loopResult.out).not.toContain("refusing");
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );
});

/**
 * v0.11 §4 — the advisory per-ref tip claim reaching `flume loop`/`flume
 * tick` end-to-end through the real CLI. `tests/git.test.ts` already proves
 * `acquireTipClaim`'s own acquire/refuse/reclaim mechanics in isolation;
 * this suite proves the CLI wiring: the claim is taken alongside `loop.pid`,
 * released on the same exit/SIGINT/SIGTERM hooks, and a detached HEAD
 * refuses before either command runs a tick.
 */
describe("flume loop/tick — tip claim wiring (v0.11 §4)", () => {
  it(
    "two loops against different state roots on one branch: the second refuses, naming the claim's holder pid",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const commonDir = resolve(
          repo.dir,
          await gitOut(repo.dir, ["rev-parse", "--git-common-dir"]),
        );
        const claimPath = join(
          commonDir,
          "flume",
          "tip-claims",
          "refs",
          "heads",
          "main",
        );
        await mkdir(dirname(claimPath), { recursive: true });
        // The vitest worker itself plays the live first loop's holder.
        await writeFile(claimPath, String(process.pid), "utf8");

        // A different state root (--job other) than the planted claim's
        // holder — only the tip claim can refuse this pair; loop.pid never
        // collides. Pre-existing per CLI-JOB-FLAG-REFUSES-NONEXISTENT-STATE-ROOT:
        // --job now refuses a name with no state root before reaching the
        // tip-claim contention this test exercises.
        await mkdir(join(repo.dir, ".flume", "jobs", "other"), {
          recursive: true,
        });
        const r = await runCli(repo.dir, ["--job", "other", "loop", "--max", "0"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain(`refs/heads/main claimed by pid ${process.pid}`);
        expect(r.out).toContain(claimPath);
        // Refused before ever taking its own loop.pid — nothing left behind
        // for the job's own state root.
        expect(
          existsSync(join(repo.dir, ".flume", "jobs", "other", "loop.pid")),
        ).toBe(false);
        // The live holder's claim survives the refused contender untouched.
        expect(await readFile(claimPath, "utf8")).toBe(String(process.pid));
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "two loops from two worktrees on different branches: both run (keyed per-ref, not per-checkout)",
    async () => {
      const repo = await makeJobRepo("main");
      const wtParent = await mkdtemp(join(tmpdir(), "flume-tip-claim-wt-"));
      const wtDir = join(wtParent, "wt");
      try {
        await exec("git", ["worktree", "add", "-b", "other", wtDir], {
          cwd: repo.dir,
        });

        const [main, other] = await Promise.all([
          runCli(repo.dir, ["loop", "--max", "0"]),
          runCli(wtDir, ["loop", "--max", "0"]),
        ]);

        expect(main.code).toBe(0);
        expect(main.out).toContain("reached --max 0");
        expect(other.code).toBe(0);
        expect(other.out).toContain("reached --max 0");
      } finally {
        await rm(wtParent, { recursive: true, force: true });
        await exec("git", ["worktree", "prune"], { cwd: repo.dir }).catch(
          () => {},
        );
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "claim file is gone after a clean exit",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const r = await runCli(repo.dir, ["loop", "--max", "0"]);
        expect(r.code).toBe(0);

        const commonDir = resolve(
          repo.dir,
          await gitOut(repo.dir, ["rev-parse", "--git-common-dir"]),
        );
        const claimPath = join(
          commonDir,
          "flume",
          "tip-claims",
          "refs",
          "heads",
          "main",
        );
        expect(existsSync(claimPath)).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "claim file (and loop.pid) are gone after SIGTERM on POSIX; on win32 (TerminateProcess, no handler runs) both survive and the claim is stale-reclaimable — the amended v0.11 §4 outcome",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, slowAgentChainSrc("probe"));
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const child = spawn(
          process.execPath,
          [TSX_CLI, CLI, "loop", "--max", "1"],
          { cwd: repo.dir, env: hermeticEnv() },
        );

        // Long enough for the loop to acquire both locks, load the chain,
        // and spawn its child tick — now mid-sleep inside `invoke()`, well
        // inside the process's lifetime rather than racing its startup.
        await new Promise((r) => setTimeout(r, 1500));

        const commonDir = resolve(
          repo.dir,
          await gitOut(repo.dir, ["rev-parse", "--git-common-dir"]),
        );
        const claimPath = join(
          commonDir,
          "flume",
          "tip-claims",
          "refs",
          "heads",
          "main",
        );
        const pidPath = join(repo.dir, ".flume", "loop.pid");
        expect(existsSync(claimPath)).toBe(true);
        expect(existsSync(pidPath)).toBe(true);
        // tsx re-execs itself into a second node process to run the ESM
        // loader, so the spawned `child`'s own pid is the bootstrapper's,
        // not the one that actually acquired the locks and wrote its own
        // pid into both files — read the real holder back off disk and
        // signal that process directly, matching what an operator's
        // SIGTERM/taskkill targets in production (no tsx wrapper there).
        const recordedPid = await readFile(claimPath, "utf8");

        const exited = new Promise<void>((resolveExit) => {
          child.on("exit", () => resolveExit());
        });
        process.kill(Number(recordedPid), "SIGTERM");
        await exited;

        if (process.platform === "win32") {
          // v0.11 §4 (amended): SIGTERM maps to TerminateProcess on win32,
          // which runs no handler — dropLock (src/cli.ts) never fires, so
          // both the tip claim and loop.pid survive the kill exactly as a
          // `kill -9` would. Release-on-signal is a POSIX guarantee only;
          // the cross-platform guarantee is stale-reclaim — the claim's
          // recorded pid now names the dead holder, so the next acquirer's
          // liveness probe (exercised end-to-end via `flume status`, which
          // already asserts this wording elsewhere in this suite) reclaims
          // it rather than refusing.
          expect(existsSync(claimPath)).toBe(true);
          expect(existsSync(pidPath)).toBe(true);
          expect(await readFile(claimPath, "utf8")).toBe(recordedPid);

          const status = await runCli(repo.dir, ["status"]);
          expect(status.code).toBe(0);
          expect(status.out).toContain(
            "tip claim present, process dead — stale",
          );
        } else {
          expect(existsSync(claimPath)).toBe(false);
          expect(existsSync(pidPath)).toBe(false);
        }
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "flume loop exits 1 on detached HEAD before any tick, taking neither loop.pid nor the tip claim",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await exec("git", ["checkout", "--detach"], { cwd: repo.dir });
        await writeRepoConfig(repo.dir, minimalChainSrc());
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const r = await runCli(repo.dir, ["loop", "--max", "1"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain("HEAD is detached");
        // No tick ran — the awake flag survives untouched, and neither lock
        // was ever written.
        expect(existsSync(join(repo.dir, ".flume", "awake", "probe"))).toBe(
          true,
        );
        expect(existsSync(join(repo.dir, ".flume", "loop.pid"))).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "flume tick exits 1 on detached HEAD without invoking the agent",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await exec("git", ["checkout", "--detach"], { cwd: repo.dir });
        await writeRepoConfig(repo.dir, minimalChainSrc());
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const r = await runCli(repo.dir, ["tick"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain("HEAD is detached");
        expect(existsSync(join(repo.dir, ".flume", "awake", "probe"))).toBe(
          true,
        );
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    // spec/loop.md, "The loop lock and the tip claim": `currentRefPath`
    // returned `null` for a detached HEAD, a non-repository cwd, and a
    // failing git invocation alike, so the refusal printed "HEAD is
    // detached" even when the caller was never in a repository at all.
    'flume tick outside a git repository reports that, not "HEAD is detached"',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-non-repo-"));
      try {
        const r = await runCli(dir, ["tick"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain("not a git repository");
        expect(r.out).not.toContain("HEAD is detached");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    // spec/loop.md, "The tick verdict — one facts artifact": the
    // detached-HEAD refusal must clear a prior tick's stale verdict before
    // returning, not leave it for a loop's supervisor to misread as this
    // tick's own on every subsequent iteration.
    "flume tick on detached HEAD clears a stale tick-verdict.json before refusing",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const flumeDir = join(repo.dir, ".flume");
        await mkdir(flumeDir, { recursive: true });
        const verdictPath = join(flumeDir, "tick-verdict.json");
        await writeFile(
          verdictPath,
          JSON.stringify({
            phaseName: "probe",
            tags: [],
            committed: false,
            gateResults: [],
            shippedTags: [],
            mergeOutcomes: [],
            summary: "stale verdict from a prior tick",
          }),
          "utf8",
        );

        await exec("git", ["checkout", "--detach"], { cwd: repo.dir });
        new Baton(flumeDir).wake("probe");

        const r = await runCli(repo.dir, ["tick"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain("HEAD is detached");
        expect(existsSync(verdictPath)).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "flume status reports the tip claim alongside supervisor liveness",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const commonDir = resolve(
          repo.dir,
          await gitOut(repo.dir, ["rev-parse", "--git-common-dir"]),
        );
        const claimDir = join(commonDir, "flume", "tip-claims", "refs", "heads");
        await mkdir(claimDir, { recursive: true });
        // The vitest worker itself plays the live holder.
        await writeFile(join(claimDir, "main"), String(process.pid), "utf8");

        const live = await runCli(repo.dir, ["status"]);
        expect(live.code).toBe(0);
        expect(live.out).toContain(`tip claimed by pid ${process.pid}`);

        // Harvest a genuinely dead pid: spawn a no-op node child and wait
        // for it to exit before recording its pid as the stale holder.
        const probe = exec(process.execPath, ["-e", ""]);
        const deadPid = probe.child.pid;
        await probe;
        await writeFile(join(claimDir, "main"), String(deadPid), "utf8");

        const stale = await runCli(repo.dir, ["status"]);
        expect(stale.code).toBe(0);
        expect(stale.out).toContain("tip claim present, process dead — stale");
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "flume status prints nothing extra with no claim file, or on a detached HEAD",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const clean = await runCli(repo.dir, ["status"]);
        expect(clean.code).toBe(0);
        expect(clean.out).not.toContain("tip claim");

        await exec("git", ["checkout", "--detach"], { cwd: repo.dir });
        const detached = await runCli(repo.dir, ["status"]);
        expect(detached.code).toBe(0);
        expect(detached.out).not.toContain("tip claim");
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );
});

/**
 * A fanout chain whose agent, only for the `ship-a` worktree, corrupts
 * `<flumeDir>/plan/pending.json` mid-invocation (same mechanism
 * `tests/Dispatcher.test.ts`'s WaveLedgerParseFailure suite uses) and then
 * commits its declared file — so `commitPendingUpdate`'s rewrite read hits
 * an unparseable ledger after the cherry-pick and (gate-less) afterMerge
 * pass have already landed. The `DECLINE-B` entry never reaches the agent:
 * `shouldRun` declines it before invocation (RELEASE-v0.11 §8), so the wave
 * carries one shipped and one declined entry through the same refusal.
 */
function ledgerRewriteFailureChainSrc(phaseName: string): string {
  return (
    `import { execFileSync } from "node:child_process";\n` +
    `import { mkdirSync, writeFileSync } from "node:fs";\n` +
    `import { basename, join } from "node:path";\n` +
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "ledger-rewrite failure probe",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "fanout",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `    shouldRun: (ctx) => ctx.assignedEntry?.tag !== "DECLINE-B",\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `},\n` +
    `agent: {\n` +
    `  name: "ledger-rewrite-failure-probe",\n` +
    `  async invoke(inv) {\n` +
    `    const slug = basename(inv.cwd);\n` +
    `    if (slug === "ship-a") {\n` +
    `      const pendingPath = join(\n` +
    `        process.env.FLUME_DIR ?? "",\n` +
    `        "plan",\n` +
    `        "pending.json",\n` +
    `      );\n` +
    `      writeFileSync(pendingPath, "{ corrupted mid-wave, not json", "utf8");\n` +
    `      mkdirSync(join(inv.cwd, "src"), { recursive: true });\n` +
    `      writeFileSync(join(inv.cwd, "src", "a.ts"), "from-A\\n", "utf8");\n` +
    `      execFileSync("git", ["add", "--", "src/a.ts"], { cwd: inv.cwd });\n` +
    `      execFileSync(\n` +
    `        "git",\n` +
    `        ["commit", "-q", "-m", "build(SHIP-A): ship"],\n` +
    `        { cwd: inv.cwd },\n` +
    `      );\n` +
    `    }\n` +
    `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
    `  },\n` +
    `} });\n`
  );
}

/**
 * spec/loop.md, "The tick verdict — one facts artifact" drift (b): a wave
 * whose `commitPendingUpdate` rewrite hits a `PendingParseFailure` after its
 * cherry-picks already landed writes the same `TickOutcome.verdict` a clean
 * completion would — `tests/Dispatcher.test.ts` proves that in memory. What
 * actually reaches disk depends on `src/cli.ts`'s `if (outcome.verdict)
 * writeTickVerdict(...)` branch running regardless of `outcome.failed` —
 * unverified until now, and only exercisable through the real `tick`
 * subprocess (`Dispatcher.tick()` alone never writes the file). The wave
 * here also mixes a shipped entry with a declined one, so both facts must
 * survive onto the on-disk artifact, not just the shipped tag the existing
 * single-entry suite already covers.
 */
describe("flume tick — tick-verdict.json on disk after a ledger-rewrite PendingParseFailure (LOOP-WAVE-VERDICT-MULTIENTRY-COVERAGE)", () => {
  it(
    "a multi-entry wave (one shipped, one declined) whose commitPendingUpdate rewrite read hits corrupt pending.json still writes the wave's verdict to tick-verdict.json",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, ledgerRewriteFailureChainSrc("build"));
        const flumeDir = join(repo.dir, ".flume");
        const pendingPath = join(flumeDir, "plan", "pending.json");
        await mkdir(join(flumeDir, "plan"), { recursive: true });
        await writeFile(
          pendingPath,
          JSON.stringify(
            [
              {
                tag: "SHIP-A",
                gate: { kind: "open" },
                dependsOnForks: [],
                files: {
                  new: [],
                  edit: [{ path: "src/a.ts", description: "edit" }],
                  retire: [],
                },
              },
              {
                tag: "DECLINE-B",
                gate: { kind: "open" },
                dependsOnForks: [],
                files: {
                  new: [],
                  edit: [{ path: "src/b.ts", description: "edit" }],
                  retire: [],
                },
              },
            ],
            null,
            2,
          ) + "\n",
          "utf8",
        );
        new Baton(flumeDir).wake("build");

        const r = await runCli(repo.dir, ["tick"]);

        // Exit-69-worthy refusal — the ledger rewrite refused rather than
        // deriving a rewrite from a parse it never trusted.
        expect(r.code).toBe(EX_MOUNT_DEAD);
        expect(await readFile(pendingPath, "utf8")).toBe(
          "{ corrupted mid-wave, not json",
        );

        // The defect this test pins: the on-disk artifact, not just the
        // in-memory outcome, must carry both the shipped tag and the
        // declined sibling.
        const verdictPath = join(flumeDir, "tick-verdict.json");
        const verdict = JSON.parse(await readFile(verdictPath, "utf8")) as {
          phaseName: string;
          tags: string[];
          committed: boolean;
          declined?: boolean;
          shippedTags: string[];
          mergeOutcomes: { tag: string; outcome: string; headSha?: string }[];
        };

        expect(verdict.phaseName).toBe("build");
        expect(verdict.committed).toBe(true);
        expect(verdict.shippedTags).toEqual(["SHIP-A"]);
        expect([...verdict.tags].sort()).toEqual(["DECLINE-B", "SHIP-A"]);
        expect(verdict.declined).toBe(true);
        expect(verdict.mergeOutcomes).toEqual([
          {
            tag: "SHIP-A",
            outcome: "merged",
            headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
          },
        ]);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );
});

/**
 * v0.8 §8, real CLI seam — `Chain.supervisorPolicy` reaching `flume loop`'s
 * supervisor end-to-end (`src/cli.ts`'s best-effort chain resolve →
 * `superviseLoop` forwarding). `tests/Dispatcher.test.ts`'s "supervisor
 * policy knobs" suite already proves the quarantine/abort-backstop
 * mechanics themselves at the `superviseLoop` options seam with a stubbed
 * `runTick`; this suite proves only that the CLI's real chain-load-and-
 * forward wiring carries the declared block there at all — nothing
 * upstream of that seam is re-tested here.
 *
 * `writeStuckEntryPending` above manufactures a genuine, deterministic
 * pre-tick worktree-provisioning failure without mocking `git`: with
 * `FLUME_WORKTREES_DIR` pointed at a path this suite pre-creates as a
 * plain FILE, `createWorktree`'s `mkdir(dirname(path), { recursive: true
 * })` throws the identical Node `EEXIST` every attempt.
 */
describe("flume loop — supervisorPolicy reaching the real CLI (v0.8 §8)", () => {
  it(
    "a chain declaring no supervisorPolicy: a tagged provisioning failure quarantines once, then the run is unchanged through --max (v0.8 §8 default)",
    async () => {
      const repo = await makeJobRepo("main");
      const wtDir = await mkdtemp(join(tmpdir(), "flume-wt-collision-"));
      try {
        await writeRepoConfig(repo.dir, supervisorPolicyChainSrc(undefined));
        await writeStuckEntryPending(repo.dir);
        new Baton(join(repo.dir, ".flume")).wake("build");

        const collision = join(wtDir, "wt-collision");
        await writeFile(collision, "not a directory\n", "utf8");

        const r = await runCli(repo.dir, ["loop", "--max", "5"], {
          ...hermeticEnv(),
          FLUME_WORKTREES_DIR: collision,
        });

        // One tick errored (the provisioning failure) and nothing ever
        // shipped — the v0.7 §4 exit-code contract.
        expect(r.code).toBe(1);
        expect(r.out).toContain("reached --max 5");
        expect(r.out).not.toContain("aborting after");
        // Quarantined exactly once — the default "run" scope removes
        // STUCK-ENTRY from picking after its first failure, so ticks 2-5
        // see nothing pickable rather than re-attempting the same wall.
        const quarantineMentions = (
          r.out.match(/quarantining STUCK-ENTRY/g) ?? []
        ).length;
        expect(quarantineMentions).toBe(1);
      } finally {
        await repo.cleanup();
        await rm(wtDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    'a chain declaring supervisorPolicy: { quarantineScope: "none", abortThreshold: 2 } aborts on the 2nd consecutive identical failure — the override reaches the real supervisor (v0.8 §8)',
    async () => {
      const repo = await makeJobRepo("main");
      const wtDir = await mkdtemp(join(tmpdir(), "flume-wt-collision-"));
      try {
        await writeRepoConfig(
          repo.dir,
          supervisorPolicyChainSrc({
            quarantineScope: "none",
            abortThreshold: 2,
          }),
        );
        await writeStuckEntryPending(repo.dir);
        new Baton(join(repo.dir, ".flume")).wake("build");

        const collision = join(wtDir, "wt-collision");
        await writeFile(collision, "not a directory\n", "utf8");

        const r = await runCli(repo.dir, ["loop", "--max", "10"], {
          ...hermeticEnv(),
          FLUME_WORKTREES_DIR: collision,
        });

        // "none" keeps STUCK-ENTRY pickable every tick (never quarantined),
        // so the identical signature repeats and the backstop trips at the
        // declared threshold of 2 — never burning to --max 10, and never
        // falling through to the untouched v0.7 §16 default of 3.
        expect(r.code).toBe(1);
        expect(r.out).toContain("aborting after 2 tick(s)");
        expect(r.out).toContain("2 consecutive ticks");
        expect(r.out).not.toContain("reached --max 10");
        expect(r.out).not.toContain("quarantining STUCK-ENTRY");
      } finally {
        await repo.cleanup();
        await rm(wtDir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

/**
 * v0.7 §17 — `flume status` surfaces supervisor liveness beside the awake
 * markers. Incident (2026-07-29): `status` read baton markers only and
 * printed "hibernating" while a prior supervisor was still alive, so the
 * operator deleted `loop.pid` on a stale assumption. Same pid-liveness
 * shape as the loop-lock tests above (`liveLoopPid`, `src/job.ts`), applied
 * to a bare `.flume/loop.pid` rather than a job dir's.
 */
describe("flume status — supervisor liveness (v0.7 §17)", () => {
  it("names the pid of a live supervisor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-status-live-"));
    try {
      const flumeDir = join(dir, ".flume");
      await mkdir(flumeDir, { recursive: true });
      // The vitest worker itself plays the live supervisor — its own pid is
      // guaranteed alive for the duration of this test.
      await writeFile(join(flumeDir, "loop.pid"), String(process.pid), "utf8");

      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(0);
      expect(r.out).toContain("hibernating");
      expect(r.out).toContain(`supervisor pid ${process.pid} live`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("reports a stale pidfile when the recorded pid is dead", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-status-stale-"));
    try {
      const flumeDir = join(dir, ".flume");
      await mkdir(flumeDir, { recursive: true });
      // Harvest a genuinely dead pid: spawn a no-op node child and wait for
      // it to exit before recording its pid as the stale holder.
      const probe = exec(process.execPath, ["-e", ""]);
      const deadPid = probe.child.pid;
      await probe;
      expect(deadPid).toBeDefined();
      await writeFile(join(flumeDir, "loop.pid"), String(deadPid), "utf8");

      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(0);
      expect(r.out).toContain("hibernating");
      expect(r.out).toContain("loop.pid present, process dead — stale");
      expect(r.out).not.toContain("supervisor pid");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("is unchanged from today when no pidfile exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-status-nopid-"));
    try {
      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(0);
      expect(r.out).toContain("hibernating");
      expect(r.out).not.toContain("supervisor pid");
      expect(r.out).not.toContain("stale");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

// ---------- v0.6 §2/§3 — job resolution through the real CLI ----------

/**
 * Scratch git repo on a chosen branch. The engine has no opinion on branch
 * names (v0.11 §2) — some fixtures below pin `job/foo` merely as a
 * distinctive label, proven inert by running job resolution on `main`
 * instead.
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

/**
 * A minimal, otherwise-valid chain — never ticked in the §6 friction tests
 * below, just loaded for its declared fields. `friction` omitted leaves the
 * field undeclared entirely (§2: undeclared turns every §6 behavior off).
 */
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
 * A chain whose singleton phase's agent sleeps before returning — used to
 * hold a real `flume loop` process open long enough (v0.11 §4's SIGTERM
 * test) to deliver a signal mid-tick, rather than racing the process's own
 * startup and near-instant completion.
 */
function slowAgentChainSrc(phaseName: string): string {
  return (
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "sigterm probe",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `},\n` +
    `agent: {\n` +
    `  name: "slow",\n` +
    `  async invoke() {\n` +
    `    await new Promise((r) => setTimeout(r, 3000));\n` +
    `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
    `  },\n` +
    `} });\n`
  );
}

/**
 * §6 (v0.6.2) — `flume status`'s friction line (`frictionCountLine`,
 * `src/Dispatcher.ts`): a count of files in the declared friction dir,
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
      expect(r.out).toContain("hibernating");
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
      expect(r.out).toContain("hibernating");
      expect(r.out).not.toContain("friction:");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);
});

/**
 * §3 — `flume status` names the pending entry count alongside awake phases:
 * a valid pending.json by entry count, a corrupt one as "unparsable" rather
 * than silently dropped, and an absent one as 0. No chain/git repo needed —
 * the count comes from `readPendingLoose` (`src/job.ts`), the same
 * chain-less probe `flume job status` uses per job.
 */
describe("flume status — pending entry count (§3)", () => {
  it("names the entry count for a valid pending.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-status-pending-"));
    try {
      const planDir = join(dir, ".flume", "plan");
      await mkdir(planDir, { recursive: true });
      await writeFile(
        join(planDir, "pending.json"),
        JSON.stringify([
          {
            tag: "A",
            gate: { kind: "open" },
            dependsOnForks: [],
            files: { new: [], edit: [{ path: "src/a.ts", description: "a" }], retire: [] },
          },
          {
            tag: "B",
            gate: { kind: "open" },
            dependsOnForks: [],
            files: { new: [], edit: [{ path: "src/b.ts", description: "b" }], retire: [] },
          },
        ]),
        "utf8",
      );

      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("pending: 2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('prints "pending: unparsable" for a corrupt pending.json instead of dropping it silently', async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-status-pending-"));
    try {
      const planDir = join(dir, ".flume", "plan");
      await mkdir(planDir, { recursive: true });
      await writeFile(join(planDir, "pending.json"), "not json{", "utf8");

      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("pending: unparsable");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('prints "pending: 0" when plan/pending.json is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-status-pending-"));
    try {
      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("pending: 0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

/**
 * A minimal chain declaring `capabilities` (or omitting it) — same shape as
 * `minimalChainSrc`, varied for the v0.8 §4 capability-skip status tests
 * below.
 */
function capabilityChainSrc(capabilities?: string[]): string {
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
    (capabilities !== undefined
      ? `  capabilities: ${JSON.stringify(capabilities)},\n`
      : ``) +
    `} });\n`
  );
}

async function writeCapabilityGatedPending(
  root: string,
  capability: string,
): Promise<void> {
  await mkdir(join(root, ".flume", "plan"), { recursive: true });
  await writeFile(
    join(root, ".flume", "plan", "pending.json"),
    JSON.stringify(
      [
        {
          tag: "GATED",
          gate: { kind: "requiresCapability", capability },
          dependsOnForks: [],
          files: { new: [], edit: [{ path: "src/gated.ts", description: "gated work" }], retire: [] },
        },
      ],
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

/**
 * v0.8 §4 — `requiresDockerHost` generalized to `requiresCapability`: an
 * entry skipped because the chain hasn't asserted its capability must never
 * be a silent skip. `flume status` names the missing capability alongside
 * the tag so the operator sees why the queue is stuck, without reading logs.
 */
describe("flume status — names the missing capability on a requiresCapability skip (v0.8 §4)", () => {
  it("names the tag and the missing capability when the chain asserts nothing", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, capabilityChainSrc());
      await writeCapabilityGatedPending(repo.dir, "docker-host");

      const r = await runCli(repo.dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("hibernating");
      expect(r.out).toContain("GATED");
      expect(r.out).toContain("docker-host");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);

  it("omits the line once the chain asserts the capability", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, capabilityChainSrc(["docker-host"]));
      await writeCapabilityGatedPending(repo.dir, "docker-host");

      const r = await runCli(repo.dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("hibernating");
      expect(r.out).not.toContain("GATED");
      expect(r.out).not.toContain("missing capability");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);
});

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

/**
 * CLI-FLUMEDIR-CROSS-REPO-ROOT-REFUSAL, part 2 — `wake`/`sleep` refuse a
 * phase absent from the loaded chain's declared phases, before the marker
 * is ever written. Best-effort like `status`: a chain that fails to load
 * never blocks either command.
 */
describe("flume wake/sleep — refuse a phase the chain does not declare (CLI-FLUMEDIR-CROSS-REPO-ROOT-REFUSAL)", () => {
  it(
    "flume wake <undeclared-phase> exits 2 and creates no flag",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc()); // declares "probe" only
        const wake = await runCli(repo.dir, ["wake", "ghost"]);
        expect(wake.code).toBe(2);
        expect(wake.out).toContain("ghost");
        expect(
          existsSync(join(repo.dir, ".flume", "awake", "ghost")),
        ).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "flume sleep <undeclared-phase> exits 2",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc()); // declares "probe" only
        const sleep = await runCli(repo.dir, ["sleep", "ghost"]);
        expect(sleep.code).toBe(2);
        expect(sleep.out).toContain("ghost");
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "wake/sleep still succeed for a phase the chain declares",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const wake = await runCli(repo.dir, ["wake", "probe"]);
        expect(wake.code).toBe(0);
        expect(
          existsSync(join(repo.dir, ".flume", "awake", "probe")),
        ).toBe(true);

        const sleep = await runCli(repo.dir, ["sleep", "probe"]);
        expect(sleep.code).toBe(0);
        expect(
          existsSync(join(repo.dir, ".flume", "awake", "probe")),
        ).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );

  it(
    "wake proceeds (best-effort) when no chain is present at all to validate against",
    async () => {
      const repo = await makeJobRepo("main"); // no .flume/chain.ts written
      try {
        const wake = await runCli(repo.dir, ["wake", "anything"]);
        expect(wake.code).toBe(0);
        expect(
          existsSync(join(repo.dir, ".flume", "awake", "anything")),
        ).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    30_000,
  );
});

// ---------- flume check (spec/cli.md §Subcommand surface, cli-check-verb) ----------

/**
 * A two-phase chain — singleton "plan" plus fanout "build" — carrying
 * caller-chosen `writablePaths`/`entryChannelPaths` on `build`. `build`
 * is the consumer phase `flume check`'s fence arithmetic reads (the sole
 * fanout-concurrency phase, the sole kind that ever picks from `pending` —
 * `Phase.ts` "Concurrency", `spec/pending.md` "Selection is the sole site").
 */
function fanoutCheckChainSrc(
  buildWritablePaths: string[],
  buildChannelPaths: string[] = [],
): string {
  return (
    `export default () => ({ chain: {\n` +
    `  phases: [\n` +
    `    {\n` +
    `      name: "plan",\n` +
    `      description: "",\n` +
    `      promptPath: "prompts/prompt.md",\n` +
    `      concurrency: "singleton",\n` +
    `      writablePaths: [".flume/plan/**"],\n` +
    `      gates: [],\n` +
    `      handoff: () => [],\n` +
    `    },\n` +
    `    {\n` +
    `      name: "build",\n` +
    `      description: "",\n` +
    `      promptPath: "prompts/prompt.md",\n` +
    `      concurrency: "fanout",\n` +
    `      writablePaths: ${JSON.stringify(buildWritablePaths)},\n` +
    `      entryChannelPaths: ${JSON.stringify(buildChannelPaths)},\n` +
    `      scopeWritesToEntry: true,\n` +
    `      gates: [],\n` +
    `      handoff: () => [],\n` +
    `    },\n` +
    `  ],\n` +
    `  humanOnly: [],\n` +
    `} });\n`
  );
}

async function writeCheckPending(root: string, entries: unknown[]): Promise<void> {
  await mkdir(join(root, ".flume", "plan"), { recursive: true });
  await writeFile(
    join(root, ".flume", "plan", "pending.json"),
    JSON.stringify(entries, null, 2) + "\n",
    "utf8",
  );
}

describe("flume check (spec/cli.md §Subcommand surface)", () => {
  it("exits EX_DATAERR naming the entry on a parsePending schema violation", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, fanoutCheckChainSrc(["src/**"]));
      await writeCheckPending(repo.dir, [
        {
          tag: "BAD",
          gate: { kind: "bogus" },
          dependsOnForks: [],
          files: { new: [], edit: [], retire: [] },
        },
      ]);

      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(65);
      expect(r.out).toContain("schema violation");
      expect(r.out).toContain("[0]");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("exits EX_DATAERR naming entry + offending paths on a fence violation", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, fanoutCheckChainSrc(["src/**"]));
      await writeCheckPending(repo.dir, [
        {
          tag: "OUT-OF-FENCE",
          gate: { kind: "open" },
          dependsOnForks: [],
          files: {
            new: [],
            edit: [
              { path: "docs/readme.md", description: "outside build's fence" },
            ],
            retire: [],
          },
        },
      ]);

      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(65);
      expect(r.out).toContain("outside the consumer phase's fence");
      expect(r.out).toContain("OUT-OF-FENCE");
      expect(r.out).toContain("docs/readme.md");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("exits 0 on a clean pending.json", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(
        repo.dir,
        fanoutCheckChainSrc(["src/**"], ["tests/**"]),
      );
      await writeCheckPending(repo.dir, [
        {
          tag: "CLEAN",
          gate: { kind: "open" },
          dependsOnForks: [],
          files: {
            new: [],
            edit: [
              { path: "src/a.ts", description: "inside build's writablePaths" },
              {
                path: "tests/a.test.ts",
                description: "inside build's entryChannelPaths",
              },
            ],
            retire: [],
          },
        },
      ]);

      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("valid (1 entries)");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("exits 0 when plan/pending.json is absent — nothing to check", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, fanoutCheckChainSrc(["src/**"]));

      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(0);
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("exits EX_IOERR naming the error on a non-ENOENT pending.json read failure, instead of reading it as absent", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, fanoutCheckChainSrc(["src/**"]));
      // A directory in place of pending.json reproduces a non-ENOENT read
      // failure (EISDIR) without relying on permission bits a root-run test
      // could bypass (`.claude/rules/engineering.md`, "Loud or nothing").
      await mkdir(join(repo.dir, ".flume", "plan", "pending.json"), {
        recursive: true,
      });

      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(74);
      expect(r.out).not.toContain("absent");
      expect(r.out).toContain("failed to read");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("mutates no baton flag and invokes no agent", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, fanoutCheckChainSrc(["src/**"]));
      await writeCheckPending(repo.dir, [
        {
          tag: "CLEAN",
          gate: { kind: "open" },
          dependsOnForks: [],
          files: {
            new: [],
            edit: [{ path: "src/a.ts", description: "clean" }],
            retire: [],
          },
        },
      ]);
      const pendingPath = join(repo.dir, ".flume", "plan", "pending.json");
      const before = await readFile(pendingPath, "utf8");

      const r = await runCli(repo.dir, ["check"]);

      expect(r.code).toBe(0);
      // No Baton constructed — unlike `status`, whose Baton() call mkdirs
      // awake/ as a side effect even for an all-hibernating read.
      expect(existsSync(join(repo.dir, ".flume", "awake"))).toBe(false);
      // Read-only: pending.json itself is byte-identical afterward.
      expect(await readFile(pendingPath, "utf8")).toBe(before);
      // No worktree/agent machinery ever ran.
      expect(existsSync(join(repo.dir, ".flume", "worktrees"))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("exits mount-dead (69) when no chain resolves to check the consumer fence against", async () => {
    const repo = await makeJobRepo("main"); // no .flume/chain.ts written
    try {
      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(69);
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("--help short-circuits before any chain load or side effect", async () => {
    const repo = await makeJobRepo("main");
    try {
      const r = await runCli(repo.dir, ["check", "--help"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Usage: flume check");
      expect(existsSync(join(repo.dir, ".flume"))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  }, 30_000);
});

/**
 * `flume friction [name]` (spec/cli.md §Subcommand surface) — the read verb
 * over `Chain.friction`. Reuses `minimalChainSrc` from the §6 friction-line
 * fixtures above: declaring `friction` and leaving it undeclared are both
 * already exercised there for `flume status`; these tests hold the CLI
 * surface itself, not the count-line helper it shares nothing with.
 */
describe("flume friction (spec/cli.md §Subcommand surface)", () => {
  it("bare lists the declared channel's notes — filename, size, mtime", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      const frictionDir = join(repo.dir, ".flume", "friction");
      await mkdir(frictionDir, { recursive: true });
      await writeFile(join(frictionDir, "a.md"), "note a\n");
      await writeFile(join(frictionDir, "b.md"), "longer note b body\n");

      const r = await runCli(repo.dir, ["friction"]);
      expect(r.code).toBe(0);
      // "note a\n" is 7 bytes; the ISO-8601 mtime carries a literal "T" and
      // trailing "Z" regardless of host timezone.
      expect(r.out).toMatch(/a\.md\s+7\s+\d{4}-\d{2}-\d{2}T.*Z/);
      expect(r.out).toContain("b.md");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("friction <name> prints that note's bytes verbatim", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      const frictionDir = join(repo.dir, ".flume", "friction");
      await mkdir(frictionDir, { recursive: true });
      const body = "line one\nline two, no trailing newline";
      await writeFile(join(frictionDir, "note.md"), body);

      const r = await runCli(repo.dir, ["friction", "note.md"]);
      expect(r.code).toBe(0);
      expect(r.out).toBe(body);
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("friction <name> with a nested path segment is refused the same as a missing note", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      const frictionDir = join(repo.dir, ".flume", "friction");
      const nestedDir = join(frictionDir, "sub");
      await mkdir(nestedDir, { recursive: true });
      // The file genuinely exists on disk — the refusal must come from scope
      // (not a direct child of the declared dir), matching the bare list's
      // direct-children enumeration and --help's stated "direct under the
      // channel dir" restriction, not from the file being absent.
      await writeFile(join(nestedDir, "note.md"), "nested body");

      const nested = await runCli(repo.dir, ["friction", "sub/note.md"]);
      const missing = await runCli(repo.dir, ["friction", "does-not-exist.md"]);
      expect(nested.code).toBe(2);
      expect(nested.code).toBe(missing.code);
      expect(nested.out).toContain("no note named 'sub/note.md'");

      // Consistent with bare list: a nested note is never enumerated either.
      const bare = await runCli(repo.dir, ["friction"]);
      expect(bare.out).not.toContain("note.md");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("refuses usage-shaped (exit 2) naming Chain.friction when the chain declares no channel", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc());

      const r = await runCli(repo.dir, ["friction"]);
      expect(r.code).toBe(2);
      expect(r.out).toContain("Chain.friction");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("a declared-but-absent friction dir lists empty and exits 0", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      // No .flume/friction dir created — never written by any tick yet.

      const r = await runCli(repo.dir, ["friction"]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);
});

// ---------- flume log (spec/cli.md §Subcommand surface, cli-log-verb) ----------

/**
 * A minimal, otherwise-valid `TickVerdict` — `writeTickVerdict`'s own shape
 * (`src/Dispatcher.ts`), constructed by hand here since `flume log` reads
 * `tick-verdicts.jsonl` directly rather than driving a real tick to produce
 * one (a real tick's plumbing is exercised in Dispatcher.test.ts; this suite
 * holds the CLI read-side alone).
 */
function makeVerdict(
  overrides: Partial<TickVerdict> & { phaseName: string },
): TickVerdict {
  return {
    tags: [],
    committed: false,
    gateResults: [],
    shippedTags: [],
    mergeOutcomes: [],
    summary: `${overrides.phaseName} placeholder`,
    ...overrides,
  };
}

/** Write `tick-verdicts.jsonl` directly under `<root>/.flume` — the log `readTickVerdicts` (`src/Dispatcher.ts`) reads, oldest first, top to bottom. */
async function writeTickVerdictsLog(
  root: string,
  verdicts: TickVerdict[],
): Promise<void> {
  await mkdir(join(root, ".flume"), { recursive: true });
  await writeFile(
    join(root, ".flume", "tick-verdicts.jsonl"),
    verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n",
    "utf8",
  );
}

describe("flume log (spec/cli.md §Subcommand surface)", () => {
  it("default prints the last 10 verdicts oldest-first as fixed-format lines", async () => {
    const repo = await makeJobRepo("main");
    try {
      const verdicts = Array.from({ length: 12 }, (_, i) =>
        makeVerdict({
          phaseName: `phase-${i}`,
          committed: true,
          gateResults: [{ gate: "tsc", ok: true, message: "" }],
          shippedTags: [`tag-${i}`],
          mergeOutcomes: [{ tag: `tag-${i}`, outcome: "merged" }],
        }),
      );
      await writeTickVerdictsLog(repo.dir, verdicts);

      const r = await runCli(repo.dir, ["log"]);
      expect(r.code).toBe(0);
      const lines = r.out.trim().split("\n");
      expect(lines).toHaveLength(10);
      // Last 10 of 12, oldest first — verdicts[2]..verdicts[11] in order.
      for (let i = 0; i < 10; i++) {
        const idx = i + 2;
        expect(lines[i]).toContain(`phase-${idx}`);
        expect(lines[i]).toContain("committed=true");
        expect(lines[i]).toContain("tsc:ok");
        expect(lines[i]).toContain(`tag-${idx}`);
        expect(lines[i]).toContain("merged");
      }
      // The two oldest, dropped by the default cap, never appear.
      expect(r.out).not.toContain("phase-0 ");
      expect(r.out).not.toContain("phase-1 ");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("-n N overrides the count", async () => {
    const repo = await makeJobRepo("main");
    try {
      const verdicts = Array.from({ length: 5 }, (_, i) =>
        makeVerdict({ phaseName: `phase-${i}` }),
      );
      await writeTickVerdictsLog(repo.dir, verdicts);

      const r = await runCli(repo.dir, ["log", "-n", "2"]);
      expect(r.code).toBe(0);
      const lines = r.out.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("phase-3");
      expect(lines[1]).toContain("phase-4");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("-n 0 prints nothing and exits 0, not the full history", async () => {
    const repo = await makeJobRepo("main");
    try {
      const verdicts = Array.from({ length: 5 }, (_, i) =>
        makeVerdict({ phaseName: `phase-${i}` }),
      );
      await writeTickVerdictsLog(repo.dir, verdicts);

      const r = await runCli(repo.dir, ["log", "-n", "0"]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("--json emits the TickVerdict records verbatim as JSONL, one per line", async () => {
    const repo = await makeJobRepo("main");
    try {
      const verdicts = [
        makeVerdict({
          phaseName: "build",
          committed: true,
          gateResults: [{ gate: "tsc", ok: true, message: "clean" }],
          shippedTags: ["TAG-A"],
          mergeOutcomes: [{ tag: "TAG-A", outcome: "merged" }],
        }),
        makeVerdict({
          phaseName: "plan",
          committed: false,
          noCommit: "voluntary-bail",
        }),
      ];
      await writeTickVerdictsLog(repo.dir, verdicts);

      const r = await runCli(repo.dir, ["log", "--json"]);
      expect(r.code).toBe(0);
      const lines = r.out.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual(verdicts[0]);
      expect(JSON.parse(lines[1]!)).toEqual(verdicts[1]);
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("no tick-verdicts.jsonl prints nothing and exits 0", async () => {
    const repo = await makeJobRepo("main");
    try {
      const r = await runCli(repo.dir, ["log"]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("mutates no baton flag", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeTickVerdictsLog(repo.dir, [makeVerdict({ phaseName: "build" })]);

      const r = await runCli(repo.dir, ["log"]);
      expect(r.code).toBe(0);
      expect(existsSync(join(repo.dir, ".flume", "awake"))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  }, 30_000);

  it("--help short-circuits before any side effect", async () => {
    const repo = await makeJobRepo("main");
    try {
      const r = await runCli(repo.dir, ["log", "--help"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Usage: flume log");
      expect(existsSync(join(repo.dir, ".flume"))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  }, 30_000);
});
