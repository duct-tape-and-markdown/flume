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
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { isInvokedDirectly, EX_DATAERR, EX_IOERR } from "../src/cli.ts";
import { Baton } from "../src/Baton.ts";
import { EX_MOUNT_DEAD } from "../src/Dispatcher.ts";
import { CLI, HERMETIC_ENV_STRIP_KEYS, hermeticEnv, runCli } from "./helpers/subprocess.ts";

const exec = promisify(execFile);

const CLI_SRC_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));


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
 * strips every identity/provenance FLUME_* var it knows of — a job
 * resolution or a tip-claim PID leaked from the vitest process's own env is
 * exactly as capable of retargeting a spawned CLI as a relocated state root
 * is. The assertion below checks the invariant directly — no key matching
 * `/^FLUME_/` survives in its output — rather than restating a copy of its
 * delete set (`.claude/rules/engineering.md`, "Derived state is computed,
 * never restated beside its source"; CLI-HERMETICENV-COVERS-ALL-VARS had
 * hardcoded a name list here that fell behind hermeticEnv()'s own deletes
 * twice). `HERMETIC_ENV_STRIP_KEYS` below (imported from the harness, not
 * restated) only seeds realistic input (and keeps the test non-vacuous); it
 * plays no role in what gets checked, so a var added to `hermeticEnv()`'s
 * strip set — or one that leaks ambiently from an outer flume-on-flume
 * invocation — is caught without touching this file.
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
  const planDir = join(root, ".flume", "plan");
  await mkdir(planDir, { recursive: true });
  await writeFile(
    join(planDir, "pending.json"),
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
  await exec("git", ["add", "--", ".flume/plan/pending.json"], opts);
  await exec("git", ["commit", "-q", "-m", "test: seed STUCK-ENTRY"], opts);
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
    `      const flumeDirEnv = process.env.FLUME_DIR ?? "";\n` +
    `      const pendingPath = join(flumeDirEnv, "plan", "pending.json");\n` +
    `      writeFileSync(pendingPath, "{ corrupted mid-wave, not json", "utf8");\n` +
    // Committed on trunk, not left on disk uncommitted: the rewrite read
    // this corruption targets now resolves the committed HEAD tip, never
    // the working tree (spec/pending.md "Dispatch reads come from the tip,
    // not the tree").
    `      const repoRoot = join(flumeDirEnv, "..");\n` +
    `      execFileSync(\n` +
    `        "git",\n` +
    `        ["add", "--", ".flume/plan/pending.json"],\n` +
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
        // Committed, not left on disk uncommitted — the decide-read now
        // resolves the committed HEAD tip (spec/pending.md "Dispatch reads
        // come from the tip, not the tree").
        await exec("git", ["add", "--", ".flume/plan/pending.json"], {
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
 * A minimal, otherwise-valid chain — never ticked in the §6 friction tests
 * below, just loaded for its declared fields. `friction` omitted leaves the
 * field undeclared entirely (§2: undeclared turns every §6 behavior off).
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

  it("renders 'friction: unreadable' when the declared dir exists but readdir fails for a non-ENOENT reason (dispatcher-frictioncountline-loud-or-nothing)", async () => {
    const repo = await makeJobRepo("main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc("friction"));
      const frictionDir = join(repo.dir, ".flume", "friction");
      await mkdir(frictionDir, { recursive: true });
      await writeFile(join(frictionDir, "a.md"), "note a\n");
      // Strip traversal permission on the friction dir itself: readdir now
      // fails with EACCES — the dir exists but can't be read — not ENOENT
      // (`.claude/rules/engineering.md`, "Loud or nothing"). Mirrors the
      // EACCES fixture `flume job status`'s own frictionCount test uses
      // (tests/job.test.ts).
      await chmod(frictionDir, 0o000);

      const r = await runCli(repo.dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("hibernating");
      expect(r.out).toContain("friction: unreadable");
      expect(r.out).not.toContain("note(s) await routing");
    } finally {
      await chmod(join(repo.dir, ".flume", "friction"), 0o755).catch(() => {});
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

  it("honors a chain-declared pendingPath (CHAIN-PENDINGPATH) — counts entries at the custom location, not plan/pending.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-status-pending-"));
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
      // A plan/pending.json at the default location must never be consulted
      // once a custom pendingPath is declared.
      await mkdir(join(dir, ".flume", "plan"), { recursive: true });
      await writeFile(
        join(dir, ".flume", "plan", "pending.json"),
        JSON.stringify([]),
        "utf8",
      );

      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("pending: 1");
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

// ---------- flume stop (spec/loop.md "Graceful stop — the stop flag") ----------

describe("flume stop — writes <flumeDir>/stop and prints the consequence", () => {
  it(
    "writes the flag and names the path plus what happens next, exit 0",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-stop-"));
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
    30_000,
  );

  it(
    "is idempotent — a repeat call finds the flag already present and prints the same statement, exit 0",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-stop-idempotent-"));
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
    30_000,
  );

  it("flume stop --help short-circuits before writing the flag", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-stop-help-"));
    try {
      const r = await runCli(dir, ["stop", "--help"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Usage: flume stop");
      expect(existsSync(join(dir, ".flume", "stop"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("flume status — stop flag line (spec/cli.md \"flume status owes exactly this\", line 3)", () => {
  it("prints nothing when the flag is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flume-status-stop-absent-"));
    try {
      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain(join(dir, ".flume", "stop"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it(
    "names the path and that the running supervisor will finish and end the run, ordered after supervisor liveness and before the tip claim",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-status-stop-live-"));
      try {
        const flumeDir = join(dir, ".flume");
        await mkdir(flumeDir, { recursive: true });
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
    30_000,
  );

  it(
    "names the path and that the next loop/job run refuses, when no supervisor is live",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-status-stop-dead-"));
      try {
        const flumeDir = join(dir, ".flume");
        await mkdir(flumeDir, { recursive: true });
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
    30_000,
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
    30_000,
  );

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
    30_000,
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

async function writeCheckPending(
  root: string,
  entries: unknown[],
  rel: string = join("plan", "pending.json"),
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
      expect(r.code).toBe(EX_DATAERR);
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
      // The default location was never written or read.
      expect(existsSync(join(repo.dir, ".flume", "plan", "pending.json"))).toBe(
        false,
      );
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
      expect(r.code).toBe(EX_IOERR);
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
      expect(r.code).toBe(EX_MOUNT_DEAD);
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
    30_000,
  );

  it(
    "flume stop <positional> exits 2",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-stop-positional-"));
      try {
        const r = await runCli(dir, ["stop", "extra"]);
        expect(r.code).toBe(2);
        expect(r.out).toContain("usage: flume stop");
        expect(existsSync(join(dir, ".flume", "stop"))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
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
    30_000,
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
    30_000,
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
    30_000,
  );

  it(
    "flume status ignores extra positionals and still exits 0 (the one named exception)",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "flume-status-positional-"));
      try {
        const r = await runCli(dir, ["status", "extra", "more"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("hibernating");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
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
    30_000,
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
    30_000,
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
    30_000,
  );
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
  }, 30_000);

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
  }, 30_000);
});

describe("cli.ts — loop.pid win32 MAX_PATH fix (platform-facts.md)", () => {
  // toNamespacedPath is a no-op on POSIX, so any roundtrip test of loop.pid
  // behavior passes identically whether cli.ts routes through namespacedJoin
  // or a bare join. Pin the source shape directly, mirroring
  // Baton.test.ts's "win32 MAX_PATH fix" precedent — job.ts:liveLoopPid is
  // the reference shape every loop.pid call site here must match.
  const src = readFileSync(CLI_SRC_PATH, "utf8");

  it("never builds the loop.pid path with a bare join", () => {
    const bareJoinLoopPid = /(?<!namespaced)\bjoin\([^)]*"loop\.pid"/g;
    expect(src.match(bareJoinLoopPid)).toBeNull();
  });

  it("builds the status-check loop.pid path (existsSync) through namespacedJoin", () => {
    expect(src).toMatch(/existsSync\(namespacedJoin\(flumeDir,\s*"loop\.pid"\)\)/);
  });

  it("builds the loop-lock loop.pid path (lockPath) through namespacedJoin, and writeFileSync/unlinkSync both read it from lockPath", () => {
    const lockPathAssign = src.match(/const lockPath = (namespacedJoin\(flumeDir,\s*"loop\.pid"\));/);
    expect(lockPathAssign).not.toBeNull();

    expect(src).toMatch(/writeFileSync\(lockPath,/);
    const unlinkCalls = src.match(/unlinkSync\(lockPath\)/g);
    expect(unlinkCalls).not.toBeNull();
    expect(unlinkCalls!.length).toBeGreaterThanOrEqual(2);
  });
});
