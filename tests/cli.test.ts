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
import { CLI, gitOut, hermeticEnv, runCli } from "./helpers/subprocess.ts";

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
    // resolution, so they win, and the job name survives for the fanout
    // namespace (v0.5 §4).
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
 * v0.7 §5, render-command seam: `main()`'s `render` branch wraps
 * `resolveChain()` in its own try/catch for `CjsContextLoadError`
 * (`src/cli.ts`) — independent of, and exercised separately from,
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

/**
 * PENDING-PARSE-FAILURE-REFUSES, engineering.md "Loud or nothing" — `render`
 * is a third reader of pending.json alongside `Dispatcher.tick()`'s
 * decide/rewrite reads. Pre-fix, a parse failure printed the errors to
 * stderr and fell through to `ctx.pending = []`, then rendered the prompt
 * anyway — a plan/build agent would see an empty queue instead of the
 * parse errors blocking it.
 */
describe("flume render — corrupt pending.json refuses instead of rendering over an empty queue (PENDING-PARSE-FAILURE-REFUSES)", () => {
  it("writes no prompt to stdout and exits non-zero", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc());
      const pendingPath = join(repo.dir, ".flume", "plan", "pending.json");
      await mkdir(dirname(pendingPath), { recursive: true });
      await writeFile(pendingPath, "{ not valid json", "utf8");

      const r = await runCli(repo.dir, ["render", "probe"]);

      expect(r.code).not.toBe(0);
      // Combined stdout+stderr never carries the prompt body — had it
      // rendered, this marker (from writeRepoConfig's default prompt
      // content) would be present.
      expect(r.out).not.toContain("job probe prompt");
      expect(r.out).toContain("pending.json invalid");
    } finally {
      await repo.cleanup();
    }
  }, 60_000);
});

function supervisorPolicyChainSrc(policy?: {
  quarantineScope?: "run" | "none";
  abortThreshold?: number;
}): string {
  return (
    `export default {\n` +
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
    `};\n`
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
            files: { new: [], edit: [], retire: [] },
          },
          {
            tag: "B",
            gate: { kind: "open" },
            dependsOnForks: [],
            files: { new: [], edit: [], retire: [] },
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
    (capabilities !== undefined
      ? `  capabilities: ${JSON.stringify(capabilities)},\n`
      : ``) +
    `};\n`
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
          files: { new: [], edit: [], retire: [] },
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
            files: { new: [], edit: [], retire: [] },
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
    "read-only subcommands (status, wake, sleep, render) resolve state to the job root, chain + prompt load from repo .flume — a job-dir chain.ts is inert",
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
