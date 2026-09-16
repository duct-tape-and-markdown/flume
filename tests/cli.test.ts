/**
 * CLI env canonicalization.
 *
 * After resolution, `process.env.FLUME_DIR` / `process.env.FLUME_CONFIG_DIR`
 * must hold the **absolute resolved** state root, so a chain loaded later in
 * the same process (and any spawned child) reads one canonical value rather
 * than re-deriving the default or a coincidentally-equal `configDir`. Exercised
 * at the resolution seam (`resolveStateDirs`) for the env-unset (default) and
 * env-set-relative cases.
 */

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, win32 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { isInvokedDirectly, onDiskIdentity, EX_DATAERR, EX_IOERR } from "../src/cli.ts";
import { buildFlumeApi } from "../src/flumeApi.ts";
// Barrel-export pin (.claude/rules/engineering.md "An export earns its
// consumer"): stopFlagPath is the chain-facing rule for `<flumeDir>/stop`,
// reachable from the package entry point as well as off the FlumeApi object.
// This import fails tsc if it drops from src/index.ts.
import { stopFlagPath as indexStopFlagPath } from "../src/index.ts";
import { Baton } from "../src/Baton.ts";
import { computeStateRootRel, EX_MOUNT_DEAD, EX_TERMINAL_MISCONFIG, loadChainModule } from "../src/Dispatcher.ts";
import { pendingGate } from "../src/builtinGates.ts";
import type { GateContext } from "../src/Gate.ts";
import { RUNTIME_IGNORES } from "../src/job.ts";
import { DEFAULT_PENDING_REL, resolvePendingPath } from "../src/paths.ts";
import { gitCommonDir, tipClaimPath } from "../src/git.ts";
import { DEFAULT_KILL_GRACE_MS } from "../src/processTree.ts";
import { denyDirectory } from "./helpers/denial.ts";
import { fileWithContent, waitFor } from "./helpers/waitFor.ts";
import {
  CLI,
  HERMETIC_ENV_STRIP_KEYS,
  SPAWN_BUDGET_MS,
  TSX_CLI,
  hermeticEnv,
  mkFixtureRoot,
  mkTempDir,
  processAlive,
  runCli,
  runCliStreams,
} from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

const exec = promisify(execFile);

const CLI_SRC_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

/**
 * The provider module a fixture chain imports the real `claudeCode` from —
 * an absolute path, because the chain it is written into lives in a temp repo
 * with no view of this one.
 */
const AGENT_SRC_PATH = fileURLToPath(new URL("../src/Agent.ts", import.meta.url));


/**
 * `isInvokedDirectly` (`src/cli.ts`), the seam gating `main()`.
 * Unit-level rather than a subprocess: the seam takes `argv1` and answers
 * against this module's own `import.meta.url`, so calling it directly with
 * `CLI` (this file's own import of cli.ts) exercises the exact comparison
 * `main()` gates on, without the overhead of spawning `tsx` per case.
 */
describe("isInvokedDirectly — CLI entry survives junctions", () => {
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
      // (pnpm's linked store) produces.
      expect(junctioned).not.toBe(CLI);
      expect(realpathSync(junctioned)).toBe(realpathSync(CLI));

      expect(isInvokedDirectly(junctioned)).toBe(true);
    } finally {
      await rm(linkParent, { recursive: true, force: true });
    }
  });

  it("the CLI entry check reads a namespaced realpath answer and its plain spelling as the same file", () => {
    // The case above, reduced to the pair of values it produces on win32 —
    // where alone it can produce them, and where this suite does not run.
    // `realpathSync` builds its answer from the argument it was handed, so the
    // `\\?\` prefix `toNamespacedPath` put there survives the leg that
    // resolved no link and is gone from the leg that resolved a junction. One
    // file, two spellings, and the two sides of the entry check land on
    // opposite ones through a linked install.
    //
    // The namespaced side is spelled by win32's own `toNamespacedPath` rather
    // than by hand here: it is the writer whose prefix the check has to read
    // back, and `win32` answers in its alphabet on every host, which is what
    // makes the pair reachable from this lane at all.
    const cli = String.raw`C:\pnpm-store\flume\dist\cli.js`;
    expect(onDiskIdentity(win32.toNamespacedPath(cli))).toBe(onDiskIdentity(cli));

    // A UNC install answers the same way one prefix further out
    // (`\\?\UNC\host\share\…`): the fold restores the `\\` root rather than
    // eating it, so the host name is not silently re-read as a directory.
    const share = String.raw`\\build-host\tools\flume\dist\cli.js`;
    expect(onDiskIdentity(win32.toNamespacedPath(share))).toBe(
      onDiskIdentity(share),
    );
  });
});

/**
 * The shared subprocess harness's `hermeticEnv()`
 * (`tests/helpers/subprocess.ts`) strips every identity/provenance FLUME_* var
 * it knows of — a job resolution or a tip-claim PID leaked from the vitest
 * process's own env is exactly as capable of retargeting a spawned CLI as a
 * relocated state root is. The assertion below checks the invariant directly —
 * no key matching `/^FLUME_/` survives in its output — rather than restating a
 * copy of its delete set (`.claude/rules/engineering.md`, "Derived state is
 * computed, never restated beside its source"; CLI-HERMETICENV-COVERS-ALL-VARS
 * had hardcoded a name list here that fell behind hermeticEnv()'s own deletes
 * twice). `HERMETIC_ENV_STRIP_KEYS` below (imported from the harness, not
 * restated) only seeds realistic input (and keeps the test non-vacuous); it
 * plays no role in what gets checked, so a var added to `hermeticEnv()`'s strip
 * set — or one that leaks ambiently from an outer flume-on-flume invocation —
 * is caught without touching this file.
 *
 * The strip is by prefix, never by list: `flume loop` sets
 * `FLUME_QUARANTINED_SLUGS` in every tick child after the first quarantine,
 * and a chain may export `FLUME_WORKTREES_DIR` at load, so both arrive
 * ambiently whenever this suite runs as an afterMerge gate. A list-based
 * strip passed here and failed there, reverting every entry for the rest of
 * the run. A test wanting one of them sets it explicitly on top of
 * `hermeticEnv()`'s output; the second case below pins the unlisted key.
 */
describe("hermeticEnv — strips every identity/provenance FLUME_* var", () => {
  it("strips a FLUME_* key the harness never listed (a supervisor-set var arriving ambiently)", () => {
    const key = "FLUME_QUARANTINED_SLUGS";
    const prior = process.env[key];
    try {
      process.env[key] = "some-slug";
      expect(HERMETIC_ENV_STRIP_KEYS).not.toContain(key);
      expect(Object.keys(hermeticEnv())).not.toContain(key);
    } finally {
      if (prior === undefined) delete process.env[key];
      else process.env[key] = prior;
    }
  });

  it("carries no key matching /^FLUME_/ when identity/provenance vars are set", () => {
    const prior = Object.fromEntries(
      HERMETIC_ENV_STRIP_KEYS.map((key) => [key, process.env[key]]),
    );
    try {
      for (const key of HERMETIC_ENV_STRIP_KEYS) {
        process.env[key] = `outer-${key}`;
      }

      const leaked = Object.keys(process.env).filter((key) => /^FLUME_/.test(key));
      expect(leaked.length).toBeGreaterThan(0);

      const env = hermeticEnv();
      const survivors = Object.keys(env).filter((key) => /^FLUME_/.test(key));

      expect(survivors).toEqual([]);
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
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

/**
 * Committed, not left on disk uncommitted — every strict pending.json read
 * the dispatcher acts on now resolves the committed `HEAD` tip, never the
 * working tree (spec/pending.md "Dispatch reads come from the tip, not the
 * tree"), so an uncommitted seed would be invisible to the real `flume
 * loop`/`flume tick` subprocess this feeds.
 */
async function writeStuckEntryPending(root: string): Promise<void> {
  // Placed by the accessor that owns the undeclared-queue default
  // (`resolvePendingPath`, src/paths.ts), never by a path spelled here — so a
  // consumer that resolved the default differently reads an absent queue
  // rather than a fixture the test steered onto its own answer.
  const queuePath = resolvePendingPath(join(root, ".flume"));
  await mkdir(dirname(queuePath), { recursive: true });
  await writeFile(
    queuePath,
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
  const opts = { cwd: root };
  await exec("git", ["add", "--", relative(root, queuePath)], opts);
  await exec("git", ["commit", "-q", "-m", "test: seed STUCK-ENTRY"], opts);
}

/**
 * Cross-process loop lock at `<flumeDir>/loop.pid`. One supervisor
 * per state root: a second `flume loop` is refused while the recorded pid is
 * alive; a stale pidfile (dead pid) is reclaimed.
 *
 * The lock branch resolves before `superviseLoop` spawns any child tick, so
 * `--max 0` exercises both outcomes with a single real CLI subprocess each —
 * no chain.ts, no git repo, no child processes. That keeps these fast-lane
 * safe despite spawning the real `flume loop` (the lock lives inline in the
 * CLI's `main()`; only a real process can exercise it).
 */
describe("cross-process loop lock — real `flume loop` against <flumeDir>/loop.pid", () => {
  // LOOP-MAX-NONNUMERIC-ACCEPTED: the --max bound below resolves before the
  // lock branch above it, so — like the lock cases in this suite — these
  // exercise the real CLI with no chain.ts, no git repo, no child tick.
  it(
    "`--max abc` (non-numeric) exits 2 naming usage and spawns no tick",
    async () => {
      const dir = await mkFixtureRoot("flume-loop-max-");
      try {
        const r = await runCli(dir, ["loop", "--max", "abc"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume loop");
        expect(r.out).not.toContain("reached --max");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "`--max` with no following value exits 2 naming usage and spawns no tick",
    async () => {
      const dir = await mkFixtureRoot("flume-loop-max-");
      try {
        const r = await runCli(dir, ["loop", "--max"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume loop");
        expect(r.out).not.toContain("reached --max");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "`--max -1` (negative) exits 2 naming usage and spawns no tick",
    async () => {
      const dir = await mkFixtureRoot("flume-loop-max-");
      try {
        const r = await runCli(dir, ["loop", "--max", "-1"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume loop");
        expect(r.out).not.toContain("reached --max");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "refuses a second loop while the recorded pid is alive, leaving the pidfile untouched",
    async () => {
      // A real git repo on a named branch (loop refuses outright
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
        // not the repo (a relocated dock carries its lock with it).
        expect(r.out).toContain(flumeDir);
        expect(r.out).toContain("refusing");
        // The holder's pidfile survives the refused contender untouched.
        expect(await readFile(pidPath, "utf8")).toBe(String(process.pid));
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
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
    SPAWN_BUDGET_MS,
  );

  // LOOP-LOCK-SHARES-LIVELOOPPID: the lock's liveness read and `flume
  // status`'s supervisor-liveness read both go through
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
    SPAWN_BUDGET_MS,
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
    SPAWN_BUDGET_MS,
  );
});

/**
 * A fanout chain whose agent, only for the `ship-a` worktree, corrupts
 * `<flumeDir>/plan/pending.json` mid-invocation (same mechanism
 * `tests/Dispatcher.test.ts`'s WaveLedgerParseFailure suite uses) and then
 * commits its declared file — so `commitPendingUpdate`'s rewrite read hits
 * an unparseable ledger after the cherry-pick and (gate-less) afterMerge
 * pass have already landed. The `DECLINE-B` entry never reaches the agent:
 * `shouldRun` declines it before invocation, so the wave
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
    `      const flumeDirEnv = process.env.FLUME_DIR ?? "";\n` +
    `      const pendingPath = join(flumeDirEnv, ${JSON.stringify(DEFAULT_PENDING_REL)});\n` +
    `      writeFileSync(pendingPath, "{ corrupted mid-wave, not json", "utf8");\n` +
    // Committed on trunk, not left on disk uncommitted: the rewrite read
    // this corruption targets now resolves the committed HEAD tip, never
    // the working tree (spec/pending.md "Dispatch reads come from the tip,
    // not the tree").
    `      const repoRoot = join(flumeDirEnv, "..");\n` +
    `      execFileSync(\n` +
    `        "git",\n` +
    `        ["add", "--", pendingPath],\n` +
    `        { cwd: repoRoot },\n` +
    `      );\n` +
    `      execFileSync(\n` +
    `        "git",\n` +
    `        ["commit", "-q", "-m", "test: corrupt pending.json mid-wave"],\n` +
    `        { cwd: repoRoot },\n` +
    `      );\n` +
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
        const pendingPath = resolvePendingPath(flumeDir);
        await mkdir(dirname(pendingPath), { recursive: true });
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
        // Committed, not left on disk uncommitted — the decide-read now
        // resolves the committed HEAD tip (spec/pending.md "Dispatch reads
        // come from the tip, not the tree").
        await exec("git", ["add", "--", pendingPath], {
          cwd: repo.dir,
        });
        await exec("git", ["commit", "-q", "-m", "test: seed SHIP-A/DECLINE-B"], {
          cwd: repo.dir,
        });
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
          mergeOutcomes: {
            tag?: string;
            outcome: string;
            baseSha?: string;
            headSha?: string;
          }[];
        };

        expect(verdict.phaseName).toBe("build");
        expect(verdict.committed).toBe(true);
        expect(verdict.shippedTags).toEqual(["SHIP-A"]);
        expect([...verdict.tags].sort()).toEqual(["DECLINE-B", "SHIP-A"]);
        expect(verdict.declined).toBe(true);
        expect(verdict.mergeOutcomes).toEqual([
          {
            entryTag: "SHIP-A",
            outcome: "merged",
            baseSha: expect.stringMatching(/^[0-9a-f]{40}$/),
            headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
          },
        ]);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});

/**
 * Real CLI seam — `Chain.supervisorPolicy` reaching `flume loop`'s
 * supervisor end-to-end (`src/cli.ts`'s best-effort chain resolve →
 * `superviseLoop` forwarding). `tests/loopSupervisor.test.ts`'s "supervisor
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
describe("flume loop — supervisorPolicy reaching the real CLI", () => {
  it(
    "a chain declaring no supervisorPolicy: a tagged provisioning failure quarantines once, then the run is unchanged through --max (the shipped default)",
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
        // shipped — the exit-code contract.
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
    SPAWN_BUDGET_MS,
  );

  it(
    'a chain declaring supervisorPolicy: { quarantineScope: "none", abortThreshold: 2 } aborts on the 2nd consecutive identical failure — the override reaches the real supervisor',
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
        // falling through to the untouched shipped default of 3.
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
    SPAWN_BUDGET_MS,
  );
});

/**
 * `flume status` surfaces supervisor liveness beside the awake
 * markers. Incident (2026-07-29): `status` read baton markers only and
 * printed "hibernating" while a prior supervisor was still alive, so the
 * operator deleted `loop.pid` on a stale assumption. Same pid-liveness
 * shape as the loop-lock tests above (`liveLoopPid`, `src/job.ts`), applied
 * to a bare `.flume/loop.pid` rather than a job dir's.
 */
describe("flume status — supervisor liveness", () => {
  it("names the pid of a live supervisor", async () => {
    const dir = await mkFixtureRoot("flume-status-live-");
    try {
      const flumeDir = join(dir, ".flume");
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
  }, SPAWN_BUDGET_MS);

  it("reports a stale pidfile when the recorded pid is dead", async () => {
    const dir = await mkFixtureRoot("flume-status-stale-");
    try {
      const flumeDir = join(dir, ".flume");
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
  }, SPAWN_BUDGET_MS);

  it("flume status exits non-zero when loop.pid exists but cannot be stat'd", async () => {
    const dir = await mkFixtureRoot("flume-status-unstattable-pid-");
    try {
      const flumeDir = join(dir, ".flume");
      // A self-referential symlink reproduces a non-ENOENT stat failure
      // (ELOOP) without relying on permission bits a root-run test could
      // bypass — the same approach the friction/pending read cases take with
      // EISDIR. `existsSync` collapses it to "absent", which printed no
      // supervisor line at all over a `loop.pid` that is there
      // (`.claude/rules/engineering.md`, "Loud or nothing").
      await symlink("loop.pid", join(flumeDir, "loop.pid"));

      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(EX_IOERR);
      expect(r.out).toContain("loop.pid");
      expect(r.out).toContain("failed to stat");
      expect(r.out).not.toContain("supervisor pid");
      expect(r.out).not.toContain("stale");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it("is unchanged from today when no pidfile exists", async () => {
    const dir = await mkFixtureRoot("flume-status-nopid-");
    try {
      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(0);
      expect(r.out).toContain("hibernating");
      expect(r.out).not.toContain("supervisor pid");
      expect(r.out).not.toContain("stale");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
});

// ---------- job resolution through the real CLI ----------

/**
 * Scratch git repo on a chosen branch. The engine has no opinion on branch
 * names — some fixtures below pin `job/foo` merely as a
 * distinctive label, proven inert by running job resolution on `main`
 * instead.
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
 * A minimal, otherwise-valid chain — never ticked in the friction tests
 * below, just loaded for its declared fields. `friction` omitted leaves the
 * field undeclared entirely (undeclared turns every friction behavior off).
 */
function minimalChainSrc(friction?: string, pendingPath?: string): string {
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
    (pendingPath !== undefined
      ? `  pendingPath: ${JSON.stringify(pendingPath)},\n`
      : ``) +
    `} });\n`
  );
}

/**
 * `minimalChainSrc`, but with an agent declared so the dispatcher never
 * falls through to the real `claudeCode()` agent (`src/Dispatcher.ts`) —
 * for tests that only need a tick to complete cleanly, not to observe what
 * an agent does. spec/worktrees.md "The default test lane must stay fast":
 * a real agent invocation in the fast lane is flaky under parallel load.
 */
function minimalStubbedAgentChainSrc(): string {
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
    `},\n` +
    `agent: {\n` +
    `  name: "stub-agent",\n` +
    `  async invoke() {\n` +
    `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
    `  },\n` +
    `} });\n`
  );
}

/**
 * `flume status`'s friction line (`frictionCountLine`,
 * `src/Dispatcher.ts`): a count of files in the declared friction dir,
 * appended only when declared and non-empty. Best-effort: a missing/broken
 * chain never fails `status` (covered elsewhere); these tests hold the
 * chain fixed and vary only the friction declaration/dir contents.
 */
describe("flume status — friction line", () => {
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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

  it("renders 'friction: unreadable' when the declared dir exists but readdir fails for a non-ENOENT reason (dispatcher-frictioncountline-loud-or-nothing)", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      const frictionDir = join(repo.dir, ".flume", "friction");
      await mkdir(frictionDir, { recursive: true });
      await writeFile(join(frictionDir, "a.md"), "note a\n");
      // Deny the friction dir structurally (`tests/helpers/denial.ts`):
      // readdir now fails ENOTDIR — the path is there but is not a dir to
      // read — not ENOENT (`.claude/rules/engineering.md`, "Loud or
      // nothing"). Same primitive `flume job status`'s own frictionCount
      // test uses (tests/job.test.ts), and it denies on win32 too.
      denyDirectory(frictionDir);

      const r = await runCli(repo.dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("hibernating");
      expect(r.out).toContain("friction: unreadable");
      expect(r.out).not.toContain("note(s) await routing");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * `flume status` names the pending entry count alongside awake phases:
 * a valid pending.json by entry count, a corrupt one as "unparsable" rather
 * than silently dropped, and an absent one as 0. No chain/git repo needed —
 * the count comes from `readPendingLoose` (`src/job.ts`), the same
 * chain-less probe `flume job status` uses per job.
 */
describe("flume status — pending entry count", () => {
  it("names the entry count for a valid pending.json", async () => {
    const dir = await mkFixtureRoot("flume-status-pending-");
    try {
      const queuePath = resolvePendingPath(join(dir, ".flume"));
      await mkdir(dirname(queuePath), { recursive: true });
      await writeFile(
        queuePath,
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
  }, SPAWN_BUDGET_MS);

  it('prints "pending: unparsable" for a corrupt pending.json instead of dropping it silently', async () => {
    const dir = await mkFixtureRoot("flume-status-pending-");
    try {
      const queuePath = resolvePendingPath(join(dir, ".flume"));
      await mkdir(dirname(queuePath), { recursive: true });
      await writeFile(queuePath, "not json{", "utf8");

      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("pending: unparsable");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it('prints "pending: 0" when plan/pending.json is absent', async () => {
    const dir = await mkFixtureRoot("flume-status-pending-");
    try {
      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("pending: 0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it("honors a chain-declared pendingPath (CHAIN-PENDINGPATH) — counts entries at the custom location, not plan/pending.json", async () => {
    const dir = await mkFixtureRoot("flume-status-pending-");
    try {
      const customRel = join("custom", "queue.json");
      await writeRepoConfig(dir, minimalChainSrc(undefined, customRel));
      const customDir = join(dir, ".flume", "custom");
      await mkdir(customDir, { recursive: true });
      await writeFile(
        join(customDir, "queue.json"),
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
      // A queue at the default location must never be consulted once a
      // custom pendingPath is declared — so the decoy is placed by the
      // accessor that owns that default, never by a path spelled here. A
      // decoy at a stale literal would sit somewhere `status` never looks,
      // and this control would pass without controlling anything.
      const decoyPath = resolvePendingPath(join(dir, ".flume"));
      await mkdir(dirname(decoyPath), { recursive: true });
      await writeFile(decoyPath, JSON.stringify([]), "utf8");

      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("pending: 1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * A minimal chain declaring `capabilities` (or omitting it) — same shape as
 * `minimalChainSrc`, varied for the capability-skip status tests
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
  const queuePath = resolvePendingPath(join(root, ".flume"));
  await mkdir(dirname(queuePath), { recursive: true });
  await writeFile(
    queuePath,
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
 * `requiresDockerHost` generalized to `requiresCapability`: an
 * entry skipped because the chain hasn't asserted its capability must never
 * be a silent skip. `flume status` names the missing capability alongside
 * the tag so the operator sees why the queue is stuck, without reading logs.
 */
describe("flume status — names the missing capability on a requiresCapability skip", () => {
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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);
});

/**
 * A chain.ts whose factory throws — the load failure `status` and `job
 * status` must report rather than absorb. Throwing from the factory (not a
 * syntax error) keeps the failure the operator's own, with a message this
 * suite can name verbatim.
 */
const THROWING_CHAIN_SRC =
  `export default () => {\n  throw new Error("chain factory exploded");\n};\n`;

/**
 * CHAIN-LOAD-FAILURE-REPORTED — both observational surfaces load the chain
 * best-effort, for `Chain.pendingPath`, `Chain.friction`, and
 * `Chain.capabilities`. Best-effort used to mean silent: a chain that threw
 * left `status` printing a pending count rebased on the default queue path,
 * exit 0, with nothing said — a confident wrong number
 * (`.claude/rules/engineering.md`, "Loud or nothing"). The load is shared
 * (`loadChainForObservation`, `src/cliChainLoad.ts`) and reports its own
 * failure; the surfaces' exit codes and stdout are unchanged.
 */
describe("flume status — a chain that fails to load (CHAIN-LOAD-FAILURE-REPORTED)", () => {
  it("flume status names the chain-load failure it proceeded past", async () => {
    const dir = await mkFixtureRoot("flume-status-chainfail-");
    try {
      await writeRepoConfig(dir, THROWING_CHAIN_SRC);
      // The entries the chain's own `pendingPath` would have pointed at —
      // unreachable now, so the count below rebases on plan/pending.json
      // (absent) and reads 0. That rebase is exactly what must not be silent.
      await mkdir(join(dir, ".flume", "custom"), { recursive: true });
      await writeFile(
        join(dir, ".flume", "custom", "queue.json"),
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

      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(0);
      expect(r.out).toContain("status: chain failed to load");
      expect(r.out).toContain("chain factory exploded");
      expect(r.out).toContain("the pending count reads the default queue path");
      // Non-vacuity: the degraded count really is the one being reported on.
      expect(r.out).toContain("pending: 0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it("both observational surfaces still exit 0 when the chain fails to load", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, THROWING_CHAIN_SRC);
      await mkdir(join(repo.dir, ".flume", "jobs", "j1"), { recursive: true });

      const status = await runCliStreams(repo.dir, ["status"]);
      const jobStatus = await runCliStreams(repo.dir, ["job", "status"]);

      expect(status.code).toBe(0);
      expect(jobStatus.code).toBe(0);
      // The report rides stderr; the observational stdout is the same text
      // either surface prints over a chain that loads.
      expect(status.stderr).toContain("chain failed to load");
      expect(jobStatus.stderr).toContain("chain failed to load");
      expect(status.stdout).toContain("hibernating");
      expect(status.stdout).toContain("pending: 0");
      expect(status.stdout).not.toContain("chain failed to load");
      expect(jobStatus.stdout).toContain("j1");
      expect(jobStatus.stdout).not.toContain("chain failed to load");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);
});


/**
 * WAKE-SLEEP-CHAIN-LOAD-REPORTED — `wake`/`sleep` validate the phase name
 * against the chain's declared phases, so they take the same best-effort
 * load `status` does. It used to be a second, bare `catch { return false }`
 * beside the shared one: a chain that threw meant the marker landed with
 * nothing said, and the operator could not tell "your chain declares this
 * phase" from "nothing checked" (`.claude/rules/engineering.md`, "The fix
 * lands at the mechanism"). Both now route through
 * `loadChainForObservation` and name the failure they proceeded past. Exit
 * codes and stdout are unchanged — the marker still lands.
 */
describe("flume wake/sleep — a chain that fails to load (WAKE-SLEEP-CHAIN-LOAD-REPORTED)", () => {
  it(
    "flume wake reports a chain.ts that fails to load instead of proceeding silently",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, THROWING_CHAIN_SRC);

        const wake = await runCliStreams(repo.dir, ["wake", "probe"]);

        expect(wake.code).toBe(0);
        expect(wake.stderr).toContain("wake: chain failed to load");
        expect(wake.stderr).toContain("chain factory exploded");
        expect(wake.stderr).toContain("'probe' is taken on trust");
        expect(wake.stderr).toContain(
          "`flume tick` and `flume check` refuse on this same load",
        );
        // Non-vacuity: the degraded path really did proceed — the marker the
        // report is about landed, on the same stdout a loading chain prints.
        expect(wake.stdout).toContain("woke probe");
        expect(wake.stdout).not.toContain("chain failed to load");
        expect(existsSync(join(repo.dir, ".flume", "awake", "probe"))).toBe(
          true,
        );
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume sleep reports a chain.ts that fails to load instead of proceeding silently",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, THROWING_CHAIN_SRC);
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const sleep = await runCliStreams(repo.dir, ["sleep", "probe"]);

        expect(sleep.code).toBe(0);
        expect(sleep.stderr).toContain("sleep: chain failed to load");
        expect(sleep.stderr).toContain("chain factory exploded");
        expect(sleep.stderr).toContain("'probe' is taken on trust");
        // Non-vacuity: the marker this tick cleared was really there first.
        expect(sleep.stdout).toContain("slept probe");
        expect(sleep.stdout).not.toContain("chain failed to load");
        expect(existsSync(join(repo.dir, ".flume", "awake", "probe"))).toBe(
          false,
        );
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
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
    SPAWN_BUDGET_MS,
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
    SPAWN_BUDGET_MS,
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
    SPAWN_BUDGET_MS,
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
    SPAWN_BUDGET_MS,
  );
});

// ---------- flume stop (spec/loop.md "Graceful stop — the stop flag")
// ----------

describe("flume stop — writes <flumeDir>/stop and prints the consequence", () => {
  it(
    "writes the flag and names the path plus what happens next, exit 0",
    async () => {
      const dir = await mkFixtureRoot("flume-stop-");
      try {
        const stopPath = join(dir, ".flume", "stop");
        const r = await runCli(dir, ["stop"]);
        expect(r.code).toBe(0);
        expect(existsSync(stopPath)).toBe(true);
        expect(r.out).toContain(stopPath);
        expect(r.out).toContain(
          "finishes its in-flight tick and ends the run",
        );
        expect(r.out).toContain(
          "refuses to start until the flag is removed",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "is idempotent — a repeat call finds the flag already present and prints the same statement, exit 0",
    async () => {
      const dir = await mkFixtureRoot("flume-stop-idempotent-");
      try {
        const first = await runCli(dir, ["stop"]);
        const second = await runCli(dir, ["stop"]);
        expect(first.code).toBe(0);
        expect(second.code).toBe(0);
        expect(second.out).toBe(first.out);
        expect(existsSync(join(dir, ".flume", "stop"))).toBe(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );

  /**
   * The rule a chain reads the flag through, driven through the real writer:
   * `flume stop` runs as a subprocess and the API's path is what locates
   * what it wrote (`.claude/rules/engineering.md`, *A seam gate reads what
   * the real writer wrote*). A chain planting or clearing the flag — a
   * `handoff` that will not let the run continue, a gate that ends the wave
   * — otherwise spells `join(flumeDir, "stop")` itself, a second copy of a
   * name only `src/paths.ts` owns.
   */
  it("FlumeApi carries the stop-flag path rule", async () => {
    const dir = await mkFixtureRoot("flume-api-stop-");
    try {
      const flumeDir = join(dir, ".flume");
      const api = buildFlumeApi({
        repoRoot: dir,
        configDir: flumeDir,
        flumeDir,
      });
      const viaApi = api.stopFlagPath(flumeDir);
      // The exported rule itself, not a lookalike composed beside it.
      expect(api.stopFlagPath).toBe(indexStopFlagPath);

      // Non-vacuity: nothing is at that path until the real writer runs, so
      // the assertion below cannot pass over a pre-existing file.
      expect(existsSync(viaApi)).toBe(false);

      const r = await runCli(dir, ["stop"]);
      expect(r.code).toBe(0);
      // The writer's own statement names the same path the API composes, and
      // the file the writer left is at it.
      expect(r.out).toContain(viaApi);
      expect(existsSync(viaApi)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it("flume stop --help short-circuits before writing the flag", async () => {
    const dir = await mkFixtureRoot("flume-stop-help-");
    try {
      const r = await runCli(dir, ["stop", "--help"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Usage: flume stop");
      expect(existsSync(join(dir, ".flume", "stop"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
});

describe("flume status — stop flag line (spec/cli.md \"flume status owes exactly this\", line 3)", () => {
  it("prints nothing when the flag is absent", async () => {
    const dir = await mkFixtureRoot("flume-status-stop-absent-");
    try {
      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain(join(dir, ".flume", "stop"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it(
    "names the path and that the running supervisor will finish and end the run, ordered after supervisor liveness and before the tip claim",
    async () => {
      const dir = await mkFixtureRoot("flume-status-stop-live-");
      try {
        const flumeDir = join(dir, ".flume");
        // The vitest worker itself plays the live supervisor.
        await writeFile(join(flumeDir, "loop.pid"), String(process.pid), "utf8");
        await writeFile(join(flumeDir, "stop"), "", "utf8");

        const r = await runCli(dir, ["status"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain(join(flumeDir, "stop"));
        expect(r.out).toContain(
          "the running supervisor will finish its in-flight tick and end the run",
        );

        const liveIdx = r.out.indexOf(`supervisor pid ${process.pid} live`);
        const stopIdx = r.out.indexOf(join(flumeDir, "stop"));
        expect(liveIdx).toBeGreaterThanOrEqual(0);
        expect(stopIdx).toBeGreaterThan(liveIdx);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );

  it("`flume status` exits EX_IOERR on a non-ENOENT stop-flag stat, instead of printing no stop line", async () => {
    const dir = await mkFixtureRoot("flume-status-stop-unstattable-");
    try {
      const flumeDir = join(dir, ".flume");
      // A self-referential symlink reproduces a non-ENOENT stat failure
      // (ELOOP) without relying on permission bits a root-run test could
      // bypass — the same shape the loop.pid case above uses. `existsSync`
      // collapses it to "absent", which printed no stop line at all over a
      // flag that is there, telling the operator there is no pending stop
      // (`.claude/rules/engineering.md`, "Loud or nothing").
      await symlink("stop", join(flumeDir, "stop"));

      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(EX_IOERR);
      expect(r.out).toContain(join(flumeDir, "stop"));
      expect(r.out).toContain("failed to stat");
      expect(r.out).not.toContain("the next `loop`/`job run` refuses");
      expect(r.out).not.toContain("will finish its in-flight tick");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it(
    "names the path and that the next loop/job run refuses, when no supervisor is live",
    async () => {
      const dir = await mkFixtureRoot("flume-status-stop-dead-");
      try {
        const flumeDir = join(dir, ".flume");
        await writeFile(join(flumeDir, "stop"), "", "utf8");

        const r = await runCli(dir, ["status"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain(join(flumeDir, "stop"));
        expect(r.out).toContain(
          "the next `loop`/`job run` refuses to start until it is removed",
        );
        expect(r.out).not.toContain("supervisor pid");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );
});

describe("flume status — tip claim line (spec/cli.md \"flume status owes exactly this\", line 4)", () => {
  it("`flume status` exits EX_IOERR on a non-ENOENT tip-claim stat, instead of printing no claim line", async () => {
    const repo = await makeJobRepo("main");
    try {
      // The claim path comes from the engine accessor, never a second
      // spelling of the tip-claims layout here.
      const claimPath = tipClaimPath(await gitCommonDir(repo.dir), "refs/heads/main");
      await mkdir(dirname(claimPath), { recursive: true });
      // ELOOP: present on disk, unstattable. `existsSync` reads it as absent,
      // which printed no claim line at all — the operator reads an unclaimed
      // tip and starts a second writer against it
      // (`.claude/rules/engineering.md`, "Loud or nothing").
      await symlink("main", claimPath);

      const r = await runCli(repo.dir, ["status"]);

      expect(r.code).toBe(EX_IOERR);
      expect(r.out).toContain(claimPath);
      expect(r.out).toContain("failed to stat");
      expect(r.out).not.toContain("tip claimed by pid");
      expect(r.out).not.toContain("tip claim present, process dead");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("a git-side failure stays silent, as declared: a detached HEAD prints no claim line and exits 0", async () => {
    const repo = await makeJobRepo("main");
    try {
      const sha = (
        await exec("git", ["rev-parse", "HEAD"], { cwd: repo.dir })
      ).stdout.trim();
      await exec("git", ["checkout", "-q", "--detach", sha], { cwd: repo.dir });

      const r = await runCli(repo.dir, ["status"]);

      expect(r.code).toBe(0);
      expect(r.out).toContain("hibernating");
      expect(r.out).not.toContain("tip claim");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * The release half of the claim's lifecycle, through the real CLI. The
 * acquire/refuse/reclaim mechanics and the mid-tick/signal wiring live in
 * `tests/tip-claim.integration.test.ts`; this one case stays in the fast
 * lane because it is what the claim's release guarantee is *judged* by —
 * `--max 0` runs no tick, loads no chain, and spawns nothing but the CLI
 * itself, so the lane stays fast (spec/worktrees.md, "The default test lane
 * must stay fast").
 */
describe("flume loop — tip claim release (spec/loop.md \"The loop lock and the tip claim\")", () => {
  it(
    "flume loop --max 0 reclaims a stale tip claim at the derived path and leaves none behind",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        // The claim path comes from the engine accessor, never a second
        // spelling of the tip-claims layout here.
        const claimPath = tipClaimPath(
          await gitCommonDir(repo.dir),
          "refs/heads/main",
        );
        await mkdir(dirname(claimPath), { recursive: true });
        // Harvest a genuinely dead pid: spawn a no-op node child and wait for
        // it to exit before recording its pid as the stale holder.
        const probe = exec(process.execPath, ["-e", ""]);
        const deadPid = probe.child.pid;
        await probe;
        await writeFile(claimPath, String(deadPid), "utf8");
        // The claim is on disk *before* the loop runs. Without this the
        // absence below is an absence over an empty directory — green
        // whether the engine releases the claim, never takes one, or writes
        // it somewhere else entirely (`.claude/rules/engineering.md`, "A
        // green verdict is proven non-vacuous").
        expect(existsSync(claimPath)).toBe(true);

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);

        expect(r.code).toBe(0);
        expect(r.out).toContain("reached --max 0");
        // Reclaimed over the dead holder on the way in, released on the
        // clean exit on the way out.
        expect(existsSync(claimPath)).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume loop refuses a live-held tip claim and leaves no loop.pid behind",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        // Same state root as the loop about to run, so `loop.pid` is taken
        // first and only the tip claim can refuse — which makes the absence
        // below a rollback, not a lock never taken. (The cross-state-root
        // pairing, where `loop.pid` never collides at all, is
        // `tests/tip-claim.integration.test.ts`.)
        const claimPath = tipClaimPath(
          await gitCommonDir(repo.dir),
          "refs/heads/main",
        );
        await mkdir(dirname(claimPath), { recursive: true });
        // The vitest worker itself plays the live holder.
        await writeFile(claimPath, String(process.pid), "utf8");
        expect(existsSync(claimPath)).toBe(true);

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain(`refs/heads/main claimed by pid ${process.pid}`);
        expect(r.out).not.toContain("reached --max");
        // The loop lock it took on the way in is rolled back by the refusal —
        // a `loop.pid` left here refuses the operator's next run against a
        // supervisor that never started.
        expect(existsSync(join(repo.dir, ".flume", "loop.pid"))).toBe(false);
        // The live holder's claim survives the refused contender untouched.
        expect(await readFile(claimPath, "utf8")).toBe(String(process.pid));
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});

/**
 * A chain whose agent records the pid of the process running it, then parks
 * until the tick's own abort releases it — so a test can observe the loop's
 * tick *child* mid-tick and signal the supervisor while that child is still
 * writing under the state root the claim protects. The pid is the tick
 * child's own: a chain-declared agent runs in-process in the `flume tick` the
 * supervisor spawned.
 *
 * Every path handed in is absolute and outside the fixture repo — these files
 * are the test's sync points, not tick artifacts, and a write into the
 * working tree would be one more thing the tick has to explain.
 *
 * The three optional arms are what the tree-teardown cases need past the
 * plain child:
 *
 * - `grandchildPidPath` — the agent spawns a parked process of its own and
 *   reports its pid. That grandchild is what a `ChildProcess.kill` aimed at
 *   the tick child alone never reaches; it shares the tick child's group, so
 *   the supervisor's own signal is what must reach it.
 * - `wedged` — the agent parks *through* the abort instead of settling on it,
 *   so the tick child never finishes its release and never exits. That is the
 *   child spec/loop.md leaves holding the run open rather than releasing over
 *   a live writer — the shape a supervisor with a grace of its own would
 *   SIGKILL instead.
 * - `killGraceMs` — declared on `supervisorPolicy`, the grace a signalled
 *   tick escalates under. This agent is in-process, so nothing in this chain
 *   escalates on it: it is the number a supervisor must *not* bound its own
 *   wait by.
 *
 * The park outlasts `SPAWN_BUDGET_MS` deliberately: a tree that is never
 * taken down must red its case on the budget rather than outliving the wait
 * and passing as a teardown.
 */
function tickChildPidChainSrc(
  pidPath: string,
  opts: {
    grandchildPidPath?: string;
    wedged?: boolean;
    killGraceMs?: number;
  } = {},
): string {
  const PARKED_GRANDCHILD = "setInterval(() => {}, 1000);";
  return (
    `import { writeFileSync } from "node:fs";\n` +
    `import { spawn } from "node:child_process";\n` +
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: "probe",\n` +
    `    description: "signalled-loop probe",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    (opts.killGraceMs !== undefined
      ? `  supervisorPolicy: { killGraceMs: ${opts.killGraceMs} },\n`
      : ``) +
    `},\n` +
    `agent: {\n` +
    `  name: "parked",\n` +
    `  async invoke({ signal }) {\n` +
    (opts.grandchildPidPath !== undefined
      ? `    const kid = spawn(process.execPath, ["-e", ${JSON.stringify(PARKED_GRANDCHILD)}], { stdio: "ignore" });\n` +
        `    writeFileSync(${JSON.stringify(opts.grandchildPidPath)}, String(kid.pid));\n`
      : ``) +
    `    writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));\n` +
    // The park, and how it ends. A well-behaved agent settles on the tick's
    // abort and clears its timer, so the child completes its own release and
    // exits; `wedged` drops that listener, leaving a child no signal of the
    // supervisor's can move.
    `    await new Promise((r) => {\n` +
    `      const t = setTimeout(r, 600_000);\n` +
    (opts.wedged === true
      ? ``
      : `      signal?.addEventListener("abort", () => { clearTimeout(t); r(undefined); }, { once: true });\n`) +
    `    });\n` +
    `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
    `  },\n` +
    `} });\n`
  );
}

/**
 * The grace the tree-teardown arms declare. Short enough that escalating
 * through it costs a fraction of a case, and far enough under
 * `DEFAULT_KILL_GRACE_MS` (`src/processTree.ts`) that a run bounded by the
 * engine's own value could not be mistaken for one bounded by this.
 */
const DECLARED_GRACE_MS = 250;

/**
 * The grace the loop's *tick child* escalates under in the delegated-grace
 * arm, an order of magnitude above {@link DECLARED_GRACE_MS} — which that arm
 * declares to the supervisor alone. Two numbers rather than one because the
 * property is *whose* timer ended the tree: at one number the supervisor's
 * SIGKILL and the child's land milliseconds apart, and which arrived first is
 * a coin toss rather than an assertion.
 */
const TICK_GRACE_MS = DECLARED_GRACE_MS * 8;

/**
 * How long the wedged-child arm watches a signalled run stay open. Several
 * times {@link DECLARED_GRACE_MS}, so a supervisor that bounded its own wait
 * by the declared grace would have escalated, released both guards and exited
 * well inside it — the one arm here with no event to wait on, because the run
 * not ending is its subject.
 */
const WEDGED_HOLD_MS = DECLARED_GRACE_MS * 8;

/**
 * The grace the bare tick's announcement arm declares — long enough that the
 * agent tree the announced wait is about is provably still up while the line
 * is read, rather than racing an escalation that could have ended it first.
 * Nothing waits it out: that arm ends by killing the tree itself, as every
 * arm here does.
 */
const ANNOUNCED_GRACE_MS = 600_000;

/**
 * Every pid a signalled-teardown driver learned about — the loop's below and
 * the bare tick's further down — drained by the arms' `afterEach`.
 *
 * The per-run cleanup cannot be the only one: a case that blows its budget is
 * rejected mid-`await`, so neither its `finally` nor the driver's own `catch`
 * ever runs — and the parks above deliberately outlast that budget, which is
 * what makes them red a tree that is never taken down. A hook is what still
 * runs on that path.
 */
const signalledPids: (number | undefined)[] = [];

/**
 * SIGKILL a pid this suite recorded, if it is still there. Teardown only: an
 * arm that reds before its assertions — the whole point of the parks above
 * outlasting the budget — must not leave a parked tree behind for the rest of
 * the lane to run alongside.
 */
function killIfAlive(pid: number | undefined): void {
  if (pid === undefined || !processAlive(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // raced its own exit — gone is the outcome either way
  }
}

/**
 * Drive a real `flume loop` to a tick parked mid-agent and SIGTERM the
 * supervisor — the shape every arm below shares. Returns the pids it
 * observed, the run's exit as a promise, the output collected so far, and the
 * cleanup its caller owns.
 *
 * The exit is handed over rather than awaited here: the supervisor bounds its
 * wait on the tick child by nothing of its own (spec/loop.md, "The loop lock
 * and the tip claim"), so an arm whose child is wedged past its handler has
 * no exit to wait for — the run staying open *is* that arm's subject.
 *
 * `agent` chooses which park the tick holds at. `"in-process"` (the default)
 * runs a chain-declared agent inside the tick child itself, so the pid
 * reported is that child's. `"spawned"` runs the shipped `claudeCode`
 * provider against a node one-liner, so the pid reported is a real agent
 * process in a group of its own — the tree the supervisor's signal cannot
 * reach and only the tick child's own escalation can end.
 *
 * The signal targets the pid in `loop.pid` rather than the spawned process's
 * own: tsx re-execs itself into a second node process, so the spawned handle
 * is the bootstrapper's, and the process that took the locks is the one an
 * operator's SIGTERM finds in production.
 */
async function signalledLoopRun(opts: {
  agent?: "in-process" | "spawned";
  grandchild?: boolean;
  /** `agent: "spawned"` only — the agent process swallows the SIGTERM. */
  ignoreSigterm?: boolean;
  /** `agent: "spawned"` only — the grace only the supervisor's resolve sees. */
  supervisorGraceMs?: number;
  /** In-process only — the agent never settles, so the child never exits. */
  wedged?: boolean;
  killGraceMs?: number;
}): Promise<{
  /**
   * The pid the arm's park reported: the tick child under the in-process
   * agent, the agent process itself under `agent: "spawned"`.
   */
  parkedPid: number;
  supervisorPid: number;
  grandchildPid: number | undefined;
  loopPidPath: string;
  claimPath: string;
  exited: Promise<void>;
  out: () => string;
  cleanup: () => Promise<void>;
}> {
  const repo = await makeJobRepo("main");
  const scratch = await mkTempDir("flume-signalled-loop-");
  let parkedPid: number | undefined;
  let grandchildPid: number | undefined;
  let loop: ReturnType<typeof spawn> | undefined;
  const cleanup = async (): Promise<void> => {
    killIfAlive(grandchildPid);
    killIfAlive(parkedPid);
    killIfAlive(loop?.pid);
    await rm(scratch, { recursive: true, force: true });
    await repo.cleanup();
  };
  // Recorded lazily as each pid is learned, so the hook can finish a teardown
  // this function never reached.
  const record = <T extends number | undefined>(pid: T): T => {
    signalledPids.push(pid);
    return pid;
  };
  try {
    const parkedPidPath = join(scratch, "parked.pid");
    const grandchildPidPath = join(scratch, "grandchild.pid");
    const shared = {
      ...(opts.grandchild === true ? { grandchildPidPath } : {}),
      ...(opts.killGraceMs !== undefined
        ? { killGraceMs: opts.killGraceMs }
        : {}),
    };
    await writeRepoConfig(
      repo.dir,
      opts.agent === "spawned"
        ? bareTickAgentChainSrc(parkedPidPath, {
            ...shared,
            ...(opts.ignoreSigterm === true ? { ignoreSigterm: true } : {}),
            ...(opts.supervisorGraceMs !== undefined
              ? { supervisorGraceMs: opts.supervisorGraceMs }
              : {}),
          })
        : tickChildPidChainSrc(parkedPidPath, {
            ...shared,
            ...(opts.wedged === true ? { wedged: true } : {}),
          }),
    );
    new Baton(join(repo.dir, ".flume")).wake("probe");

    loop = spawn(process.execPath, [TSX_CLI, CLI, "loop", "--max", "1"], {
      cwd: repo.dir,
      env: hermeticEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    record(loop.pid);
    loop.stdout?.on("data", (d: Buffer) => (out += d));
    loop.stderr?.on("data", (d: Buffer) => (out += d));

    // The event every arm turns on: a tick parked mid-agent, past the
    // supervisor's lock and claim and past the child's signal handlers. The
    // park writes this last, so it also reports the grandchild and the
    // SIGTERM handler above it as already in place.
    parkedPid = record(
      Number(
        await waitFor(
          `the loop's parked process to record its pid at ${parkedPidPath}`,
          () => fileWithContent(parkedPidPath),
        ),
      ),
    );
    if (opts.grandchild === true) {
      grandchildPid = record(Number(readFileSync(grandchildPidPath, "utf8")));
    }
    const loopPidPath = join(repo.dir, ".flume", "loop.pid");
    // Recorded as well as the spawned handle's: tsx re-execs itself, so the
    // process that took the locks is not the one this suite spawned, and a
    // teardown that only knows the handle leaves the supervisor standing.
    const supervisorPid = record(
      Number(
        await waitFor(
          `the loop supervisor's pid at ${loopPidPath}`,
          () => fileWithContent(loopPidPath),
        ),
      ),
    );
    // Non-vacuity: the subject of every assertion below must be a live
    // *other* process at the moment the signal lands, or a case reading
    // "nothing of the tree is alive" — or "the wedged child is still there" —
    // is green over a tree that never ran.
    expect(parkedPid).not.toBe(supervisorPid);
    expect(processAlive(parkedPid)).toBe(true);

    const exited = new Promise<void>((resolveExit) => {
      loop?.on("exit", () => resolveExit());
    });
    process.kill(supervisorPid, "SIGTERM");

    return {
      parkedPid,
      supervisorPid,
      grandchildPid,
      loopPidPath,
      claimPath: tipClaimPath(await gitCommonDir(repo.dir), "refs/heads/main"),
      exited,
      out: () => out,
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/**
 * The release `loop.pid` and the tip claim promise is the whole tick *tree*'s.
 * The supervisor spawns one `flume tick` child per iteration, that child
 * spawns the agent, and every one of them writes under the same state root —
 * so a signalled loop that dropped both guards while any of them ran handed
 * the root to the next acquirer with a live writer still inside it, which is
 * the race the POSIX lane saw as an orphan's last write landing after
 * teardown. Signalling the direct child alone closes one rung of that: the
 * agent is reparented and writes on.
 *
 * The second half is the wait, and it belongs to the tick child alone. The
 * agent that child spawned leads a group of its own, which the supervisor's
 * signal never reaches; a grace bounding the supervisor's wait fires first
 * and kills the child moments before the child's own escalation would have
 * reached that agent, leaving it reparented and writing under the released
 * root. So the supervisor signals and waits unbounded, the one timer in the
 * tree is the child's, and a child wedged past its handler holds the run open
 * rather than releasing over a live writer.
 *
 * Fast lane despite the real subprocesses: the arms are event-based (the
 * park's own pid file, then `loop.pid`, then the supervisor's exit), so a
 * warm host pays a startup and nothing more. The one wall-clock wait is the
 * wedged arm's, which has no event to wait for — the run not ending is its
 * subject — and it is a small multiple of the declared grace.
 *
 * win32 maps SIGTERM to TerminateProcess, which runs no handler at all —
 * release-on-signal is a POSIX guarantee and the cross-platform one is
 * stale-reclaim (spec/loop.md). There is no teardown to reach the tree
 * there, so the property is POSIX's alone, and every arm declares that skip
 * rather than passing silently.
 */
describe("flume loop — a signalled run takes down its whole tick tree (spec/loop.md \"The loop lock and the tip claim\")", () => {
  afterEach(() => {
    for (const pid of signalledPids.splice(0)) killIfAlive(pid);
  });

  it.skipIf(process.platform === "win32")(
    "a signalled `flume loop` leaves no tick child alive against the state root whose claim it released",
    async () => {
      const run = await signalledLoopRun({});
      try {
        await run.exited;

        // The run ended through the signal path rather than by reaching
        // `--max` — which is what makes the absences below a teardown.
        expect(run.out()).toContain("signalled; stopping after");
        // The supervisor released both guards...
        expect(existsSync(run.loopPidPath)).toBe(false);
        expect(existsSync(run.claimPath)).toBe(false);
        // ...and took the writer they were held for with it. The tick child
        // was reaped before the release, so this is a settled fact, not a
        // race: no wait stands between the parent's exit and this read.
        expect(processAlive(run.parkedPid)).toBe(false);
      } finally {
        await run.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "a signalled `flume loop` leaves nothing the tick child spawned alive against the state root it released",
    async () => {
      const run = await signalledLoopRun({ grandchild: true });
      try {
        await run.exited;

        // Non-vacuity: the grandchild is a third process, neither the tick
        // child nor the supervisor — the one a kill aimed at the direct child
        // never reaches.
        expect(run.grandchildPid).toBeDefined();
        expect(run.grandchildPid).not.toBe(run.parkedPid);

        expect(existsSync(run.loopPidPath)).toBe(false);
        expect(existsSync(run.claimPath)).toBe(false);
        expect(processAlive(run.parkedPid)).toBe(false);
        // The group signal reaches every member at once, but they exit
        // independently — the tick child's own exit orders nothing about what
        // it spawned — so this one death is awaited rather than read off the
        // supervisor's exit instant. Without the group it never comes: the
        // agent is reparented to init and parks out the budget.
        await waitFor(
          `the agent the tick child spawned (pid ${run.grandchildPid}) to go with the tree`,
          () => (processAlive(run.grandchildPid!) ? undefined : "gone"),
        );
      } finally {
        await run.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "an agent that swallows SIGTERM for the whole grace is dead when a signalled loop's run ends",
    async () => {
      // Non-vacuity for the split below: the supervisor's grace must be far
      // enough under the tick's that a run bounded by it could not be mistaken
      // for one that waited the tick out.
      expect(DECLARED_GRACE_MS * 4).toBeLessThan(TICK_GRACE_MS);

      const run = await signalledLoopRun({
        agent: "spawned",
        ignoreSigterm: true,
        killGraceMs: TICK_GRACE_MS,
        supervisorGraceMs: DECLARED_GRACE_MS,
      });
      try {
        await run.exited;

        // The run ended through the signal path, and both guards are down.
        expect(run.out()).toContain("signalled; stopping after");
        expect(existsSync(run.loopPidPath)).toBe(false);
        expect(existsSync(run.claimPath)).toBe(false);

        // The agent leads a process group of its own, so the supervisor's
        // signal never reached it and only the tick child's escalation — at
        // the grace the *tick* resolved — could end it. A supervisor holding a
        // grace of its own escalates first, against the group it *can* reach:
        // the child dies at that instant, its own escalation never fires, and
        // this process is reparented and writing under the root whose guards
        // just dropped.
        expect(processAlive(run.parkedPid)).toBe(false);
      } finally {
        await run.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "a signalled loop still holds its lock and tip claim past the declared grace while its wedged tick child lives",
    async () => {
      // Non-vacuity for the wait below: it must leave room for a supervisor
      // that bounded its own wait by the declared grace to escalate, release
      // and exit several times over inside it.
      expect(WEDGED_HOLD_MS).toBeGreaterThan(DECLARED_GRACE_MS * 4);

      const run = await signalledLoopRun({
        wedged: true,
        killGraceMs: DECLARED_GRACE_MS,
      });
      try {
        await delay(WEDGED_HOLD_MS);

        // This chain's agent never settles on the tick's abort, so the child
        // cannot finish its own release — and the supervisor holds rather
        // than dropping the guards over a live writer. The operator kills the
        // child, and the next acquirer's liveness probe reclaims the claim;
        // that is the cost the section names, in place of a timer that would
        // orphan the tree instead.
        expect(processAlive(run.parkedPid)).toBe(true);
        expect(processAlive(run.supervisorPid)).toBe(true);
        expect(existsSync(run.loopPidPath)).toBe(true);
        expect(existsSync(run.claimPath)).toBe(true);
      } finally {
        await run.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "a signalled loop logs the wait it is entering before its tick tree is down, naming the grace",
    async () => {
      // Non-vacuity for the number below: a supervisor naming the engine's
      // own default would satisfy a `toContain` over any grace that happened
      // to equal it, so the declared one must differ from it.
      expect(DECLARED_GRACE_MS).not.toBe(DEFAULT_KILL_GRACE_MS);

      // Wedged, so the child never exits and the run never ends: everything
      // read below is read while the tree the line is about is still up,
      // which is what makes this "before" rather than "afterwards".
      const run = await signalledLoopRun({
        wedged: true,
        killGraceMs: DECLARED_GRACE_MS,
      });
      try {
        const line = await waitFor(
          "the supervisor to announce the wait it is entering",
          () =>
            run
              .out()
              .split("\n")
              .find((l) => l.includes("signalled; waiting for")),
        );

        // The child and the supervisor are both still there — the line is
        // the operator's account of a wait in progress, not a summary of one
        // that ended. (`signalled; stopping after` is printed only once the
        // child has been reaped, which here never happens.)
        expect(processAlive(run.parkedPid)).toBe(true);
        expect(processAlive(run.supervisorPid)).toBe(true);
        // The bound the wait ends under, named rather than left to a lookup:
        // the grace this chain declares and the knob that declares it.
        expect(line).toContain(`${DECLARED_GRACE_MS}ms`);
        expect(line).toContain("supervisorPolicy.killGraceMs");
      } finally {
        await run.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});

/**
 * A chain whose agent is the shipped `claudeCode` provider (`src/Agent.ts`)
 * pointed at a node one-liner instead of the real binary — so the bare tick
 * below drives the engine's own spawn and teardown rather than a fixture's
 * imitation of them (`.claude/rules/engineering.md`, *A seam gate reads what
 * the real writer wrote*). The flags that would otherwise ride the argv are
 * declared off, leaving `-p <script>`, which is `node -p`.
 *
 * The script is the agent: it reports the pid of the process `claude` would
 * have been, and parks. Its arms mirror the loop driver's above:
 *
 * - `grandchildPidPath` — the agent spawns a parked process of its own, the
 *   one a kill aimed at the agent process alone never reaches (the shape the
 *   tools and MCP servers a real `claude` spawns take).
 * - `ignoreSigterm` — the agent installs a SIGTERM handler that does nothing,
 *   so only an escalation can end it. Installed before the pid is reported,
 *   which makes that report the readiness event.
 * - `killGraceMs` — declared on `supervisorPolicy`, the grace the tick is to
 *   bound its wait by.
 * - `supervisorGraceMs` — a *second* grace, declared only where a `flume
 *   loop` supervisor resolves this chain: its own process, which the tick
 *   child's `FLUME_TIP_CLAIM_HELD` marks apart (spec/loop.md, "The loop lock
 *   and the tip claim"). The knob is per-tick, so a live chain declares one
 *   number and both processes would read it — which leaves "whose grace ended
 *   the tree" unobservable, the two timers being the same number a few
 *   milliseconds apart. Splitting them is what makes the answer readable: a
 *   supervisor bounding its own wait by this one kills its child long before
 *   the tick's escalation could reach the agent.
 *
 * The park outlasts `SPAWN_BUDGET_MS` deliberately, for the same reason the
 * loop driver's does: a tree that is never taken down must red its case on
 * the budget rather than outliving the wait and passing as a teardown.
 */
function bareTickAgentChainSrc(
  agentPidPath: string,
  opts: {
    grandchildPidPath?: string;
    ignoreSigterm?: boolean;
    killGraceMs?: number;
    supervisorGraceMs?: number;
  } = {},
): string {
  const PARKED_GRANDCHILD = "setInterval(() => {}, 1000);";
  const script =
    `const fs = require("node:fs");\n` +
    (opts.ignoreSigterm === true ? `process.on("SIGTERM", () => {});\n` : ``) +
    (opts.grandchildPidPath !== undefined
      ? `const kid = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(PARKED_GRANDCHILD)}], { stdio: "ignore" });\n` +
        `fs.writeFileSync(${JSON.stringify(opts.grandchildPidPath)}, String(kid.pid));\n`
      : ``) +
    `fs.writeFileSync(${JSON.stringify(agentPidPath)}, String(process.pid));\n` +
    `setInterval(() => {}, 600000);\n`;
  return (
    `import { claudeCode } from ${JSON.stringify(AGENT_SRC_PATH)};\n` +
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: "probe",\n` +
    `    description: "signalled-bare-tick probe",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    (opts.killGraceMs !== undefined
      ? `  supervisorPolicy: { killGraceMs: ` +
        (opts.supervisorGraceMs !== undefined
          ? // Load time, per resolving process: the tick child is the one the
            // runner told the claim is held, so the other reader is the
            // supervisor.
            `process.env.FLUME_TIP_CLAIM_HELD ? ${opts.killGraceMs} : ${opts.supervisorGraceMs}`
          : `${opts.killGraceMs}`) +
        ` },\n`
      : ``) +
    `},\n` +
    `agent: claudeCode({\n` +
    `  binary: process.execPath,\n` +
    `  dangerouslySkipPermissions: false,\n` +
    `  inheritUserMcp: true,\n` +
    `  extraArgs: [${JSON.stringify(script)}],\n` +
    `}) });\n`
  );
}

/**
 * Drive a real bare `flume tick` to an agent parked mid-invocation and SIGTERM
 * the tick — the shape every arm below shares. Returns the pids it observed,
 * the output collected so far, the exit as a promise carrying how long the
 * teardown took, and the cleanup its caller owns.
 *
 * The exit is handed over rather than awaited here, as the loop driver above
 * hands its own over: an arm whose subject is what the tick *says* while its
 * agent is still up has no exit to wait for — a tick holding its declared
 * grace over an agent that swallows the SIGTERM is exactly the wait that arm
 * reads.
 *
 * The signal targets the pid recorded in the tip claim rather than the
 * spawned process's own: tsx re-execs itself into a second node process, so
 * the spawned handle is the bootstrapper's, and the process that took the
 * claim — and installed the handlers — is the one an operator's SIGTERM finds
 * in production. That file is also the readiness event for the claim half:
 * its content proves the claim is held at the moment the signal lands, which
 * is what makes its absence afterwards a release.
 */
async function signalledBareTickRun(opts: {
  grandchild?: boolean;
  ignoreSigterm?: boolean;
  killGraceMs?: number;
}): Promise<{
  agentPid: number;
  grandchildPid: number | undefined;
  claimPath: string;
  exited: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    teardownMs: number;
  }>;
  out: () => string;
  cleanup: () => Promise<void>;
}> {
  const repo = await makeJobRepo("main");
  const scratch = await mkTempDir("flume-signalled-tick-");
  let agentPid: number | undefined;
  let grandchildPid: number | undefined;
  let tick: ReturnType<typeof spawn> | undefined;
  const cleanup = async (): Promise<void> => {
    killIfAlive(grandchildPid);
    killIfAlive(agentPid);
    killIfAlive(tick?.pid);
    await rm(scratch, { recursive: true, force: true });
    await repo.cleanup();
  };
  // Recorded lazily as each pid is learned, so the hook can finish a teardown
  // this function never reached.
  const record = <T extends number | undefined>(pid: T): T => {
    signalledPids.push(pid);
    return pid;
  };
  try {
    const agentPidPath = join(scratch, "agent.pid");
    const grandchildPidPath = join(scratch, "grandchild.pid");
    await writeRepoConfig(
      repo.dir,
      bareTickAgentChainSrc(agentPidPath, {
        ...(opts.grandchild === true ? { grandchildPidPath } : {}),
        ...(opts.ignoreSigterm === true ? { ignoreSigterm: true } : {}),
        ...(opts.killGraceMs !== undefined
          ? { killGraceMs: opts.killGraceMs }
          : {}),
      }),
    );
    new Baton(join(repo.dir, ".flume")).wake("probe");

    tick = spawn(process.execPath, [TSX_CLI, CLI, "tick"], {
      cwd: repo.dir,
      env: hermeticEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    record(tick.pid);
    tick.stdout?.on("data", (d: Buffer) => (out += d));
    tick.stderr?.on("data", (d: Buffer) => (out += d));

    const claimPath = tipClaimPath(
      await gitCommonDir(repo.dir),
      "refs/heads/main",
    );
    const tickPid = record(
      Number(
        await waitFor(
          `the bare tick to record its pid in the tip claim at ${claimPath}`,
          () => fileWithContent(claimPath),
        ),
      ),
    );
    // The event every arm turns on: an agent parked mid-invocation, past the
    // tick's claim and past its signal handlers. The script writes this last,
    // so it also reports the grandchild and the SIGTERM handler above it as
    // already in place.
    agentPid = record(
      Number(
        await waitFor(
          `the tick's agent to record its pid at ${agentPidPath}`,
          () => fileWithContent(agentPidPath),
        ),
      ),
    );
    if (opts.grandchild === true) {
      grandchildPid = record(Number(readFileSync(grandchildPidPath, "utf8")));
    }
    // Non-vacuity: the subject of every teardown assertion below must be a
    // live *other* process at the moment the signal lands, or "nothing of the
    // tree is alive" is green over a tree that never ran.
    expect(agentPid).not.toBe(tickPid);
    expect(processAlive(agentPid)).toBe(true);

    let signalledAt = 0;
    const exited = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      teardownMs: number;
    }>((resolveExit) => {
      tick?.on("exit", (code, signal) =>
        resolveExit({ code, signal, teardownMs: Date.now() - signalledAt }),
      );
    });
    signalledAt = Date.now();
    process.kill(tickPid, "SIGTERM");

    return {
      agentPid,
      grandchildPid,
      claimPath,
      exited,
      out: () => out,
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/**
 * The bare tick's half of the guarantee the loop arms above pin: a tick that
 * takes the claim itself starts an agent, that agent spawns tools of its own,
 * and all of them write under the state root the claim protects — so a
 * handler that drops the claim and exits leaves the next acquirer a root with
 * a live writer inside it. `flume loop`'s supervisor takes a tick tree down
 * by signalling its group and waiting for it; a bare tick owes its agent tree
 * the same (spec/loop.md, "The loop lock and the tip claim").
 *
 * win32 has no process group to signal and maps SIGTERM to TerminateProcess,
 * which runs no handler at all — release-on-signal is a POSIX guarantee and
 * the cross-platform one is stale-reclaim, as the loop arms above declare.
 * Every arm here states that skip rather than passing silently.
 */
describe("flume tick — a signalled bare tick takes its agent down (spec/loop.md \"The loop lock and the tip claim\")", () => {
  afterEach(() => {
    for (const pid of signalledPids.splice(0)) killIfAlive(pid);
  });

  it.skipIf(process.platform === "win32")(
    "a signalled bare `flume tick` leaves nothing its agent spawned alive when the tip claim drops",
    async () => {
      const run = await signalledBareTickRun({ grandchild: true });
      try {
        await run.exited;

        // Non-vacuity: the grandchild is a third process, neither the tick
        // nor the agent — the one a kill aimed at the agent process never
        // reaches.
        expect(run.grandchildPid).toBeDefined();
        expect(run.grandchildPid).not.toBe(run.agentPid);

        // The claim is released...
        expect(existsSync(run.claimPath)).toBe(false);
        // ...and the agent it was held for is already gone when it is: the
        // invocation settles on that process's exit, so this is a settled
        // fact read after the tick's own exit, not a race.
        expect(processAlive(run.agentPid)).toBe(false);
        // The group signal reaches every member at once, but they exit
        // independently — the agent's own exit orders nothing about what it
        // spawned — so this one death is awaited rather than read off the
        // tick's exit instant. Without the group it never comes: the
        // grandchild is reparented to init and parks out the budget.
        await waitFor(
          `the process the agent spawned (pid ${run.grandchildPid}) to go with the tree`,
          () => (processAlive(run.grandchildPid!) ? undefined : "gone"),
        );
      } finally {
        await run.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "a bare tick whose agent ignores SIGTERM kills it after the declared grace rather than exiting over a live writer",
    async () => {
      // Non-vacuity, and what makes the ceiling below discriminate: the
      // declared grace must be far enough under the engine's that a teardown
      // bounded by the default cannot land inside it.
      expect(DECLARED_GRACE_MS * 10).toBeLessThan(DEFAULT_KILL_GRACE_MS);

      const run = await signalledBareTickRun({
        ignoreSigterm: true,
        killGraceMs: DECLARED_GRACE_MS,
      });
      try {
        const { teardownMs } = await run.exited;

        // The agent swallowed the SIGTERM and would have parked past this
        // case's whole budget, so reaching here at all is the escalation.
        expect(processAlive(run.agentPid)).toBe(false);
        expect(existsSync(run.claimPath)).toBe(false);
        // A ceiling, not a cost. The agent ignores SIGTERM, so the only thing
        // that can end it is the escalation, and the only question is which
        // grace timed it: under the engine default this teardown could not
        // have finished before `DEFAULT_KILL_GRACE_MS`, and half of that
        // still leaves the declared grace an order of magnitude of slack on a
        // loaded host.
        expect(teardownMs).toBeLessThan(DEFAULT_KILL_GRACE_MS / 2);
      } finally {
        await run.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "a signalled bare `flume tick` exits 143",
    async () => {
      const run = await signalledBareTickRun({});
      try {
        // 128 + SIGTERM, the handler's own exit — not a death by the signal
        // itself, which would leave the claim standing and report `signal`
        // here instead.
        const { code, signal } = await run.exited;
        expect({ code, signal }).toEqual({ code: 143, signal: null });
      } finally {
        await run.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "a signalled bare tick logs the wait it is entering before its agent tree is down, naming the grace",
    async () => {
      // Non-vacuity for the number below: a tick naming the engine's own
      // default would satisfy a `toContain` over any grace that happened to
      // equal it, so the declared one must differ from it.
      expect(ANNOUNCED_GRACE_MS).not.toBe(DEFAULT_KILL_GRACE_MS);

      // The agent swallows the SIGTERM and the declared grace outlasts this
      // whole case, so the escalation cannot land while the line is read:
      // everything below is read with the tree the line is about still up,
      // which is what makes this "before" rather than "afterwards".
      const run = await signalledBareTickRun({
        ignoreSigterm: true,
        killGraceMs: ANNOUNCED_GRACE_MS,
      });
      try {
        const line = await waitFor(
          "the tick to announce the wait it is entering",
          () =>
            run
              .out()
              .split("\n")
              .find((l) => l.includes("signalled; waiting for")),
        );

        // The agent is still there, and so is the claim the tick releases
        // only once that agent is gone — the line is the operator's account
        // of a wait in progress, not a summary of one that ended.
        expect(processAlive(run.agentPid)).toBe(true);
        expect(existsSync(run.claimPath)).toBe(true);
        // The bound the wait ends under, named rather than left to a lookup:
        // the grace this chain declares and the knob that declares it.
        expect(line).toContain(`${ANNOUNCED_GRACE_MS}ms`);
        expect(line).toContain("supervisorPolicy.killGraceMs");
      } finally {
        await run.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});

describe("flume loop — stop flag refuses at start (spec/loop.md \"Graceful stop — the stop flag\")", () => {
  it(
    "refuses before any tick, exit 1, naming the flag path — no lock taken, no tick runs",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const flumeDir = join(repo.dir, ".flume");
        const stopPath = join(flumeDir, "stop");
        await mkdir(flumeDir, { recursive: true });
        await writeFile(stopPath, "", "utf8");

        const r = await runCli(repo.dir, ["loop", "--max", "3"]);

        expect(r.code).toBe(1);
        expect(r.out).toContain(stopPath);
        expect(r.out).toContain("refuses");
        expect(r.out).not.toContain("reached --max");
        // The refusal fires before the loop lock is ever taken.
        expect(existsSync(join(flumeDir, "loop.pid"))).toBe(false);
        // The flag itself survives untouched — no unstop verb.
        expect(existsSync(stopPath)).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it("`flume loop` refuses naming the error when the stop flag is present but unstattable, instead of starting a run over it", async () => {
    const repo = await makeJobRepo("main");
    try {
      const flumeDir = join(repo.dir, ".flume");
      const stopPath = join(flumeDir, "stop");
      await mkdir(flumeDir, { recursive: true });
      // ELOOP, the non-ENOENT stat failure `existsSync` reads as absent —
      // which starts a run over an unacknowledged stop, the one outcome this
      // guard exists to rule out (spec/loop.md "Graceful stop — the stop
      // flag").
      await symlink("stop", stopPath);

      const r = await runCli(repo.dir, ["loop", "--max", "3"]);

      expect(r.code).toBe(EX_IOERR);
      expect(r.out).toContain("loop refuses");
      expect(r.out).toContain(stopPath);
      expect(r.out).toContain("failed to stat");
      // No run started: the refusal fires before the loop lock is taken,
      // and no tick ever ran.
      expect(existsSync(join(flumeDir, "loop.pid"))).toBe(false);
      expect(r.out).not.toContain("reached --max");
      expect(r.out).not.toMatch(/tick \u2192/);
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it(
    "flume tick ignores the flag and runs normally",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalStubbedAgentChainSrc());
        const flumeDir = join(repo.dir, ".flume");
        await writeFile(join(flumeDir, "stop"), "", "utf8");
        new Baton(flumeDir).wake("probe");

        const r = await runCli(repo.dir, ["tick"]);

        expect(r.code).toBe(0);
        expect(r.out).toMatch(/tick → probe/);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "job run refuses at start too, sharing the same `loop` rewrite",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const jobFlumeDir = join(repo.dir, ".flume", "jobs", "probejob");
        await mkdir(jobFlumeDir, { recursive: true });
        const stopPath = join(jobFlumeDir, "stop");
        await writeFile(stopPath, "", "utf8");

        const r = await runCli(repo.dir, [
          "job",
          "run",
          "probejob",
          "--max",
          "3",
        ]);

        expect(r.code).toBe(1);
        expect(r.out).toContain(stopPath);
        expect(r.out).not.toContain("reached --max");
        expect(existsSync(join(jobFlumeDir, "loop.pid"))).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});

// spec/loop.md "Crash equals stop", "A merge the crash interrupted is refused,
// never resumed". The marker's writer is the dispatcher's merge stage
// (tests/Dispatcher.test.ts, "the merge-stage crash marker"); these hold the
// reader — the startup refusal, which must fire under the tip claim and ahead
// of the startup sweep, so the branch the marker names survives for the
// operator to recover from.
describe("flume loop — an interrupted merge refuses at start (spec/loop.md \"Crash equals stop\")", () => {
  /**
   * A state root left as a crash between the pick and the ship bookkeeping
   * leaves it: the marker, plus the abandoned wave's `flume/**` branch — the
   * residue the startup sweep deletes, which is what makes its survival below
   * evidence the sweep never ran.
   */
  async function seedInterruptedMerge(
    repoDir: string,
    stateRoot: string,
  ): Promise<{ markerPath: string; baseSha: string }> {
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
    });
    const baseSha = stdout.trim();
    await exec("git", ["branch", "flume/interrupted", baseSha], {
      cwd: repoDir,
    });
    const markerPath = join(stateRoot, "merging", "interrupted.json");
    await mkdir(join(stateRoot, "merging"), { recursive: true });
    await writeFile(
      markerPath,
      JSON.stringify({
        tag: "INTERRUPTED-ENTRY",
        branch: "flume/interrupted",
        baseSha,
      }),
      "utf8",
    );
    return { markerPath, baseSha };
  }

  const branchExists = async (repoDir: string): Promise<boolean> => {
    const { stdout } = await exec(
      "git",
      ["branch", "--list", "flume/interrupted"],
      { cwd: repoDir },
    );
    return stdout.trim() !== "";
  };

  it(
    "a surviving merging marker refuses the next loop start with EX_CONFIG",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalStubbedAgentChainSrc());
        const flumeDir = join(repo.dir, ".flume");
        // Awake, so absent the refusal this run would tick — "touches
        // nothing" is only a claim about a run that otherwise had work.
        new Baton(flumeDir).wake("probe");
        const { markerPath, baseSha } = await seedInterruptedMerge(
          repo.dir,
          flumeDir,
        );

        const r = await runCli(repo.dir, ["loop", "--max", "3"]);

        expect(r.code).toBe(EX_TERMINAL_MISCONFIG);
        // The refusal names the file, the branch and the entry.
        expect(r.out).toContain(markerPath);
        expect(r.out).toContain("flume/interrupted");
        expect(r.out).toContain("INTERRUPTED-ENTRY");
        expect(r.out).toContain(baseSha);
        // No tick ran, and the baton is where the operator left it.
        expect(r.out).not.toMatch(/tick → probe/);
        expect(existsSync(join(flumeDir, "awake", "probe"))).toBe(true);
        // Removal is the operator's acknowledgement — no engine verb performs
        // it, exactly as with the stop flag.
        expect(existsSync(markerPath)).toBe(true);
        // The check precedes the startup sweep, so the abandoned branch the
        // marker names is still there to recover the span from.
        expect(await branchExists(repo.dir)).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "job run refuses at start too, sharing the same `loop` rewrite",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalStubbedAgentChainSrc());
        const jobFlumeDir = join(repo.dir, ".flume", "jobs", "probejob");
        await mkdir(jobFlumeDir, { recursive: true });
        const { markerPath } = await seedInterruptedMerge(
          repo.dir,
          jobFlumeDir,
        );

        const r = await runCli(repo.dir, [
          "job",
          "run",
          "probejob",
          "--max",
          "3",
        ]);

        expect(r.code).toBe(EX_TERMINAL_MISCONFIG);
        expect(r.out).toContain(markerPath);
        expect(r.out).toContain("INTERRUPTED-ENTRY");
        expect(existsSync(markerPath)).toBe(true);
        expect(await branchExists(repo.dir)).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "a marker too corrupt to parse still refuses, naming the file",
    async () => {
      // .claude/rules/engineering.md "Loud or nothing": the presence of the
      // file is the fact. Degrading an unreadable marker to "no interrupted
      // merge" would proceed over exactly the state this refusal exists to
      // stop.
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalStubbedAgentChainSrc());
        const flumeDir = join(repo.dir, ".flume");
        new Baton(flumeDir).wake("probe");
        const markerPath = join(flumeDir, "merging", "truncated.json");
        await mkdir(join(flumeDir, "merging"), { recursive: true });
        await writeFile(markerPath, '{"tag":"HALF-WRI', "utf8");

        const r = await runCli(repo.dir, ["loop", "--max", "3"]);

        expect(r.code).toBe(EX_TERMINAL_MISCONFIG);
        expect(r.out).toContain(markerPath);
        expect(r.out).not.toMatch(/tick → probe/);
        expect(existsSync(markerPath)).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "`flume loop` exits EX_IOERR naming the merging dir when its listing fails for a reason other than absence",
    async () => {
      // The listing's ENOENT-vs-other split is held at the reader
      // (tests/Dispatcher.test.ts, "the merging dir's ENOENT/EACCES split");
      // this holds what the operator sees when the non-ENOENT leg fires at a
      // loop start. An unclassifiable exit 1 and a raw stack is the one
      // outcome ruled out (`.claude/rules/platform-facts.md`, "Exit codes
      // come from `sysexits.h`").
      const repo = await makeJobRepo("main");
      const mergingPath = join(repo.dir, ".flume", "merging");
      try {
        await writeRepoConfig(repo.dir, minimalStubbedAgentChainSrc());
        const flumeDir = join(repo.dir, ".flume");
        new Baton(flumeDir).wake("probe");
        const { markerPath } = await seedInterruptedMerge(repo.dir, flumeDir);

        // Vacuity: unsealed, this very dir is the one the startup refusal
        // reads — it refuses on the marker it found. So the EX_IOERR below is
        // the seal talking, not a path the CLI never looked at.
        const readable = await runCli(repo.dir, ["loop", "--max", "3"]);
        expect(readable.code).toBe(EX_TERMINAL_MISCONFIG);
        expect(readable.out).toContain(markerPath);

        // Deny the merging dir structurally (`tests/helpers/denial.ts`): the
        // path is there but is not a dir the listing can read, so the read
        // refuses rather than reporting ENOENT — on win32 and under a
        // root-run as well as here.
        denyDirectory(mergingPath);

        const r = await runCli(repo.dir, ["loop", "--max", "3"]);

        expect(r.code).toBe(EX_IOERR);
        expect(r.out).toContain(mergingPath);
        // No tick ran, the baton is where the operator left it, and the
        // abandoned branch the unseen marker names still stands.
        expect(r.out).not.toMatch(/tick → probe/);
        expect(existsSync(join(flumeDir, "awake", "probe"))).toBe(true);
        expect(await branchExists(repo.dir)).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});

// ---------- flume check (spec/cli.md §Subcommand surface, cli-check-verb)
// ----------

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
  pendingPath?: string,
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
    (pendingPath !== undefined
      ? `  pendingPath: ${JSON.stringify(pendingPath)},\n`
      : ``) +
    `} });\n`
  );
}

/**
 * A chain with **no** fanout phase — one singleton "plan" and nothing that
 * picks from `pending`. There is no consumer, so there is no fence for
 * `flume check` to measure declared paths against; the entries below still
 * declare files, which is what makes the vacuous-pass distinguishable from
 * an empty fence refusing all of them.
 */
function noFanoutCheckChainSrc(): string {
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
    `  ],\n` +
    `  humanOnly: [],\n` +
    `} });\n`
  );
}

async function writeCheckPending(
  root: string,
  entries: unknown[],
  rel: string = DEFAULT_PENDING_REL,
): Promise<void> {
  const path = join(root, ".flume", rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(entries, null, 2) + "\n", "utf8");
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
      expect(r.code).toBe(EX_DATAERR);
      expect(r.out).toContain("schema violation");
      expect(r.out).toContain("[0]");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

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
      expect(r.code).toBe(EX_DATAERR);
      expect(r.out).toContain("outside the consumer phase's fence");
      expect(r.out).toContain("OUT-OF-FENCE");
      expect(r.out).toContain("docs/readme.md");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

  it("honors a chain-declared pendingPath (CHAIN-PENDINGPATH) — reads and reports the custom location, not plan/pending.json", async () => {
    const repo = await makeJobRepo("main");
    try {
      const customRel = join("custom", "queue.json");
      await writeRepoConfig(
        repo.dir,
        fanoutCheckChainSrc(["src/**"], [], customRel),
      );
      await writeCheckPending(
        repo.dir,
        [
          {
            tag: "CUSTOM",
            gate: { kind: "open" },
            dependsOnForks: [],
            files: {
              new: [],
              edit: [{ path: "src/a.ts", description: "inside fence" }],
              retire: [],
            },
          },
        ],
        customRel,
      );

      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`${customRel} valid (1 entries)`);
      // The default location was never written or read. Resolved through
      // the accessor that owns it: a stale literal here would assert the
      // absence of a file nothing ever writes, and stay green for free.
      expect(existsSync(resolvePendingPath(join(repo.dir, ".flume")))).toBe(
        false,
      );
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("exits 0 when plan/pending.json is absent — nothing to check", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, fanoutCheckChainSrc(["src/**"]));

      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(0);
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("exits EX_IOERR naming the error on a non-ENOENT pending.json read failure, instead of reading it as absent", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, fanoutCheckChainSrc(["src/**"]));
      // A directory in place of pending.json reproduces a non-ENOENT read
      // failure (EISDIR) without relying on permission bits a root-run test
      // could bypass (`.claude/rules/engineering.md`, "Loud or nothing").
      await mkdir(resolvePendingPath(join(repo.dir, ".flume")), {
        recursive: true,
      });

      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(EX_IOERR);
      expect(r.out).not.toContain("absent");
      expect(r.out).toContain("failed to read");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

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
      const pendingPath = resolvePendingPath(join(repo.dir, ".flume"));
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
  }, SPAWN_BUDGET_MS);

  it("exits mount-dead (69) when no chain resolves to check the consumer fence against", async () => {
    const repo = await makeJobRepo("main"); // no .flume/chain.ts written
    try {
      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(EX_MOUNT_DEAD);
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  /**
   * Vacuous-by-design, spelled in its own test
   * (`.claude/rules/engineering.md`, "A green verdict is proven
   * non-vacuous"): the pass below is green over an unmeasured fence, so the
   * entries deliberately declare paths that no fence could admit. Before the
   * fix, `entryWriteScopeUnion` over zero consumer phases yielded an empty
   * fence and every one of those paths read as a violation.
   */
  it("flume check exits 0 for a chain with no fanout phase whose entries declare files", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, noFanoutCheckChainSrc());
      await writeCheckPending(repo.dir, [
        {
          tag: "DECLARES-FILES",
          gate: { kind: "open" },
          dependsOnForks: [],
          files: {
            new: [{ path: "src/new.ts", description: "declared, unfenced" }],
            edit: [{ path: "docs/readme.md", description: "declared, unfenced" }],
            retire: [],
          },
        },
      ]);

      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(0);
      // The parse still ran and reported its count — the skip is the fence
      // step alone, not the whole verb.
      expect(r.out).toContain("valid (1 entries)");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("flume check names the absent fanout consumer rather than the declared paths", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, noFanoutCheckChainSrc());
      await writeCheckPending(repo.dir, [
        {
          tag: "DECLARES-FILES",
          gate: { kind: "open" },
          dependsOnForks: [],
          files: {
            new: [],
            edit: [{ path: "docs/readme.md", description: "declared, unfenced" }],
            retire: [],
          },
        },
      ]);

      const r = await runCli(repo.dir, ["check"]);
      expect(r.out).toContain("no fanout phase declared; fence not checked");
      expect(r.out).not.toContain("outside the consumer phase's fence");
      expect(r.out).not.toContain("docs/readme.md");
      expect(r.out).not.toContain("DECLARES-FILES");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("--help short-circuits before any chain load or side effect", async () => {
    const repo = await makeJobRepo("main");
    try {
      const r = await runCli(repo.dir, ["check", "--help"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Usage: flume check");
      // The fixture's bay is planted empty (`mkFixtureRoot`), so "created
      // nothing" reads as "wrote nothing into it" — a stricter claim than
      // the bay's absence, which only ever proved `Baton` never ran.
      expect(readdirSync(join(repo.dir, ".flume"))).toEqual([]);
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * Agreement gate (`.claude/rules/engineering.md`, "A seam gate reads what
 * the real writer wrote"): the claim is that the two consumer-phase fence
 * pre-checks agree, so both real consumers run — the real `flume check`
 * subprocess and the real `pendingGate` — over one committed queue, with the
 * fence taken from one chain declaration loaded the way the CLI loads it.
 * Neither side's answer is re-authored here; the test only compares what
 * each printed.
 */
describe("consumer-phase fence pre-check — `flume check` against `pendingGate` (QUEUE-FENCE-PRECHECK-ONE-DERIVATION)", () => {
  /** The `  [TAG] a, b` rows both consumers render, keyed by tag. */
  function offendingByTag(text: string): Record<string, string[]> {
    const rows: Record<string, string[]> = {};
    for (const line of text.split("\n")) {
      // Two leading spaces is the violation row; `[flume] check: ...` has
      // none, so the verb's own headline never reads as a row.
      const m = /^ {2}\[([^\]]+)\] (.+?)(?: \(outside targetFence[^)]*\))?$/.exec(
        line.trimEnd(),
      );
      if (m) rows[m[1]!] = m[2]!.split(", ");
    }
    return rows;
  }

  it("flume check and pendingGate name the same offending paths for one queue against one consumer phase", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(
        repo.dir,
        fanoutCheckChainSrc(["src/**", "tests/**"], ["notes/*.md"]),
      );
      await writeCheckPending(repo.dir, [
        {
          tag: "CLEAN",
          gate: { kind: "open" },
          dependsOnForks: [],
          files: {
            new: [],
            edit: [
              { path: "src/a.ts", description: "inside writablePaths" },
              { path: "notes/CLEAN.md", description: "inside the channel" },
            ],
            retire: [],
          },
        },
        {
          tag: "OUTSIDE-BOTH",
          gate: { kind: "open" },
          dependsOnForks: [],
          files: {
            new: [{ path: "docs/guide.md", description: "outside" }],
            edit: [{ path: "tests/a.test.ts", description: "inside" }],
            retire: ["spec/loop.md"],
          },
        },
        {
          tag: "DEEP-CHANNEL",
          gate: { kind: "open" },
          dependsOnForks: [],
          files: {
            new: [],
            // `notes/*.md` is segment-bound, so this one sits outside the
            // channel glob that admits CLEAN's note.
            edit: [{ path: "notes/sub/DEEP.md", description: "outside" }],
            retire: [],
          },
        },
      ]);
      // pendingGate judges the queue at the commit it is attached to, so the
      // queue both consumers read has to be on the tip, not just on disk.
      await exec("git", ["add", "-A", "-f"], { cwd: repo.dir });
      await exec("git", ["commit", "-q", "-m", "queue"], { cwd: repo.dir });
      const { stdout } = await exec("git", ["rev-parse", "HEAD"], {
        cwd: repo.dir,
      });
      const commitSha = stdout.trim();

      const cli = await runCli(repo.dir, ["check"]);

      // The fence the gate is handed is the same declaration `flume check`
      // just read: the chain's sole fanout phase, loaded through the
      // engine's own loader rather than restated as a literal here.
      const flumeDir = join(repo.dir, ".flume");
      const { chain } = await loadChainModule({
        repoRoot: repo.dir,
        configDir: flumeDir,
        flumeDir,
      });
      const consumer = chain.phases.find((p) => p.concurrency === "fanout");
      expect(consumer).toBeDefined();
      const queuePath = resolvePendingPath(flumeDir, chain.pendingPath);
      const gateResult = await pendingGate({ targetFence: consumer! }).run({
        cwd: repo.dir,
        flumeDir,
        stateRootRel: computeStateRootRel(repo.dir, flumeDir),
        pendingPath: queuePath,
        configDir: flumeDir,
        repoRoot: repo.dir,
        phaseName: "plan",
        commitSha,
        baseSha: `${commitSha}^`,
        touchedPaths: [relative(repo.dir, queuePath).split(/[\\/]/).join("/")],
        log: () => {},
      } satisfies GateContext);

      // Both refused, and both refused over a populated judged set — a queue
      // neither could fault would make the comparison below vacuous
      // (`.claude/rules/engineering.md`, "A green verdict is proven
      // non-vacuous").
      expect(cli.code).toBe(EX_DATAERR);
      expect(gateResult.ok).toBe(false);
      const fromCli = offendingByTag(cli.out);
      const fromGate = offendingByTag(gateResult.details ?? "");
      expect(Object.keys(fromCli).length).toBeGreaterThan(0);
      expect(fromGate).toEqual(fromCli);
      // And the shared answer is the real one: the clean entry is absent,
      // every path outside the union is named, and nothing inside it is.
      expect(fromCli).toEqual({
        "OUTSIDE-BOTH": ["docs/guide.md", "spec/loop.md"],
        "DEEP-CHANNEL": ["notes/sub/DEEP.md"],
      });
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * gh#1 — `flume tick plan` silently ticking whichever phase happened to be
 * awake, instead of the named one, is the field-reported shape of a broader
 * gap: the CLI surface never refused a trailing positional it does not
 * consume. spec/cli.md "Subcommand surface": `tick`, `stop`, and `check`
 * consume none; `wake`/`sleep` consume exactly one (`<phase>`); `status` is
 * the one named exception, specced to ignore extras and exit 0 always.
 */
describe("flume tick/stop/check refuse stray positionals; wake/sleep refuse extras past <phase> (gh#1)", () => {
  it(
    "flume tick <positional> exits 2 rather than silently ticking whichever phase is awake",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalStubbedAgentChainSrc());
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const r = await runCli(repo.dir, ["tick", "plan"]);

        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume tick");
        // Refused before any tick ran — the awake flag `probe` never got
        // ticked in "plan"'s name, and it wasn't silently ticked either.
        expect(
          existsSync(join(repo.dir, ".flume", "awake", "probe")),
        ).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume stop <positional> exits 2",
    async () => {
      const dir = await mkFixtureRoot("flume-stop-positional-");
      try {
        const r = await runCli(dir, ["stop", "extra"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume stop");
        expect(existsSync(join(dir, ".flume", "stop"))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume check <positional> exits 2",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const r = await runCli(repo.dir, ["check", "extra"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume check");
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume wake <phase> <extra> exits 2",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const r = await runCli(repo.dir, ["wake", "probe", "extra"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume wake");
        expect(
          existsSync(join(repo.dir, ".flume", "awake", "probe")),
        ).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume sleep <phase> <extra> exits 2",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const r = await runCli(repo.dir, ["sleep", "probe", "extra"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume sleep");
        // Refused before mutating — the awake flag survives untouched.
        expect(
          existsSync(join(repo.dir, ".flume", "awake", "probe")),
        ).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume status ignores extra positionals and still exits 0 (the one named exception)",
    async () => {
      const dir = await mkFixtureRoot("flume-status-positional-");
      try {
        const r = await runCli(dir, ["status", "extra", "more"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("hibernating");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );
});

describe("flume loop refuses a stray positional past --max/<value> (spec/cli.md §Subcommand surface)", () => {
  it(
    "flume loop <positional> exits 2 rather than silently starting a run",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const r = await runCli(repo.dir, ["loop", "extra"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume loop");
        expect(existsSync(join(repo.dir, ".flume", "loop.pid"))).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume loop --max N <positional> exits 2",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const r = await runCli(repo.dir, ["loop", "--max", "3", "extra"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume loop");
        expect(existsSync(join(repo.dir, ".flume", "loop.pid"))).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume job run <name> <extra> still refuses via its pre-existing check (baseline unchanged)",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const r = await runCli(repo.dir, ["job", "run", "probejob", "extra"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume job run");
        expect(
          existsSync(join(repo.dir, ".flume", "jobs", "probejob", "loop.pid")),
        ).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});

/**
 * `flume friction [name]` (spec/cli.md §Subcommand surface) — the read verb
 * over `Chain.friction`. Reuses `minimalChainSrc` from the friction-line
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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

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
  }, SPAWN_BUDGET_MS);

  it("exits EX_IOERR naming the error on a non-ENOENT note read failure, instead of reporting 'no such note'", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      const frictionDir = join(repo.dir, ".flume", "friction");
      // A directory in place of the note reproduces a non-ENOENT read
      // failure (EISDIR) without relying on permission bits a root-run test
      // could bypass (`.claude/rules/engineering.md`, "Loud or nothing"),
      // matching the `check` pendingPath test's approach above.
      await mkdir(join(frictionDir, "note.md"), { recursive: true });

      const r = await runCli(repo.dir, ["friction", "note.md"]);
      expect(r.code).toBe(EX_IOERR);
      expect(r.out).not.toContain("no note named");
      expect(r.out).toContain("failed to read");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("exits EX_IOERR naming the error on a non-ENOENT bare-list readdir failure, instead of listing empty", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      // A file in place of the friction dir reproduces a non-ENOENT readdir
      // failure (ENOTDIR) without relying on permission bits — same
      // rationale as the note-read case above.
      await mkdir(join(repo.dir, ".flume"), { recursive: true });
      await writeFile(join(repo.dir, ".flume", "friction"), "not a dir\n");

      const r = await runCli(repo.dir, ["friction"]);
      expect(r.code).toBe(EX_IOERR);
      expect(r.out.trim()).not.toBe("");
      expect(r.out).toContain("failed to read");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it.runIf(process.platform !== "win32")("flume friction refuses with EX_IOERR when a listed note cannot be stat'd", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      const frictionDir = join(repo.dir, ".flume", "friction");
      await mkdir(frictionDir, { recursive: true });
      await writeFile(join(frictionDir, "a.md"), "note a\n");
      // Read without traverse on the channel dir: readdir still enumerates
      // the note, stat on it fails EACCES. Unlike the two arms above, no
      // permission-independent fixture reaches this one — a symlink, a
      // directory, or a device in a note's place is filtered out by the
      // dirent's own isFile() before stat runs — so this follows the EACCES
      // precedent of the `flume status` friction-line test above.
      await chmod(frictionDir, 0o444);

      const r = await runCli(repo.dir, ["friction"]);
      expect(r.code).toBe(EX_IOERR);
      expect(r.out).toContain("friction/a.md");
      expect(r.out).toContain("failed to read");
      // The refusal replaces the listing rather than trailing a partial one:
      // rows redirected to a file would otherwise read as a whole channel.
      expect(r.out).not.toMatch(/a\.md {2}\d+ {2}\d{4}-/);
    } finally {
      await chmod(join(repo.dir, ".flume", "friction"), 0o755).catch(() => {});
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);
});

describe("cli.ts — loop.pid win32 MAX_PATH fix (.claude/rules/platform-facts.md)", () => {
  // toNamespacedPath is a no-op on POSIX, so any roundtrip test of loop.pid
  // behavior passes identically whether cli.ts routes through namespacedJoin
  // or a bare join. Pin the source shape directly, mirroring
  // Baton.test.ts's "win32 MAX_PATH fix" precedent — job.ts:liveLoopPid is
  // the reference shape every loop.pid call site here must match. The name
  // itself now comes from `loopLockPath` (src/paths.ts), so the pin is on the
  // accessor being wrapped, not on a filename spelled here.
  const src = readFileSync(CLI_SRC_PATH, "utf8");

  it("builds the status-check loop-lock path (existsLoud) through namespacedJoin", () => {
    expect(src).toMatch(/existsLoud\(namespacedJoin\(loopLockPath\(flumeDir\)\)\)/);
  });

  it("builds the loop-lock path (lockPath) through namespacedJoin, and writeFileSync/unlinkSync both read it from lockPath", () => {
    const lockPathAssign = src.match(
      /const lockPath = namespacedJoin\(loopLockPath\(flumeDir\)\);/,
    );
    expect(lockPathAssign).not.toBeNull();

    expect(src).toMatch(/writeFileSync\(lockPath,/);
    const unlinkCalls = src.match(/unlinkSync\(lockPath\)/g);
    expect(unlinkCalls).not.toBeNull();
    // Exactly one drop site: `dropLock`. The refused-tip-claim rollback and
    // the signal handlers all call it rather than unlinking again, so a
    // second occurrence here means a second owner has grown back
    // (spec/loop.md "The loop lock and the tip claim").
    expect(unlinkCalls!.length).toBe(1);
  });

  it("every loopLockPath call in cli.ts is wrapped in namespacedJoin", () => {
    const uses = [...src.matchAll(/\bloopLockPath\(\w+\)/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(src.slice(0, use.index!)).toMatch(/namespacedJoin\($/);
    }
  });
});

// ---------- the state root's layout, writer against reader ----------

/**
 * The runtime state root's names (`stop`, `loop.pid`, the undeclared-queue
 * default) each have a writer and a reader in *different* modules, so a
 * rename that reaches only one side is a silent bypass rather than a type
 * error. `src/paths.ts` is the single home; these tests are the agreement
 * gate over it (`.claude/rules/engineering.md`, "A seam gate reads what the
 * real writer wrote"): the real writer runs, the real reader decodes what it
 * wrote, and no path in this section is spelled by the test.
 */

/**
 * A chain whose singleton phase hands off to itself — so absent a stop the
 * loop burns to `--max` — and whose agent shells out to the real `flume
 * stop` verb from *inside* the child tick. The flag therefore lands on disk
 * by the production writer, mid-tick, with the state root taken from the
 * env the supervisor canonicalized; nothing here names the file.
 */
function realStopVerbChainSrc(phaseName: string): string {
  return (
    `import { execFileSync } from "node:child_process";\n` +
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [${JSON.stringify(phaseName)}],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `},\n` +
    `agent: {\n` +
    `  name: "real-stop-verb",\n` +
    `  async invoke() {\n` +
    `    execFileSync(process.execPath, [${JSON.stringify(TSX_CLI)}, ${JSON.stringify(CLI)}, "stop"], {\n` +
    `      stdio: "ignore",\n` +
    `    });\n` +
    `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
    `  },\n` +
    `} });\n`
  );
}

describe("state root layout — `flume stop` writes the flag every reader honors", () => {
  it(
    "the flag the stop verb wrote refuses the next `flume loop` before any tick",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, minimalStubbedAgentChainSrc());
        new Baton(join(repo.dir, ".flume")).wake("probe");

        // Vacuity control: with no flag, this loop runs its tick and reaches
        // --max. Whatever the refusal below proves, it is not proving that
        // `loop` refuses unconditionally.
        const before = await runCli(repo.dir, ["loop", "--max", "1"]);
        expect(before.out).toMatch(/reached --max 1|hibernating after/);
        expect(before.out).not.toContain("stop flag present");

        // The real writer. The test never names the file it wrote.
        const wrote = await runCli(repo.dir, ["stop"]);
        expect(wrote.code).toBe(0);

        // The real reader — `flume loop`'s pre-tick refusal.
        const after = await runCli(repo.dir, ["loop", "--max", "1"]);
        expect(after.code).toBe(1);
        expect(after.out).toContain("stop flag present at");
        expect(after.out).not.toContain("reached --max");
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "the flag the stop verb wrote mid-tick ends the supervisor's run at its next per-iteration check",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        await writeRepoConfig(repo.dir, realStopVerbChainSrc("probe"));
        const flumeDir = join(repo.dir, ".flume");
        const baton = new Baton(flumeDir);
        baton.wake("probe");

        // The phase re-wakes itself every tick, so absent the flag this run
        // burns all 4 iterations. The agent runs the real `flume stop` from
        // inside the first child tick; the supervisor's per-iteration check
        // (src/Dispatcher.ts) is the only thing that can see it.
        const loop = await runCli(repo.dir, ["loop", "--max", "4"]);

        expect(loop.out).toContain("stop flag present");
        expect(loop.out).not.toContain("reached --max");
        // Exactly one child tick ran — the self-handoff would have allowed
        // three more.
        expect(loop.out.match(/tick → probe \(singleton\)/g)).toHaveLength(1);
        // Ended by the flag, not by hibernation: the handoff left the phase
        // awake.
        expect(baton.isAwake("probe")).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});

/**
 * A chain whose agent calls the runtime's own `liveLoopPid` (`src/job.ts`) —
 * the reader side of the one-supervisor lock — from inside the child tick,
 * and records what it read. The writer is the real `flume loop` that spawned
 * that child: nothing here writes or names a pidfile.
 */
function loopLockReaderChainSrc(phaseName: string, observedPath: string): string {
  const jobSrc = new URL("../src/job.ts", import.meta.url).href;
  return (
    `import { writeFileSync } from "node:fs";\n` +
    `import { liveLoopPid } from ${JSON.stringify(jobSrc)};\n` +
    `export default () => ({ chain: {\n` +
    `  phases: [{\n` +
    `    name: ${JSON.stringify(phaseName)},\n` +
    `    description: "",\n` +
    `    promptPath: "prompts/prompt.md",\n` +
    `    concurrency: "singleton",\n` +
    `    writablePaths: ["**"],\n` +
    `    gates: [],\n` +
    `    handoff: () => [],\n` +
    `  }],\n` +
    `  humanOnly: [],\n` +
    `},\n` +
    `agent: {\n` +
    `  name: "loop-lock-reader",\n` +
    `  async invoke() {\n` +
    `    const observed = await liveLoopPid(process.env.FLUME_DIR ?? "");\n` +
    `    writeFileSync(\n` +
    `      ${JSON.stringify(observedPath)},\n` +
    `      JSON.stringify({ observed, supervisor: process.ppid }),\n` +
    `    );\n` +
    `    return { exitCode: 0, stdout: "", stderr: "" };\n` +
    `  },\n` +
    `} });\n`
  );
}

describe("state root layout — `flume loop` writes the lock `liveLoopPid` reads back", () => {
  it(
    "the pid liveLoopPid reads mid-run is the live supervisor's own",
    async () => {
      const repo = await makeJobRepo("main");
      const outDir = await mkdtemp(join(tmpdir(), "flume-loop-lock-read-"));
      try {
        // Outside the state root so the probe's own output can never be
        // mistaken for state the runtime wrote.
        const observedPath = join(outDir, "observed-loop-lock.json");
        await writeRepoConfig(
          repo.dir,
          loopLockReaderChainSrc("probe", observedPath),
        );
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const loop = await runCli(repo.dir, ["loop", "--max", "1"]);
        expect(loop.out).toContain("tick → probe (singleton)");

        // Vacuity: the probe ran at all.
        expect(existsSync(observedPath)).toBe(true);
        const observed = JSON.parse(await readFile(observedPath, "utf8")) as {
          observed: number | null;
          supervisor: number;
        };
        // The reader found a live pid — the lock the supervisor wrote —
        // and it is that supervisor, the child tick's own parent.
        expect(observed.observed).not.toBeNull();
        expect(observed.observed).toBe(observed.supervisor);

        // Released on the normal exit path: a second loop is not refused by
        // a leftover lock.
        const second = await runCli(repo.dir, ["loop", "--max", "0"]);
        expect(second.out).not.toContain("already runs");
      } finally {
        await repo.cleanup();
        await rm(outDir, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );
});

describe("state root layout — an undeclared Chain.pendingPath is one file for every consumer", () => {
  it(
    "the queue at the default location is the one `flume check` validates and the one the dispatcher picks from",
    async () => {
      const repo = await makeJobRepo("main");
      const wtDir = await mkdtemp(join(tmpdir(), "flume-queue-default-"));
      try {
        // A fanout phase (the sole kind that picks from pending) on a chain
        // that declares no pendingPath. Worktree provisioning is pointed at
        // a plain file so a picked entry fails immediately after selection —
        // this test is about which file was read, not about shipping.
        await writeRepoConfig(repo.dir, supervisorPolicyChainSrc(undefined));
        const collision = join(wtDir, "wt-collision");
        await writeFile(collision, "not a directory\n", "utf8");
        const env = { ...hermeticEnv(), FLUME_WORKTREES_DIR: collision };
        new Baton(join(repo.dir, ".flume")).wake("build");

        // Vacuity control: with no queue on disk, both consumers report
        // absence. Without this, a pair of consumers that both resolved the
        // wrong default would still agree — on nothing.
        const checkAbsent = await runCli(repo.dir, ["check"], env);
        expect(checkAbsent.code).toBe(0);
        expect(checkAbsent.out).toContain("absent — nothing to check");
        const tickAbsent = await runCli(repo.dir, ["tick"], env);
        expect(tickAbsent.out).toContain("nothing pickable");

        // Seeded at the accessor's default and committed (dispatch reads the
        // tip, not the tree).
        await writeStuckEntryPending(repo.dir);

        const check = await runCli(repo.dir, ["check"], env);
        expect(check.code).toBe(0);
        expect(check.out).toContain("valid (1 entries)");

        const tick = await runCli(repo.dir, ["tick"], env);
        expect(tick.out).not.toContain("nothing pickable");
        expect(tick.out).toContain("STUCK-ENTRY");
      } finally {
        await repo.cleanup();
        await rm(wtDir, { recursive: true, force: true });
      }
    },
    SPAWN_BUDGET_MS,
  );
});

/**
 * CLI-FIXTURE-ANCESTOR-PROOF — the rooting idiom every CLI fixture above now
 * goes through (`mkFixtureRoot`, tests/helpers/subprocess.ts), pinned against
 * the litter it exists to survive: a `.flume` planted in an ancestor the
 * fixture happens to live under, which is what a leaked `/tmp/.flume` is.
 * Each case carries its own control — the same CLI invocation from an
 * unrooted sibling, proving the planted bay is load-bearing rather than a
 * directory nothing ever reads.
 */
describe("CLI fixtures are rooted against an ancestor `.flume` (CLI-FIXTURE-ANCESTOR-PROOF)", () => {
  it("a `.flume` planted above the fixture does not change `flume status`'s verdict", async () => {
    const attic = await mkdtemp(join(tmpdir(), "flume-attic-"));
    try {
      // The litter: a bay above every fixture created under it, awake on a
      // phase no fixture below ever declares.
      await mkdir(join(attic, ".flume", "awake"), { recursive: true });
      await writeFile(join(attic, ".flume", "awake", "ghostphase"), "", "utf8");

      // Control: an unrooted sibling resolves straight through the litter,
      // so the planted bay below is answering a question that has a wrong
      // answer available.
      const stray = join(attic, "stray");
      await mkdir(stray, { recursive: true });
      const unrooted = await runCli(stray, ["status"]);
      expect(unrooted.code).toBe(0);
      expect(unrooted.out).toContain("awake: ghostphase");

      const dir = await mkFixtureRoot("flume-rooted-status-", attic);
      const rooted = await runCli(dir, ["status"]);
      expect(rooted.code).toBe(0);
      expect(rooted.out).toContain("hibernating");
      expect(rooted.out).not.toContain("ghostphase");
    } finally {
      await rm(attic, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);
});

/**
 * spec/jobs.md "Runtime ignores" — the default `<repoRoot>/.flume` takes the
 * same runtime-owned `.gitignore` merge a job dir takes at `job new`, at
 * every `loop` / `job run` start. Without it a fresh adopter (whose repo
 * `.gitignore` was never hand-taught the runtime's layout) commits tick
 * artifacts.
 *
 * Driven through the real CLI with `--max 0`: the merge sits under the tip
 * claim and ahead of the startup sweep, both of which `--max 0` reaches
 * before stopping without spawning a child tick. The expectation reads
 * `RUNTIME_IGNORES` (`src/job.ts`) rather than respelling the block, so a
 * line added there is asserted here by construction.
 */
describe("flume loop — runtime ignores at the default state root", () => {
  it(
    "a loop start merges the runtime ignores into the default state root's .gitignore",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const ignorePath = join(repo.dir, ".flume", ".gitignore");
        // No `job new` ran, so nothing has seeded this root: the file the
        // merge must create genuinely does not exist yet.
        expect(existsSync(ignorePath)).toBe(false);

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("reached --max 0");

        // Vacuity pin: an empty RUNTIME_IGNORES would let any content pass.
        expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
        const content = await readFile(ignorePath, "utf8");
        const lines = content.split("\n");
        for (const entry of RUNTIME_IGNORES) {
          expect(lines).toContain(entry);
        }
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "a loop start merges a declared Chain.friction dir into the default state root's .gitignore",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        // Declared with a backslash and a doubled trailing slash: the entry
        // that lands must be the `frictionIgnoreEntry` (`src/job.ts`)
        // normalization `job new` applies, not whatever the chain wrote.
        await writeRepoConfig(repo.dir, minimalChainSrc("scratch\\friction//"));
        const ignorePath = join(repo.dir, ".flume", ".gitignore");

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("reached --max 0");

        const lines = (await readFile(ignorePath, "utf8")).split("\n");
        expect(lines).toContain("scratch/friction/");
        // Vacuity pin: the base set still merges alongside it, so a friction
        // entry cannot pass by having replaced the runtime block.
        expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
        for (const entry of RUNTIME_IGNORES) {
          expect(lines).toContain(entry);
        }
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "leaves a state root that already carries the entries byte-identical, seed lines and order intact",
    async () => {
      const repo = await makeJobRepo("main");
      try {
        const flumeDir = join(repo.dir, ".flume");
        await mkdir(flumeDir, { recursive: true });
        const ignorePath = join(flumeDir, ".gitignore");
        // Seed-authored line first, then the runtime block in an order the
        // merge did not choose — a re-merge that rewrote the file would
        // reorder or duplicate.
        expect(RUNTIME_IGNORES.length).toBeGreaterThan(0);
        const seeded =
          "sessions/\n" + [...RUNTIME_IGNORES].reverse().join("\n") + "\n";
        await writeFile(ignorePath, seeded, "utf8");

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);
        expect(r.code).toBe(0);

        expect(await readFile(ignorePath, "utf8")).toBe(seeded);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});
