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

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, win32 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CLI_MODULE_IDENTITY,
  isInvokedDirectly,
  onDiskIdentity,
} from "../src/cli.ts";
import { buildFlumeApi } from "../src/flumeApi.ts";
// Barrel-export pin (.claude/rules/engineering.md "An export earns its
// consumer"): stopFlagPath is the chain-facing rule for `<flumeDir>/stop`,
// reachable from the package entry point as well as off the FlumeApi object.
// This import fails tsc if it drops from src/index.ts.
import { stopFlagPath as indexStopFlagPath } from "../src/index.ts";
import { Baton } from "../src/Baton.ts";
import { loadChainModule } from "../src/chainLoad.ts";
import {
  EX_DATAERR,
  EX_IOERR,
  EX_MOUNT_DEAD,
  EX_TERMINAL_MISCONFIG,
} from "../src/exitCodes.ts";
import { pendingGate } from "../src/builtinGates.ts";
import type { GateContext } from "../src/Gate.ts";
import { RUNTIME_IGNORES } from "../src/runtimeIgnores.ts";
import {
  computeStateRootRel,
  DEFAULT_PENDING_REL,
  loopLockPath,
  resolvePendingDir,
  STATE_ROOT_DIRNAME,
  STATE_ROOT_NAMES,
  stopFlagPath,
} from "../src/paths.ts";
import { entryFileName } from "../src/PendingSchema.ts";
import { gitCommonDir, tipClaimPath } from "../src/git.ts";
import { renderPidClaim } from "../src/pidClaim.ts";
import { DEFAULT_KILL_GRACE_MS } from "../src/processTree.ts";
import {
  tickVerdictPath,
  tickVerdictsLogPath,
  writeTickVerdict,
  type TickVerdict,
  type TickVerdictInvocation,
} from "../src/tickVerdict.ts";
import { deadPid } from "./helpers/deadPid.ts";
import { denyDirectory, denyFile } from "./helpers/denial.ts";
import { fileWithContent, pidClaimIn, waitFor } from "./helpers/waitFor.ts";
import { mkFixtureRoot, mkTempDir } from "./helpers/fixtureRoot.ts";
import { HERMETIC_ENV_STRIP_KEYS, hermeticEnv } from "./helpers/gitEnv.ts";
import { helpExitCodeRow } from "./helpers/cliHelpRows.ts";
import {
  minimalChainSrc,
  markerAgentChainSrc,
  stubbedAgentChainSrc,
  writeRepoConfig,
} from "./helpers/repoChain.ts";
import { makeScratchRepo, type ScratchRepo } from "./helpers/scratchRepo.ts";
import {
  CLI,
  SPAWN_BUDGET_MS,
  TSX_CLI,
  exec,
  processAlive,
  runCli,
  runCliStreams,
} from "./helpers/subprocess.ts";

// This file starts processes, so it declares the lane's one budget — cases
// and hooks alike — once here rather than inheriting the runner's default
// (`SPAWN_BUDGET_MS`, `tests/helpers/subprocess.ts`).
vi.setConfig({ testTimeout: SPAWN_BUDGET_MS, hookTimeout: SPAWN_BUDGET_MS });

const CLI_SRC_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

/**
 * The provider module a fixture chain imports the real `claudeCode` from —
 * an absolute path, because the chain it is written into lives in a temp repo
 * with no view of this one.
 */
const AGENT_SRC_PATH = fileURLToPath(
  new URL("../src/claudeCode.ts", import.meta.url),
);

/**
 * `isInvokedDirectly` (`src/cli.ts`), the seam gating `main()`.
 * Unit-level rather than a subprocess: the seam takes `argv1` and answers
 * against this module's own `import.meta.url`, so calling it directly
 * exercises the exact comparison `main()` gates on, without the overhead of
 * spawning `tsx` per case. The side it answers *with* comes from the module
 * too — `CLI_MODULE_IDENTITY`, never this file's `CLI`, which is the
 * tester's own spelling of the same file and would re-author the half under
 * test (`.claude/rules/engineering.md`, *A seam gate reads what the real
 * writer wrote*).
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

  it("a throwing realpathSync leaves the CLI entry check answering rather than crashing the import", () => {
    // `realpathSync` throws on a path that is not on disk, so this is the
    // catch leg: what it must produce is an answer — the unresolved path,
    // folded — never an exception out of a module-level call the import
    // cannot catch.
    const missing = join(tmpdir(), "flume-cli-junction-missing", "cli.js");
    expect(() => isInvokedDirectly(missing)).not.toThrow();
    expect(isInvokedDirectly(missing)).toBe(false);
  });

  it("the CLI entry check's degraded leg reports the error that sent it there", () => {
    // The leg above, read for what it hands back rather than for whether it
    // throws. A degraded answer that discards its cause is the same string
    // as a resolved one, so a comparison decided by it can only ever red
    // naming a second spelling — which is all the windows lane has reported
    // from the junction case above. The cause rides beside the answer so
    // that red names the reason the resolving leg declined
    // (`.claude/rules/engineering.md`, *Loud or nothing*).
    const missing = join(tmpdir(), "flume-cli-junction-missing", "cli.js");
    const answered = onDiskIdentity(missing);

    // The folded answer is unchanged: nothing resolved, so the path stands.
    expect(answered.identity).toBe(missing);

    // And the leg that answered says so. `ENOENT` is the code both legs of
    // the platform split raise over an absent path — node's JS realpath and
    // libuv's native one alike — so the assertion holds wherever this suite
    // runs.
    expect(answered.unresolved).toBeInstanceOf(Error);
    expect((answered.unresolved as NodeJS.ErrnoException | undefined)?.code).toBe(
      "ENOENT",
    );

    // The resolving leg reports nothing, so `unresolved` reads as the leg
    // taken rather than as a field that is always populated. Without this,
    // the assertions above would pass over a value set unconditionally.
    expect(onDiskIdentity(CLI).unresolved).toBeUndefined();
  });

  it("the CLI entry check resolves a junctioned argv[1] to the same on-disk identity as the module's own path", async () => {
    // The junction is the only difference this case is about; the root's
    // own spelling is folded where every fixture root is
    // (`tests/helpers/fixtureRoot.ts`).
    const linkParent = await mkTempDir("flume-cli-junction-");
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
      // (pnpm's linked store) produces. Non-vacuity for the assertion below:
      // the fixture really produced a second spelling, and that spelling is
      // not already the identity the check compares against, so what the
      // case exercises is the fold rather than a raw string match.
      expect(junctioned).not.toBe(CLI);
      expect(junctioned).not.toBe(CLI_MODULE_IDENTITY.identity);
      expect(realpathSync(junctioned)).toBe(realpathSync(CLI));

      // The seam's comparison, asserted on the two values it compares — the
      // module's side read off the module itself, which is the half a caller
      // cannot spell without it. A red prints the two answers one file was
      // read as, each with the error behind it where a side never resolved;
      // `expect(false).toBe(true)` names neither.
      expect(onDiskIdentity(junctioned)).toEqual(CLI_MODULE_IDENTITY);

      expect(isInvokedDirectly(junctioned)).toBe(true);
    } finally {
      await rm(linkParent, { recursive: true, force: true });
    }
  });

  it("the CLI entry check's throwing leg compares the unresolved path folded into one alphabet", () => {
    // Both sides here are win32 spellings, which name no file on any lane
    // this suite runs on — win32 included, since no such install exists in a
    // test process — so `realpathSync` throws on each and both go through
    // `onDiskIdentity`'s catch leg. What that leg must do is fold: the
    // `\\?\` prefix `toNamespacedPath` put on one side is not on the other,
    // and a catch leg answering the path verbatim would read one file as
    // two. The namespaced side is spelled by win32's own `toNamespacedPath`
    // rather than by hand, because that is the writer whose prefix the check
    // has to read back, and `win32` answers in its alphabet on every host.
    //
    // The resolving leg's fold is not reachable from here: it needs a
    // `realpathSync` that answers namespaced, which only win32 produces and
    // only over a file that exists. It is pinned directly on the fold
    // instead — `plainPath` against `win32.toNamespacedPath`, in
    // `tests/paths.test.ts` — and the two legs share that one function, so
    // this case's subject is which leg spends it, never whether the fold is
    // right.
    // Why a namespaced answer needs folding at all:
    // `.claude/rules/platform-facts.md`, "realpathSync keeps the \\?\ prefix
    // only where nothing resolved".
    const cli = String.raw`C:\pnpm-store\flume\dist\cli.js`;
    const share = String.raw`\\build-host\tools\flume\dist\cli.js`;

    // The vacuity pin the pair rides: a composer that stopped prefixing would
    // hand both sides the same string and leave the assertions below green
    // over a fold that never ran.
    expect(win32.toNamespacedPath(cli)).not.toBe(cli);
    expect(win32.toNamespacedPath(share)).not.toBe(share);

    // Both sides took the degraded leg, which is what the title claims: the
    // fold under test is the one that leg spends, and a resolving answer
    // here would be a different case wearing this one's name.
    expect(onDiskIdentity(cli).unresolved).toBeDefined();
    expect(onDiskIdentity(share).unresolved).toBeDefined();

    // The answers are compared, never the causes: two absent paths throw two
    // errors naming two spellings, and it is the fold that has to agree.
    expect(onDiskIdentity(win32.toNamespacedPath(cli)).identity).toBe(
      onDiskIdentity(cli).identity,
    );

    // A UNC install answers the same way one prefix further out
    // (`\\?\UNC\host\share\…`): the fold restores the `\\` root rather than
    // eating it, so the host name is not silently re-read as a directory.
    expect(onDiskIdentity(win32.toNamespacedPath(share)).identity).toBe(
      onDiskIdentity(share).identity,
    );
  });
});

/**
 * The shared child-environment helper's `hermeticEnv()`
 * (`tests/helpers/gitEnv.ts`) strips every identity/provenance FLUME_* var
 * it knows of — a provenance stamp or a tip-claim PID leaked from the vitest
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
 * A queue directory as a fixture seeds one: one `<tag>.json` per entry
 * directly under `dir` (`spec/pending.md`, *The ledger is a directory — one
 * entry per file*), each named by the engine's own rule so a fixture cannot
 * spell a filename the reader would not resolve.
 */
async function seedQueue(dir: string, entries: unknown[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const entry of entries) {
    const tag = (entry as { tag?: unknown }).tag;
    await writeFile(
      join(dir, entryFileName(typeof tag === "string" ? tag : "SOME-TAG")),
      JSON.stringify(entry, null, 2) + "\n",
      "utf8",
    );
  }
}

/**
 * Committed, not left on disk uncommitted — every strict queue read
 * the dispatcher acts on now resolves the committed `HEAD` tip, never the
 * working tree (spec/pending.md "Dispatch reads come from the tip, not the
 * tree"), so an uncommitted seed would be invisible to the real `flume
 * loop`/`flume tick` subprocess this feeds.
 */
async function writeStuckEntryPending(root: string): Promise<void> {
  // Placed by the accessor that owns the undeclared-queue default
  // (`resolvePendingDir`, src/paths.ts), never by a path spelled here — so a
  // consumer that resolved the default differently reads an absent queue
  // rather than a fixture the test steered onto its own answer.
  const queueDir = resolvePendingDir(join(root, ".flume"));
  await seedQueue(queueDir, [
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
  ]);
  const opts = { cwd: root };
  await exec("git", ["add", "--", relative(root, queueDir)], opts);
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
    "a loop start over a live loop.pid is refused naming the holder's pid, leaving the pidfile untouched",
    async () => {
      // A real git repo on a named branch (loop refuses outright
      // on detached HEAD, before ever reaching the lock check below).
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
    "a loop start over an unreadable loop.pid refuses with the io-error exit code, naming the resolved lock path",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        const flumeDir = join(repo.dir, ".flume");
        // The path the verb itself resolves, off the engine's own accessor —
        // never a second spelling by the tester's hand.
        const pidPath = loopLockPath(flumeDir);
        await mkdir(flumeDir, { recursive: true });
        // Structural denial of the lock file: it stats present and refuses to
        // open, which is the one split the liveness read decides and the
        // probe above cannot reach. Before that read had a guard the throw
        // escaped to `main()`'s catch — a raw stack under exit 1, the same
        // code the live-holder refusal above takes while naming a pid this
        // case has none of. EISDIR carries no path of its own, so the
        // refusal states the one it read or the operator gets a bare name
        // under a state root that may be relocated.
        denyFile(pidPath);

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);

        expect(r.code).toBe(EX_IOERR);
        expect(r.out).toContain(
          `[flume] loop refuses: loop lock at ${pidPath} failed to read`,
        );
        // An unknown holder is never reported as a known one, and no run
        // started over the lock.
        expect(r.out).not.toContain("already runs");
        expect(r.out).not.toContain("reached --max");
        // Neither guard is left behind: the lock path still holds exactly
        // what the fixture planted (a claim written over it would have had
        // to remove the directory first), and the tip claim is acquired only
        // past this refusal.
        expect(readdirSync(pidPath)).toEqual([]);
        const claimPath = tipClaimPath(
          await gitCommonDir(repo.dir),
          "refs/heads/main",
        );
        expect(existsSync(claimPath)).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "a loop start over a loop.pid whose recorded pid is dead reclaims the lock: the loop runs and drops it on exit",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        const flumeDir = join(repo.dir, ".flume");
        const pidPath = join(flumeDir, "loop.pid");
        await mkdir(flumeDir, { recursive: true });
        await writeFile(pidPath, String(deadPid()), "utf8");
        // A chain, so the run this case is about is a real one: a `loop`
        // whose chain does not resolve ends mount-dead before it reaches
        // the baton at all.
        await writeRepoConfig(repo.dir, minimalChainSrc());

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);

        // Not refused — the dead holder was reclaimed and the loop ran to
        // its stop. Nothing is awake in this fixture, so `--max 0` ends on
        // the empty baton rather than on the budget: the supervisor reads
        // the flags before it spends a child, and there was nothing to
        // start.
        expect(r.code).toBe(0);
        expect(r.out).not.toContain("refusing");
        expect(r.out).toContain("hibernating after 0 tick(s)");
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
  // `livePidClaimAt` (src/pidClaim.ts) — one probe, not two hand-rolled ones:
  // the loop reaches it through the stake it takes the lock with
  // (`stakePidClaim`), status through `liveLoopClaim`. This pins agreement so
  // a future one-sided change to either call site fails here instead of
  // silently diverging.
  it(
    "agrees with `flume status` on a live pid: loop refuses, status reports the same pid live",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        const flumeDir = join(repo.dir, ".flume");
        const pidPath = join(flumeDir, "loop.pid");
        await mkdir(flumeDir, { recursive: true });
        await writeFile(pidPath, String(deadPid()), "utf8");
        // A chain, so the run this case is about is a real one: a `loop`
        // whose chain does not resolve ends mount-dead before it reaches
        // the baton at all.
        await writeRepoConfig(repo.dir, minimalChainSrc());

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
 * one entry file under `<flumeDir>/plan/pending/` mid-invocation (same mechanism
 * `tests/Dispatcher.test.ts`'s ledger-refusal suite uses) and then
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
    `      const entryPath = join(\n` +
    `        flumeDirEnv,\n` +
    `        ${JSON.stringify(DEFAULT_PENDING_REL)},\n` +
    `        ${JSON.stringify(entryFileName("SHIP-A"))},\n` +
    `      );\n` +
    `      writeFileSync(entryPath, "{ corrupted mid-wave, not json", "utf8");\n` +
    // Committed on trunk, not left on disk uncommitted: the rewrite read
    // this corruption targets now resolves the committed HEAD tip, never
    // the working tree (spec/pending.md "Dispatch reads come from the tip,
    // not the tree").
    `      const repoRoot = join(flumeDirEnv, "..");\n` +
    `      execFileSync(\n` +
    `        "git",\n` +
    `        ["add", "--", entryPath],\n` +
    `        { cwd: repoRoot },\n` +
    `      );\n` +
    `      execFileSync(\n` +
    `        "git",\n` +
    `        ["commit", "-q", "-m", "test: corrupt an entry mid-wave"],\n` +
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
describe("flume tick — the tick verdict on disk after a ledger-rewrite PendingParseFailure (LOOP-WAVE-VERDICT-MULTIENTRY-COVERAGE)", () => {
  it(
    "a multi-entry wave (one shipped, one declined) whose commitPendingUpdate rewrite read hits a corrupt entry file still writes the wave's verdict to the phase's verdict file",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, ledgerRewriteFailureChainSrc("build"));
        const flumeDir = join(repo.dir, ".flume");
        const pendingDir = resolvePendingDir(flumeDir);
        await seedQueue(pendingDir, [
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
        ]);
        // Committed, not left on disk uncommitted — the decide-read now
        // resolves the committed HEAD tip (spec/pending.md "Dispatch reads
        // come from the tip, not the tree").
        await exec("git", ["add", "--", pendingDir], {
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
        expect(
          await readFile(join(pendingDir, entryFileName("SHIP-A")), "utf8"),
        ).toBe("{ corrupted mid-wave, not json");

        // The defect this test pins: the on-disk artifact, not just the
        // in-memory outcome, must carry both the shipped tag and the
        // declined sibling.
        const verdictPath = tickVerdictPath(flumeDir, "build");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      const wtDir = await mkTempDir("flume-wt-collision-");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      const wtDir = await mkTempDir("flume-wt-collision-");
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
 * shape as the loop-lock tests above (`liveLoopPid`, `src/pidClaim.ts`), applied
 * to a bare `.flume/loop.pid` rather than a relocated root's.
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
      await writeFile(join(flumeDir, "loop.pid"), String(deadPid()), "utf8");

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
      expect(r.out).toContain("failed to read");
      expect(r.out).not.toContain("supervisor pid");
      expect(r.out).not.toContain("stale");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it("flume status refuses an unreadable loop.pid naming the resolved lock path", async () => {
    const dir = await mkFixtureRoot("flume-status-unreadable-pid-");
    try {
      const flumeDir = join(dir, ".flume");
      // The path the verb itself resolves, off the engine's own accessor —
      // never a second spelling by the tester's hand.
      const pidPath = loopLockPath(flumeDir);
      // A directory at the path stats fine and refuses to open (EISDIR), so
      // it separates the presence probe from the claim read the way a symlink
      // loop cannot: the case above never reached `liveLoopClaim`, and this
      // one is the whole of what that reader decides. Before the read joined
      // the probe's guard it threw past the verb into `main()`'s catch — a
      // raw stack and exit 1, the one exit `status` is specced never to take.
      // EISDIR carries no path of its own, so the refusal states the one it
      // read or the operator gets a bare name under a state root that may be
      // relocated.
      await mkdir(pidPath);

      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(EX_IOERR);
      expect(r.out).toContain(
        `[flume] status: loop lock at ${pidPath} failed to read`,
      );
      expect(r.out).not.toContain("supervisor pid");
      expect(r.out).not.toContain("process dead — stale");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it("flume status refuses an obstructed state root with the io-error exit code rather than a raw stack", async () => {
    // Not `mkFixtureRoot`: the bay this fixture plants is the subject, and it
    // is planted *obstructed* — a plain file where the state root belongs.
    // Bay discovery stops at it (it is present, so `existsLoud` answers
    // there), resolution names it, and everything under it is unmakeable —
    // for `status`, the baton's `mkdir` of `awake/`. Before the resolution
    // grew its guard the throw escaped to `main()`'s catch: a raw stack and
    // exit 1, the one exit `status` is specced never to take (spec/cli.md,
    // "Subcommand surface").
    const dir = await mkTempDir("flume-status-obstructed-root-");
    try {
      const flumeDir = join(dir, ".flume");
      await writeFile(flumeDir, "not a directory\n", "utf8");

      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(EX_IOERR);
      // The root the verb resolved, not the leaf the errno happens to carry:
      // `<root>/.flume/awake` alone leaves the operator to infer which state
      // root a walk — or a relocating `FLUME_DIR` — picked.
      expect(r.out).toContain(`[flume] state root at ${flumeDir} failed to open`);
      expect(r.out).not.toContain("hibernating");
      expect(r.out).not.toContain("    at ");
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

describe("the verbs whose whole file read is the state root", () => {
  /**
   * The same refusal at the three verbs beside `status` whose only file read
   * is the state root itself, and at `render`, whose dispatcher is
   * constructed against that root before any arm of its own is reached. Each
   * ran the obstruction straight into `main()`'s catch — a raw stack and exit
   * 1 — until the refusal moved to the resolution every verb passes through
   * (`spec/loop.md`, *Exit codes — the run never lies to CI*).
   *
   * Each verb states its own case rather than riding a table: the claim is
   * per-verb, and a title is what a queue entry cites.
   */
  async function runOverObstructedRoot(
    argv: string[],
  ): Promise<{ out: string; code: number; flumeDir: string }> {
    // Not `mkFixtureRoot`: the obstruction is the fixture's whole point, so a
    // plain file is planted where the state root belongs and discovery stops
    // at it.
    const dir = await mkTempDir("flume-obstructed-root-");
    try {
      const flumeDir = join(dir, ".flume");
      await writeFile(flumeDir, "not a directory\n", "utf8");
      return { ...(await runCli(dir, argv)), flumeDir };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it(
    "flume wake refuses an obstructed state root with EX_IOERR naming the resolved root",
    async () => {
      const { out, code, flumeDir } = await runOverObstructedRoot([
        "wake",
        "plan",
      ]);

      expect(code).toBe(EX_IOERR);
      expect(out).toContain(`[flume] state root at ${flumeDir} failed to open`);
      // Never the raw stack it answered with before, and never the statement
      // that the flag moved — no flag can be written under this root.
      expect(out).not.toContain("    at ");
      expect(out).not.toContain("woke plan");
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume sleep refuses an obstructed state root with EX_IOERR naming the resolved root",
    async () => {
      const { out, code, flumeDir } = await runOverObstructedRoot([
        "sleep",
        "plan",
      ]);

      expect(code).toBe(EX_IOERR);
      expect(out).toContain(`[flume] state root at ${flumeDir} failed to open`);
      // `sleep` over an absent flag is a no-op that exits 0, so the reading
      // this refusal must never take is exactly its success line.
      expect(out).not.toContain("    at ");
      expect(out).not.toContain("slept plan");
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume stop refuses an obstructed state root with EX_IOERR naming the resolved root",
    async () => {
      const { out, code, flumeDir } = await runOverObstructedRoot(["stop"]);

      expect(code).toBe(EX_IOERR);
      expect(out).toContain(`[flume] state root at ${flumeDir} failed to open`);
      // The flag write is this verb's whole effect, and its statement is what
      // an operator reads as "the stop is filed".
      expect(out).not.toContain("    at ");
      expect(out).not.toContain("a live supervisor finishes its in-flight");
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume render refuses an obstructed state root with EX_IOERR naming the resolved root",
    async () => {
      const { out, code, flumeDir } = await runOverObstructedRoot([
        "render",
        "plan",
      ]);

      expect(code).toBe(EX_IOERR);
      expect(out).toContain(`[flume] state root at ${flumeDir} failed to open`);
      // Not the mount-dead reading either: the chain is never reached, and
      // "nothing resolved" would send the operator after a chain that is fine.
      expect(out).not.toContain("    at ");
      expect(out).not.toContain("render: nothing resolved");
    },
    SPAWN_BUDGET_MS,
  );
});

// ---------- the real CLI over a scratch repository ----------

/**
 * `flume status`'s friction line (`frictionCountLine`,
 * `src/friction.ts`): a count of files in the declared friction dir,
 * appended only when declared and non-empty. Best-effort: a missing/broken
 * chain never fails `status` (covered elsewhere); these tests hold the
 * chain fixed and vary only the friction declaration/dir contents.
 */
describe("flume status — friction line", () => {
  it("appends a friction count line when Chain.friction is declared and its dir holds files", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
      const frictionDir = join(repo.dir, ".flume", "friction");
      await mkdir(frictionDir, { recursive: true });
      await writeFile(join(frictionDir, "a.md"), "note a\n");
      // Deny the friction dir structurally (`tests/helpers/denial.ts`):
      // readdir now fails ENOTDIR — the path is there but is not a dir to
      // read — not ENOENT (`.claude/rules/engineering.md`, "Loud or
      // nothing"). Same primitive `countFrictionFiles`'s own split is
      // pinned with (tests/job.test.ts), and it denies on win32 too.
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
 * the count comes from `readPendingLoose` (`src/pendingLedger.ts`), the
 * chain-less probe pinned per-arm in tests/pendingLedger.test.ts.
 */
describe("flume status — pending entry count", () => {
  it("names the entry count for a valid queue", async () => {
    const dir = await mkFixtureRoot("flume-status-pending-");
    try {
      await seedQueue(resolvePendingDir(join(dir, ".flume")), [
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
      ]);

      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("pending: 2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it('flume status reports pending: unparsable when one entry file is malformed', async () => {
    const dir = await mkFixtureRoot("flume-status-pending-");
    try {
      const queueDir = resolvePendingDir(join(dir, ".flume"));
      await mkdir(queueDir, { recursive: true });
      await writeFile(
        join(queueDir, entryFileName("BROKEN")),
        "not json{",
        "utf8",
      );

      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("pending: unparsable");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it('prints "pending: 0" when the queue directory is absent', async () => {
    const dir = await mkFixtureRoot("flume-status-pending-");
    try {
      const r = await runCli(dir, ["status"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("pending: 0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it("honors a chain-declared pendingDir (CHAIN-PENDINGPATH) — counts entries at the custom location, not plan/pending", async () => {
    const dir = await mkFixtureRoot("flume-status-pending-");
    try {
      const customRel = join("custom", "queue");
      await writeRepoConfig(dir, minimalChainSrc({ pendingDir: customRel }));
      await seedQueue(join(dir, ".flume", customRel), [
        {
          tag: "A",
          gate: { kind: "open" },
          dependsOnForks: [],
          files: { new: [], edit: [{ path: "src/a.ts", description: "a" }], retire: [] },
        },
      ]);
      // A queue at the default location must never be consulted once a
      // custom pendingDir is declared — so the decoy is placed by the
      // accessor that owns that default, never by a path spelled here. A
      // decoy at a stale literal would sit somewhere `status` never looks,
      // and this control would pass without controlling anything.
      await mkdir(resolvePendingDir(join(dir, ".flume")), { recursive: true });

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
  await seedQueue(resolvePendingDir(join(root, ".flume")), [
    {
      tag: "GATED",
      gate: { kind: "requiresCapability", capability },
      dependsOnForks: [],
      files: { new: [], edit: [{ path: "src/gated.ts", description: "gated work" }], retire: [] },
    },
  ]);
}

/**
 * `requiresDockerHost` generalized to `requiresCapability`: an
 * entry skipped because the chain hasn't asserted its capability must never
 * be a silent skip. `flume status` names the missing capability alongside
 * the tag so the operator sees why the queue is stuck, without reading logs.
 */
describe("flume status — names the missing capability on a requiresCapability skip", () => {
  it("names the tag and the missing capability when the chain asserts nothing", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
 * A chain.ts whose factory throws — the load failure `status` must report
 * rather than absorb. Throwing from the factory (not a syntax error) keeps
 * the failure the operator's own, with a message this suite can name
 * verbatim.
 */
const THROWING_CHAIN_SRC =
  `export default () => {\n  throw new Error("chain factory exploded");\n};\n`;

/**
 * CHAIN-LOAD-FAILURE-REPORTED — the observational surfaces load the chain
 * best-effort, for `Chain.pendingDir`, `Chain.friction`, and
 * `Chain.capabilities`. Best-effort used to mean silent: a chain that threw
 * left `status` printing a pending count rebased on the default queue path,
 * exit 0, with nothing said — a confident wrong number
 * (`.claude/rules/engineering.md`, "Loud or nothing"). The load is shared
 * (`loadChainForObservation`, `src/cliChainLoad.ts`) and reports its own
 * failure on stderr; the surface's exit code is unchanged.
 *
 * Stderr alone was still the shape of a healthy repo to anything reading the
 * listing — `status`'s stdout was byte-identical over a chain that died — so
 * `status` also renders the failure as a row of its own output, ahead of the
 * count that rebased (spec/cli.md, "`flume status` owes exactly this").
 */
describe("flume status — a chain that fails to load (CHAIN-LOAD-FAILURE-REPORTED)", () => {
  it("flume status names the chain-load failure it proceeded past", async () => {
    const dir = await mkFixtureRoot("flume-status-chainfail-");
    try {
      await writeRepoConfig(dir, THROWING_CHAIN_SRC);
      // The entries the chain's own `pendingDir` would have pointed at —
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

  it("flume status prints the chain-load failure as a row of its listing before the pending count", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, THROWING_CHAIN_SRC);

      const status = await runCliStreams(repo.dir, ["status"]);

      expect(status.code).toBe(0);
      const row = status.stdout.indexOf(
        "chain: failed to load — chain factory exploded",
      );
      const count = status.stdout.indexOf("pending: ");
      // Non-vacuity: both lines are on this listing, not merely ordered by
      // two -1s. The row explains the count, so it precedes it.
      expect(row).toBeGreaterThanOrEqual(0);
      expect(count).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(count);
      // Nothing above the row is withheld: the baton line still leads the
      // listing, and the failure is a row of it rather than a replacement
      // for it.
      expect(status.stdout.indexOf("hibernating")).toBeLessThan(row);
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("flume status still exits 0 when the chain fails to load", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, THROWING_CHAIN_SRC);

      const status = await runCliStreams(repo.dir, ["status"]);

      expect(status.code).toBe(0);
      // The failure and the cost sentence it carries ride stderr; the
      // listing is otherwise the text it prints over a chain that loads —
      // plus the row below.
      expect(status.stderr).toContain("chain failed to load");
      expect(status.stdout).toContain("hibernating");
      expect(status.stdout).toContain("pending: 0");
      // The stderr report's cost sentence stays on stderr — the stdout row is
      // the listing's own line, not the report duplicated into it. Named as
      // one arm rather than a `not` over the whole listing
      // (`.claude/rules/posture-sweep.md`, the negative-assertion lens).
      expect(status.stdout).not.toContain("proceeding over engine defaults");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      // No .flume/chain.ts written.
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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

  it("`flume status`'s unstattable stop-flag refusal names the resolved stop-flag path, not the bare artifact name", async () => {
    const dir = await mkFixtureRoot("flume-status-stop-unstattable-");
    try {
      const flumeDir = join(dir, ".flume");
      // The path the verb itself resolves, off the engine's own accessor —
      // never a second spelling by the tester's hand.
      const stopPath = stopFlagPath(flumeDir);
      // A self-referential symlink reproduces a non-ENOENT stat failure
      // (ELOOP) without relying on permission bits a root-run test could
      // bypass — the same shape the loop.pid case above uses. `existsSync`
      // collapses it to "absent", which printed no stop line at all over a
      // flag that is there, telling the operator there is no pending stop
      // (`.claude/rules/engineering.md`, "Loud or nothing").
      await symlink("stop", stopPath);

      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(EX_IOERR);
      // The refusal's own phrasing, not the errno's rendering of the path:
      // ELOOP happens to quote the offending path, so a bare `toContain`
      // over the path passed while the message said `stop failed to stat`
      // and left the operator to guess which state root that name sat in.
      expect(r.out).toContain(`stop flag at ${stopPath} failed to stat`);
      expect(r.out).not.toContain("the next `loop` refuses");
      expect(r.out).not.toContain("will finish its in-flight tick");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it(
    "names the path and that the next loop refuses, when no supervisor is live",
    async () => {
      const dir = await mkFixtureRoot("flume-status-stop-dead-");
      try {
        const flumeDir = join(dir, ".flume");
        await writeFile(join(flumeDir, "stop"), "", "utf8");

        const r = await runCli(dir, ["status"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain(join(flumeDir, "stop"));
        expect(r.out).toContain(
          "the next `loop` refuses to start until it is removed",
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      expect(r.out).toContain("failed to read");
      expect(r.out).not.toContain("tip claimed by pid");
      expect(r.out).not.toContain("tip claim present, process dead");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("flume status exits 74 when the tip claim is present but cannot be read", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      const claimPath = tipClaimPath(
        await gitCommonDir(repo.dir),
        "refs/heads/main",
      );
      await mkdir(claimPath, { recursive: true });

      const r = await runCli(repo.dir, ["status"]);

      expect(r.code).toBe(EX_IOERR);
      expect(r.out).toContain(
        `[flume] status: tip claim at ${claimPath} failed to read`,
      );
      expect(r.out).not.toContain("tip claimed by pid");
      expect(r.out).not.toContain("tip claim present, process dead");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("a git-side failure stays silent, as declared: a detached HEAD prints no claim line and exits 0", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
 * `flume status`'s live-run spend (spec/cli.md, "`flume status` owes exactly
 * this", line 7). The number that decides whether a loop keeps running was
 * readable only by ending the run and reading `flume loop`'s completion
 * summary, or by re-reading the verdict log by hand.
 *
 * The rows are written by the engine's own writer (`writeTickVerdict`,
 * `src/tickVerdict.ts`) rather than hand-serialized here, so the log the CLI
 * reads back is the one a real tick would have left
 * (`.claude/rules/engineering.md`, *A seam gate reads what the real writer
 * wrote*). What each case authors is the fixture's *facts* — which phase
 * spent what, and when — never the file's shape.
 *
 * The run's window is the instant `loop.pid` *states*, so each case claims the
 * lock at a back-dated instant and dates its rows against that instead of
 * racing the wall clock the CLI reads.
 */
describe("flume status — the live run's spend (spec/cli.md \"flume status owes exactly this\", line 7)", () => {
  /**
   * How far before its stated claim instant each fixture's `loop.pid` is
   * back-dated. Wide enough to cover the stale row a case plants ahead of the
   * run, so a window read off the mtime takes that row in and the fold's
   * total changes — the two readings cannot agree by accident here.
   */
  const MTIME_BACKDATE_MS = 120_000;

  /** One agent run's usage row, the fields the totals are summed from. */
  function invocation(usage: Partial<TickVerdictInvocation>): TickVerdictInvocation {
    return {
      promptPath: "rendered-prompts/probe.md",
      uncommittedTracked: [],
      ...usage,
    };
  }

  /** One phase's tick, dated `at`, carrying `invocations`. */
  function verdict(
    phaseName: string,
    at: number,
    invocations: TickVerdictInvocation[],
  ): TickVerdict {
    return {
      phaseName,
      tags: [],
      committed: true,
      gateResults: [],
      shippedTags: [],
      mergeOutcomes: [],
      invocations,
      timings: [],
      summary: `${phaseName}: one tick`,
      headSha: "0".repeat(40),
      at: new Date(at).toISOString(),
    };
  }

  /**
   * A fixture root whose `loop.pid` records `pid` and whose claim instant is
   * `runStart` — one tick's worth of spend from before that instant, and two
   * phases' worth after it. Returns the root and the instant, so a case can
   * re-claim the lock at the same window.
   */
  async function fixture(
    prefix: string,
    pid: number,
  ): Promise<{ dir: string; runStart: number }> {
    const dir = await mkFixtureRoot(prefix);
    const flumeDir = join(dir, ".flume");
    const runStart = Date.now() - 60_000;
    // Ticks of the run, and one tick from before it: the stale row's phase
    // name is what proves the window bounds the fold rather than the log
    // simply being short.
    await writeTickVerdict(
      flumeDir,
      verdict("previous-run", runStart - 60_000, [
        invocation({ turns: 999, costUsd: 99 }),
      ]),
    );
    await writeTickVerdict(
      flumeDir,
      verdict("plan", runStart + 1_000, [
        invocation({
          turns: 4,
          durationMs: 1_000,
          inputTokens: 10,
          outputTokens: 20,
          cacheCreationInputTokens: 30,
          cacheReadInputTokens: 40,
          costUsd: 0.5,
        }),
      ]),
    );
    await writeTickVerdict(
      flumeDir,
      verdict("build", runStart + 2_000, [
        invocation({
          turns: 3,
          durationMs: 500,
          inputTokens: 5,
          outputTokens: 6,
          cacheCreationInputTokens: 7,
          cacheReadInputTokens: 8,
          costUsd: 0.125,
        }),
        invocation({
          turns: 3,
          durationMs: 500,
          inputTokens: 5,
          outputTokens: 6,
          cacheCreationInputTokens: 7,
          cacheReadInputTokens: 8,
          costUsd: 0.125,
        }),
      ]),
    );
    await claim(dir, pid, runStart);
    return { dir, runStart };
  }

  /**
   * Record `pid` in `loop.pid` as having claimed the lock at `at`, through
   * the supervisor's own renderer rather than a second spelling of the lock's
   * shape here. The file's mtime is pushed the *other* way — well before the
   * stated instant — so a reader that went back to the mtime widens the
   * window instead of narrowing it, and every case below reds rather than
   * passing on a coincidence.
   */
  async function claim(dir: string, pid: number, at: number): Promise<void> {
    const pidPath = join(dir, ".flume", "loop.pid");
    await writeFile(pidPath, renderPidClaim(pid, new Date(at)), "utf8");
    const mtime = new Date(at - MTIME_BACKDATE_MS);
    await utimes(pidPath, mtime, mtime);
  }

  /**
   * The spend lines in `out` — read as their own block, never as a search
   * over the whole rendered listing, which quotes fixture paths and phase
   * names of its own (`.claude/rules/posture-sweep.md`, "A negative
   * assertion over a whole rendered artifact").
   */
  const spendLines = (out: string): string[] =>
    out.split("\n").filter((l) => l.startsWith("agent usage this run:"));

  it("flume status totals the live run's agent usage by phase", async () => {
    // The vitest worker itself plays the live supervisor — its own pid is
    // guaranteed alive for the duration of this test.
    const { dir } = await fixture("flume-status-spend-live-", process.pid);
    try {
      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(0);
      expect(r.out).toContain(`supervisor pid ${process.pid} live`);
      const lines = spendLines(r.out);
      expect(lines).toHaveLength(1);
      const line = lines[0] ?? "";
      // One entry per phase that invoked an agent this run, in the order each
      // first did, each carrying that phase's rows summed.
      expect(line).toContain(
        "plan ×1 (4 turns, 1.0s, 10 in / 20 out tokens, " +
          "30 cache-write / 40 cache-read, $0.5000)",
      );
      expect(line).toContain(
        "build ×2 (6 turns, 1.0s, 10 in / 12 out tokens, " +
          "14 cache-write / 16 cache-read, $0.2500)",
      );
      expect(line.indexOf("plan ×1")).toBeLessThan(line.indexOf("build ×2"));
      // The window is the run's, not the log's: the tick from before the
      // claim is another run's money.
      expect(line).not.toContain("previous-run");
      expect(line).not.toContain("999");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  /**
   * Which instant bounds the window — the claim the supervisor stated, never
   * the lock file's mtime. Nothing contracts that mtime: an archive restore,
   * a backup tool, a `touch`, or a copy of the state root moves it under a
   * live run, and the window moves with it.
   *
   * The fixture's lock states `runStart` and carries an mtime two minutes
   * earlier, on the far side of the stale row. One reading folds the previous
   * run's money into this one's; the other does not. The case asserts which.
   */
  it("flume status bounds the live run's spend to the instant the lock states", async () => {
    const { dir, runStart } = await fixture(
      "flume-status-spend-stated-",
      process.pid,
    );
    try {
      // Non-vacuity, and the whole point of the case: the two candidate
      // instants really do disagree, and the stale row sits between them.
      const { mtimeMs } = await stat(join(dir, ".flume", "loop.pid"));
      expect(mtimeMs).toBeLessThan(runStart - 60_000);

      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(0);
      const lines = spendLines(r.out);
      expect(lines).toHaveLength(1);
      const line = lines[0] ?? "";
      // Dated after the stated claim: this run's.
      expect(line).toContain("plan ×1");
      expect(line).toContain("build ×2");
      // Dated before it, and after the mtime: the previous run's money, which
      // an mtime-bounded window would have folded in here.
      expect(line).not.toContain("previous-run");
      expect(line).not.toContain("999");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  /**
   * The lock a flume before 0.17 wrote states no instant, so there is no
   * window — and a live run's spend is withheld with a word on stderr rather
   * than totalled over every run the log holds (`docs/MIGRATING-0.17.md`).
   *
   * The word names the lock it read by path, the way this verb's own
   * loop-lock refusal does: the operator is being told to go roll a file, and
   * a relocatable state root means the artifact's bare name does not say
   * which one.
   */
  it("flume status names the resolved loop-lock path when it withholds the spend line", async () => {
    const { dir } = await fixture("flume-status-spend-bare-", process.pid);
    try {
      // The path the verb itself resolves, off the engine's own accessor —
      // never a second spelling by the tester's hand.
      const pidPath = loopLockPath(join(dir, ".flume"));
      // What the pre-0.17 supervisor left: the pid, and nothing under it.
      await writeFile(pidPath, String(process.pid), "utf8");

      const r = await runCli(dir, ["status"]);

      // Liveness is unaffected — the pid is still on the first line.
      expect(r.code).toBe(0);
      expect(r.out).toContain(`supervisor pid ${process.pid} live`);
      // Withheld, and named: never a total over an unbounded log, never
      // silence either (`.claude/rules/engineering.md`, "Loud or nothing").
      expect(spendLines(r.out)).toEqual([]);
      // The state root is relocatable, so the artifact's bare name leaves the
      // operator to guess which root the unbounded lock sits in — and nothing
      // else in this listing quotes the path for it, unlike the errno-carried
      // refusals above. The same spelling this verb's loop-lock refusal
      // prints, so one artifact reads one way throughout.
      expect(r.out).toContain(
        `[flume] status: loop lock at ${pidPath} states no claim instant`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  it("flume status prints no spend line when no supervisor is live", async () => {
    const { dir, runStart } = await fixture(
      "flume-status-spend-dead-",
      deadPid(),
    );
    try {
      const dead = await runCli(dir, ["status"]);

      expect(dead.code).toBe(0);
      expect(dead.out).toContain("loop.pid present, process dead — stale");
      expect(spendLines(dead.out)).toEqual([]);

      // Non-vacuity: the same rows, under a live claim at the same instant,
      // do print — so the absence above is the liveness arm rather than an
      // empty log (`.claude/rules/engineering.md`, *A green verdict is proven
      // non-vacuous*).
      await claim(dir, process.pid, runStart);
      const live = await runCli(dir, ["status"]);

      expect(live.code).toBe(0);
      expect(spendLines(live.out)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, SPAWN_BUDGET_MS);

  /**
   * spec/cli.md "Subcommand surface", `status`: the verb refuses only when a
   * file it must read is present and unreadable — and the verdict log is one
   * of those, because the alternative reading is a live run printed as one
   * that has spent nothing.
   */
  it("flume status exits EX_IOERR over a verdict log that is present and unreadable, instead of a run that spent nothing", async () => {
    const { dir } = await fixture("flume-status-spend-denied-", process.pid);
    try {
      // Non-vacuity: these rows print under this live claim before the log is
      // denied, so the refusal below is the denial's and not an empty log's.
      const before = await runCli(dir, ["status"]);
      expect(before.code).toBe(0);
      expect(spendLines(before.out)).toHaveLength(1);

      // Denied at the read path itself (`tests/helpers/denial.ts`): a stat
      // still finds the entry and the read fails non-ENOENT.
      denyFile(tickVerdictsLogPath(join(dir, ".flume")));

      const r = await runCli(dir, ["status"]);

      expect(r.code).toBe(EX_IOERR);
      expect(r.out).toContain("failed to read");
      expect(r.out).toContain("tick-verdicts.jsonl");
      expect(spendLines(r.out)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        // The claim path comes from the engine accessor, never a second
        // spelling of the tip-claims layout here.
        const claimPath = tipClaimPath(
          await gitCommonDir(repo.dir),
          "refs/heads/main",
        );
        await mkdir(dirname(claimPath), { recursive: true });
        await writeFile(claimPath, String(deadPid()), "utf8");
        // The claim is on disk *before* the loop runs. Without this the
        // absence below is an absence over an empty directory — green
        // whether the engine releases the claim, never takes one, or writes
        // it somewhere else entirely (`.claude/rules/engineering.md`, "A
        // green verdict is proven non-vacuous").
        expect(existsSync(claimPath)).toBe(true);
        // A chain, so the run this case is about is a real one: a `loop`
        // whose chain does not resolve ends mount-dead before it reaches
        // the baton at all.
        await writeRepoConfig(repo.dir, minimalChainSrc());

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);

        expect(r.code).toBe(0);
        expect(r.out).toContain("hibernating after 0 tick(s)");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
 * through it costs a fraction of a case, and different from
 * `DEFAULT_KILL_GRACE_MS` (`src/processTree.ts`), so an arm reading the number
 * a tick announces cannot match one that fell back to the engine's own value.
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
 * SIGKILL every pid this suite recorded that is still there, and return only
 * once none of them is in the process table. Teardown only: an arm that reds
 * before its assertions — the whole point of the parks above outlasting the
 * budget — must not leave a parked tree behind for the rest of the lane to
 * run alongside.
 *
 * The wait is the point. A signal is delivered, not completed, so a teardown
 * that removed its scratch trees in the same breath walked them while a
 * supervisor, tick child or agent was still exiting inside — the removal
 * reds `ENOTEMPTY` on whatever that writer recreated, attributed to whichever
 * case happened to run it (`.claude/rules/engineering.md`, "Loud or nothing":
 * gone is observed here, by name, rather than assumed downstream).
 *
 * Signal the whole set before waiting on any of it: waiting on a parent while
 * its child is still unsignalled gives that child time to write more of the
 * tree the caller is about to remove. One deadline over the set rather than
 * one per pid, for the same reason the hooks below share a budget.
 */
async function reapAll(pids: readonly (number | undefined)[]): Promise<void> {
  const known = [
    ...new Set(pids.filter((pid): pid is number => pid !== undefined)),
  ];
  for (const pid of known) {
    if (!processAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // raced its own exit — gone is the outcome either way
    }
  }
  await waitFor(
    `the signalled pids (${known.join(", ")}) to leave the process table`,
    () => (known.some((pid) => processAlive(pid)) ? undefined : "gone"),
  );
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
  /**
   * `loop.pid`'s contents, verbatim, read while the supervisor still held it
   * — the statement a real live `flume loop` wrote, for an arm judging what
   * the lock says rather than what it releases.
   */
  lockStatement: string;
  grandchildPid: number | undefined;
  loopPidPath: string;
  claimPath: string;
  exited: Promise<void>;
  out: () => string;
  cleanup: () => Promise<void>;
}> {
  const repo = await makeScratchRepo("flume-cli-repo-", "main");
  const scratch = await mkTempDir("flume-signalled-loop-");
  let parkedPid: number | undefined;
  let grandchildPid: number | undefined;
  let loop: ReturnType<typeof spawn> | undefined;
  // Recorded lazily as each pid is learned, so the hook can finish a teardown
  // this function never reached — and so this run's own cleanup reaps exactly
  // what it got as far as learning, rather than a second list kept by hand
  // beside this one, which is how the supervisor's own pid came to be one the
  // hook killed and the cleanup below left standing over its `rm`.
  const mine: (number | undefined)[] = [];
  const record = <T extends number | undefined>(pid: T): T => {
    signalledPids.push(pid);
    mine.push(pid);
    return pid;
  };
  const cleanup = async (): Promise<void> => {
    await reapAll(mine);
    await rm(scratch, { recursive: true, force: true });
    await repo.cleanup();
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
      (
        await waitFor(
          `the loop supervisor's pid at ${loopPidPath}`,
          () => pidClaimIn(loopPidPath),
        )
      ).pid,
    );
    // Captured under the live supervisor: past this function the run is
    // signalled and the file is gone, so an arm about the lock's contents
    // has nothing left to read.
    const lockStatement = readFileSync(loopPidPath, "utf8");
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
      lockStatement,
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
  afterEach(async () => {
    await reapAll(signalledPids.splice(0));
  });

  /**
   * What the lock *says*, beside the arms below about what it releases. The
   * statement is the real supervisor's own — a live `flume loop`, mid-tick,
   * read off disk before anything signalled it — so nothing here re-authors
   * the writer's vocabulary (`.claude/rules/engineering.md`, *A seam gate
   * reads what the real writer wrote*).
   *
   * Line one is the compatibility claim and line two is the new fact: every
   * liveness reader takes the pid where it has always been, and the one
   * reader that needs the run's start reads an instant the supervisor stated
   * rather than the file's mtime, which no writer contracts.
   */
  it(
    "the loop lock records the pid on the first line and the claim instant on the second",
    async () => {
      const before = Date.now();
      const run = await signalledLoopRun({});
      try {
        const [pidLine, atLine, ...rest] = run.lockStatement.split("\n");

        // Line one, and the pid is the *whole* of it: a reader taking the
        // file entire no longer gets a number, which is the break this shape
        // costs across versions (`docs/MIGRATING-0.17.md`).
        expect(pidLine).toBe(String(run.supervisorPid));
        expect(Number(run.lockStatement)).toBeNaN();

        // Line two: an instant, round-tripping as ISO-8601, dated inside this
        // run's own window rather than at the epoch or at a default 0.
        expect(atLine).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
        const atMs = Date.parse(atLine ?? "");
        expect(atMs).toBeGreaterThanOrEqual(before - 1_000);
        expect(atMs).toBeLessThanOrEqual(Date.now() + 1_000);

        // Two lines and a trailing newline — nothing further for a reader to
        // take a third fact from.
        expect(rest).toEqual([""]);

        // Non-vacuity, and what makes line one's pid the supervisor's rather
        // than a number this suite parsed out of a file and compared to
        // itself: the driver signalled exactly that pid, and the run it
        // spawned ended. A first line naming anything else leaves the parked
        // tick running and this wait blows the case's budget.
        await run.exited;
      } finally {
        await run.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

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
 * A chain whose agent is the shipped `claudeCode` provider
 * (`src/claudeCode.ts`)
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
 * the output collected so far, the exit as a promise, and the cleanup its
 * caller owns.
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
  }>;
  out: () => string;
  cleanup: () => Promise<void>;
}> {
  const repo = await makeScratchRepo("flume-cli-repo-", "main");
  const scratch = await mkTempDir("flume-signalled-tick-");
  let agentPid: number | undefined;
  let grandchildPid: number | undefined;
  let tick: ReturnType<typeof spawn> | undefined;
  // Recorded lazily as each pid is learned, as the loop driver above records
  // its own, and for the same two reasons: the hook can finish a teardown
  // this function never reached, and this run's cleanup reaps the tick
  // process the tsx handle is not rather than a hand-kept second list.
  const mine: (number | undefined)[] = [];
  const record = <T extends number | undefined>(pid: T): T => {
    signalledPids.push(pid);
    mine.push(pid);
    return pid;
  };
  const cleanup = async (): Promise<void> => {
    await reapAll(mine);
    await rm(scratch, { recursive: true, force: true });
    await repo.cleanup();
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
      (
        await waitFor(
          `the bare tick to record its pid in the tip claim at ${claimPath}`,
          () => pidClaimIn(claimPath),
        )
      ).pid,
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

    const exited = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolveExit) => {
      tick?.on("exit", (code, signal) => resolveExit({ code, signal }));
    });
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
  afterEach(async () => {
    await reapAll(signalledPids.splice(0));
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
      // Non-vacuity for the number read below: a tick naming the engine's
      // own default would satisfy a `toContain` over any grace that happened
      // to equal it, so the declared one must differ from it.
      expect(DECLARED_GRACE_MS).not.toBe(DEFAULT_KILL_GRACE_MS);

      const run = await signalledBareTickRun({
        ignoreSigterm: true,
        killGraceMs: DECLARED_GRACE_MS,
      });
      try {
        // Which grace bounded the wait, read off the tick's own account of
        // entering it rather than off how long it took — the same line the
        // announcement arm below reads. It is printed as the wait opens, so
        // it is collected whether the escalation has landed yet or not, and
        // nothing here is sized for how fast the host gets there.
        const line = await waitFor(
          "the tick to announce the wait it is entering",
          () =>
            run
              .out()
              .split("\n")
              .find((l) => l.includes("signalled; waiting for")),
        );

        await run.exited;

        // The agent swallowed the SIGTERM and would have parked past this
        // case's whole budget, so reaching here at all is the escalation.
        expect(processAlive(run.agentPid)).toBe(false);
        expect(existsSync(run.claimPath)).toBe(false);
        // And the wait that escalation ended was the one this chain declared,
        // named with the knob that declared it: a tick falling back to the
        // engine default announces a different number and reds here.
        expect(line).toContain(`${DECLARED_GRACE_MS}ms`);
        expect(line).toContain("supervisorPolicy.killGraceMs");
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

/**
 * A chain that records every application of its factory: one byte appended to
 * `countPath` per call, so a process's count is that file's length.
 *
 * The append sits in the factory body rather than at module scope. A module is
 * evaluated once per process whatever the engine does with it
 * (`.claude/rules/platform-facts.md`, "Node's ESM registry is keyed by
 * resolved URL and cannot be evicted"), so a module-scope append would read 1
 * however many times the factory was applied — the count this case exists to
 * see.
 */
function factoryCountingChainSrc(countPath: string): string {
  return (
    `import { appendFileSync } from "node:fs";\n` +
    `export default () => {\n` +
    `  appendFileSync(${JSON.stringify(countPath)}, "x");\n` +
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
 * `.claude/rules/engineering.md` *A fact the engine holds is reported, never
 * rediscovered*: a `flume tick` reads the grace its signal handler announces
 * off `Dispatcher.agentKillGraceMs` rather than resolving a chain of its own
 * beside the one `tick` resolves. The count is what holds that — the
 * handler's line is pinned above, and a second resolve beneath it would print
 * the very same number.
 */
describe("flume tick — one chain application per process (ONE-CHAIN-APPLICATION-PER-TICK-PROCESS)", () => {
  it(
    "a bare flume tick applies the chain factory once for the process",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      // Outside the repo: the count is the subject, never something the tick
      // could read as a working-tree change of its own.
      const scratch = await mkTempDir("flume-factory-count-");
      try {
        const countPath = join(scratch, "applications");
        await writeRepoConfig(repo.dir, factoryCountingChainSrc(countPath));

        // Nothing awake, so the tick hibernates without invoking an agent:
        // what is left is exactly the applications the process itself makes.
        const r = await runCli(repo.dir, ["tick"]);

        expect(r.code).toBe(0);
        expect(r.out).toContain("hibernating");
        // Read, never defaulted — an absent file is a tick that never applied
        // the factory at all, which reds here rather than passing as zero.
        expect(readFileSync(countPath, "utf8")).toBe("x");
      } finally {
        await rm(scratch, { recursive: true, force: true });
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});

/**
 * spec/loop.md "Exit codes — the run never lies to CI": `EX_IOERR` is
 * cross-cutting, and `flume tick` reaches it on two files. The state root at
 * bay discovery is the one the verb already classified; the verdict history
 * is this suite's subject — `writeTickVerdict` reads that log before
 * appending the tick's own record, and `readTickVerdicts` refuses a log that
 * is present and unreadable rather than answering "no history"
 * (src/tickVerdict.ts). Uncaught, that throw escaped to `main().catch` and
 * an operator read a raw stack and an exit 1 over a tick whose work had
 * already landed.
 *
 * Every arm is driven for real, once for the suite: two `flume tick` runs
 * that reach the two reads, and one `flume tick --help`, so the row an
 * operator reads is compared against the refusals the verb really takes
 * rather than against a hand copy (`.claude/rules/engineering.md`, *A seam
 * gate reads what the real writer wrote*).
 */
describe("flume tick — EX_IOERR over an unreadable verdict history (spec/loop.md \"Exit codes — the run never lies to CI\")", () => {
  let repo: ScratchRepo;
  /** The tick that recorded cleanly, before the history was denied. */
  let recorded: { out: string; code: number };
  /** Whether that tick left a history log behind — the denial's subject. */
  let historyRecorded = false;
  /** The same tick again, over a history denied at its own read path. */
  let refused: { out: string; code: number };
  /** A tick whose bay discovery cannot stat the state root. */
  let undiscoverable: { out: string; code: number };
  /** What `flume tick --help` really printed. */
  let helpOut = "";

  beforeAll(async () => {
    repo = await makeScratchRepo("flume-tick-verdict-io-", "main");
    await writeRepoConfig(repo.dir, stubbedAgentChainSrc());
    const flumeDir = join(repo.dir, ".flume");

    new Baton(flumeDir).wake("probe");
    recorded = await runCli(repo.dir, ["tick"]);
    historyRecorded = existsSync(tickVerdictsLogPath(flumeDir));

    // Denied at the read path itself (`tests/helpers/denial.ts`): the stat
    // still finds the entry and the read fails non-ENOENT, which is the
    // split `readTickVerdicts` must refuse on. The phase is woken again
    // because the chain's handoff declares nothing.
    denyFile(tickVerdictsLogPath(flumeDir));
    new Baton(flumeDir).wake("probe");
    refused = await runCli(repo.dir, ["tick"]);

    // The other file the row names, in a fixture of its own: a
    // self-referential state root raises ELOOP at the first stat bay
    // discovery makes, which no chain load or baton read is reached past.
    const bay = await mkFixtureRoot("flume-tick-bay-io-");
    try {
      // The root plants a real bay of its own; this arm's subject is a bay
      // that cannot be stat'd at all, so the planted one is replaced rather
      // than nested under.
      const bayPath = join(bay, STATE_ROOT_DIRNAME);
      await rm(bayPath, { recursive: true, force: true });
      await symlink(STATE_ROOT_DIRNAME, bayPath);
      undiscoverable = await runCli(bay, ["tick"]);
    } finally {
      await rm(bay, { recursive: true, force: true });
    }

    helpOut = (await runCli(process.cwd(), ["tick", "--help"])).out;
  }, SPAWN_BUDGET_MS);

  afterAll(async () => {
    await repo?.cleanup();
  });

  it("flume tick exits 74 when the verdict history is present and unreadable", () => {
    // Non-vacuity: the same chain over a readable history ran its phase and
    // recorded one, so the refusal below is the denial's and not a tick that
    // never got as far as its own verdict (`.claude/rules/engineering.md`,
    // *A green verdict is proven non-vacuous*).
    expect(recorded.code).toBe(0);
    expect(recorded.out).toMatch(/tick → probe/);
    expect(historyRecorded).toBe(true);

    expect(refused.code).toBe(EX_IOERR);
  });

  it("flume tick's verdict refusal names the history file and says the tick's own work already landed", () => {
    expect(refused.code).toBe(EX_IOERR);
    // The engine's own name for the artifact, never a second spelling here.
    expect(refused.out).toContain(STATE_ROOT_NAMES.tickVerdictsLog);
    expect(refused.out).toContain("failed to read");
    // And what 74 does not mean: the phase ran and its summary is in this
    // same output, so the refusal has work to disclaim.
    expect(refused.out).toMatch(/tick → probe/);
    expect(refused.out).toContain("already landed");
  });

  it("flume tick --help names exit 74 and the files that reach it", () => {
    // Both arms reached their read for real, so the row is compared against
    // causes the verb really has.
    expect(undiscoverable.code).toBe(EX_IOERR);
    expect(undiscoverable.out).toContain("bay discovery");
    expect(refused.code).toBe(EX_IOERR);

    const row = helpExitCodeRow(helpOut, EX_IOERR);
    // Each file as the row spells it — the separator is the help text's,
    // never this host's, since these are paths the page writes and not paths
    // this process composed. The state root is read as its own backticked
    // token, so the log's own path cannot stand in for it.
    expect(row).toContain(`\`${STATE_ROOT_DIRNAME}\``);
    expect(row).toContain(
      `${STATE_ROOT_DIRNAME}/${STATE_ROOT_NAMES.tickVerdictsLog}`,
    );
    // The read is this row's, not the block's: the neighbouring rows carry
    // causes of their own, and a reader handing back everything would pass
    // here over a 74 row that named nothing.
    expect(row).not.toContain("Mount-dead");
  });
});

/**
 * The other half of bay discovery's `EX_IOERR`: the walk answers the nearest
 * `.flume` without consulting git, so a bay planted below the working-tree
 * root resolves a `repoRoot` git has never heard of. Every path composed from
 * it — `stateRootRel`, the fence globs, the queue pathspec — then names files
 * in an alphabet git does not use, and each read comes back empty rather than
 * wrong, which is the silence `.claude/rules/engineering.md`, *Loud or
 * nothing* refuses.
 *
 * Driven through a real repository with a real nested bay, and paired with
 * the same verb at the top level so the refusal is the disagreement's and not
 * a fixture that could never have answered (`.claude/rules/engineering.md`,
 * *A green verdict is proven non-vacuous*).
 */
it(
  "flume refuses a bay root that is not the git top-level rather than composing paths against it",
  async () => {
    const repo = await makeScratchRepo("flume-nested-bay-", "main");
    try {
      const nestedBayRoot = join(repo.dir, "sub");
      await mkdir(join(nestedBayRoot, STATE_ROOT_DIRNAME), { recursive: true });

      const refused = await runCli(nestedBayRoot, ["status"]);
      expect(refused.code).toBe(EX_IOERR);
      // Both roots, and the top-level as a token of its own: the nested bay
      // carries the top-level as a path prefix, so a bare `toContain` on it
      // would hold over an output that named only the bay. Every mention of
      // the bay is struck first, and the top-level must still be there.
      expect(refused.out).toContain(nestedBayRoot);
      expect(refused.out.split(nestedBayRoot).join("")).toContain(repo.dir);

      // Non-vacuity: the same verb over the same repository, run where the
      // bay and git agree, answers rather than refusing — so the code above
      // is the disagreement's.
      const answered = await runCli(repo.dir, ["status"]);
      expect(answered.code).toBe(0);
      expect(answered.out).toContain("hibernating");
    } finally {
      await repo.cleanup();
    }
  },
  SPAWN_BUDGET_MS,
);

describe("flume loop — stop flag refuses at start (spec/loop.md \"Graceful stop — the stop flag\")", () => {
  it(
    "refuses before any tick, exit 1, naming the flag path — no lock taken, no tick runs",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, stubbedAgentChainSrc());
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
    "a relocated state root refuses at start too, on its own stop flag",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const relocated = join(repo.dir, "state");
        await mkdir(relocated, { recursive: true });
        const stopPath = join(relocated, "stop");
        await writeFile(stopPath, "", "utf8");

        const r = await runCli(repo.dir, ["loop", "--max", "3"], {
          ...hermeticEnv(),
          FLUME_DIR: relocated,
        });

        expect(r.code).toBe(1);
        expect(r.out).toContain(stopPath);
        expect(r.out).not.toContain("reached --max");
        expect(existsSync(join(relocated, "loop.pid"))).toBe(false);
        // The refusal keys on the resolved root, not the bay: the bay's own
        // flag is absent and its lock was never taken.
        expect(existsSync(join(repo.dir, ".flume", "loop.pid"))).toBe(false);
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, stubbedAgentChainSrc());
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
    "a relocated state root refuses at start too, on its own marker",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, stubbedAgentChainSrc());
        const relocated = join(repo.dir, "state");
        await mkdir(relocated, { recursive: true });
        const { markerPath } = await seedInterruptedMerge(
          repo.dir,
          relocated,
        );

        const r = await runCli(repo.dir, ["loop", "--max", "3"], {
          ...hermeticEnv(),
          FLUME_DIR: relocated,
        });

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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, stubbedAgentChainSrc());
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      const mergingPath = join(repo.dir, ".flume", "merging");
      try {
        await writeRepoConfig(repo.dir, stubbedAgentChainSrc());
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
 * `Phase.ts` "Concurrency", `spec/pending.md` "The fork-resolution seam").
 */
function fanoutCheckChainSrc(
  buildWritablePaths: string[],
  buildChannelPaths: string[] = [],
  pendingDir?: string,
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
    (pendingDir !== undefined
      ? `  pendingDir: ${JSON.stringify(pendingDir)},\n`
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
  await seedQueue(join(root, ".flume", rel), entries);
}

describe("flume check (spec/cli.md §Subcommand surface)", () => {
  it("exits EX_DATAERR naming the entry file on a schema violation", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      // The entry's own file, which is what a producer opens to repair it.
      expect(r.out).toContain(`[${entryFileName("BAD")}]`);
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("exits EX_DATAERR naming entry + offending paths on a fence violation", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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

  it("exits 0 on a clean queue", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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

  it("honors a chain-declared pendingDir (CHAIN-PENDINGPATH) — reads and reports the custom location, not plan/pending", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      const customRel = join("custom", "queue");
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
      expect(existsSync(resolvePendingDir(join(repo.dir, ".flume")))).toBe(
        false,
      );
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("exits 0 when the queue directory is absent — nothing to check", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, fanoutCheckChainSrc(["src/**"]));

      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(0);
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("exits EX_IOERR naming the error on a non-ENOENT queue read failure, instead of reading it as absent", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, fanoutCheckChainSrc(["src/**"]));
      // A plain file in place of the queue directory reproduces a non-ENOENT
      // listing failure (ENOTDIR) without relying on permission bits a
      // root-run test could bypass (`.claude/rules/engineering.md`, "Loud or
      // nothing").
      const queueDir = resolvePendingDir(join(repo.dir, ".flume"));
      await mkdir(dirname(queueDir), { recursive: true });
      await writeFile(queueDir, "not a directory\n", "utf8");

      const r = await runCli(repo.dir, ["check"]);
      expect(r.code).toBe(EX_IOERR);
      expect(r.out).not.toContain("absent");
      expect(r.out).toContain("failed to read");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("mutates no baton flag and invokes no agent", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      const entryPath = join(
        resolvePendingDir(join(repo.dir, ".flume")),
        entryFileName("CLEAN"),
      );
      const before = await readFile(entryPath, "utf8");

      const r = await runCli(repo.dir, ["check"]);

      expect(r.code).toBe(0);
      // No Baton constructed — unlike `status`, whose Baton() call mkdirs
      // awake/ as a side effect even for an all-hibernating read.
      expect(existsSync(join(repo.dir, ".flume", "awake"))).toBe(false);
      // Read-only: the queue itself is byte-identical afterward.
      expect(await readFile(entryPath, "utf8")).toBe(before);
      // No worktree/agent machinery ever ran.
      expect(existsSync(join(repo.dir, ".flume", "worktrees"))).toBe(false);
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("exits mount-dead (69) when no chain resolves to check the consumer fence against", async () => {
    // No .flume/chain.ts written.
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      const queuePath = resolvePendingDir(flumeDir, chain.pendingDir);
      const gateResult = await pendingGate({ targetFence: consumer! }).run({
        cwd: repo.dir,
        flumeDir,
        stateRootRel: computeStateRootRel(repo.dir, flumeDir),
        pendingDir: queuePath,
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, stubbedAgentChainSrc());
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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

/**
 * `flume tick --phase <name>` — the other half of gh#1's refusal above. A
 * phase is named with a flag, and the named phase runs whatever the baton
 * says: the supervisor spawns one child per phase it starts and tells each
 * one what it is for (spec/loop.md, *Baton — presence wakes, absence
 * hibernates*), which a child re-reading the flags could not honour.
 *
 * Both arms read "did an agent run" off a marker the fixture's agent writes
 * when it is invoked, rather than off the process output — a decidable file
 * either way, where a negative read of a whole stream turns on whatever else
 * the stream happens to quote (`.claude/rules/posture-sweep.md`, *Standing
 * lenses*).
 */
describe("flume tick --phase <name> (spec/loop.md §Baton — presence wakes, absence hibernates)", () => {

  it(
    "flume tick --phase runs the named phase when no flag is awake",
    async () => {
      const repo = await makeScratchRepo("flume-tick-phase-", "main");
      try {
        const marker = join(repo.dir, "agent-ran");
        await writeRepoConfig(repo.dir, markerAgentChainSrc(marker));
        // Nothing is woken: the baton is empty for both runs below.
        const awakeFlag = join(repo.dir, ".flume", "awake", "probe");

        // The control the claim rests on — bare, this same repo hibernates
        // and invokes nothing, so the run below is the flag's doing rather
        // than a phase that would have ticked anyway.
        const bare = await runCli(repo.dir, ["tick"]);
        expect(bare.code).toBe(0);
        expect(bare.out).toContain("no phases awake; hibernating");
        expect(existsSync(marker)).toBe(false);

        const named = await runCli(repo.dir, ["tick", "--phase", "probe"]);

        expect(named.code).toBe(0);
        expect(named.out).toMatch(/tick → probe/);
        // The agent really ran, over an empty baton.
        expect(existsSync(marker)).toBe(true);
        // And the flag the tick never needed is not one it left behind: the
        // named phase is slept after it runs, like any other.
        expect(existsSync(awakeFlag)).toBe(false);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume tick --phase naming a phase the chain does not declare exits 2, naming the phases it does",
    async () => {
      const repo = await makeScratchRepo("flume-tick-phase-", "main");
      try {
        const marker = join(repo.dir, "agent-ran");
        await writeRepoConfig(repo.dir, markerAgentChainSrc(marker));
        // A phase standing awake, so a refusal that silently fell back to
        // the baton would tick `probe` and be visible as such.
        new Baton(join(repo.dir, ".flume")).wake("probe");

        const r = await runCli(repo.dir, ["tick", "--phase", "ghost"]);

        // Usage-shaped: argv the surface cannot honor as typed, which is the
        // code `wake`, `sleep` and `render` already answer an undeclared
        // phase name with (spec/cli.md, *Subcommand surface*). Not a harness
        // error — nothing about the mount or the tick failed.
        expect(r.code).toBe(2);
        expect(r.out).toContain("no phase named 'ghost'");
        // Naming what the chain does declare is the refusal's own job — an
        // operator reading it never re-opens chain.ts to find the spelling.
        expect(r.out).toContain("this chain declares probe");
        // No agent ran, and the awake flag was neither ticked nor cleared.
        expect(existsSync(marker)).toBe(false);
        expect(
          existsSync(join(repo.dir, ".flume", "awake", "probe")),
        ).toBe(true);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});


describe("flume loop refuses a stray positional past --max/<value> (spec/cli.md §Subcommand surface)", () => {
  it(
    "flume loop <positional> exits 2 rather than silently starting a run",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
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

  it("the bare friction listing omits a name beginning with a dot", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
      const frictionDir = join(repo.dir, ".flume", "friction");
      await mkdir(frictionDir, { recursive: true });
      // A real note beside the placeholder git forces a consumer to create
      // for an otherwise-empty, gitignored channel dir (spec/chain.md,
      // "`Chain.friction` — the declared friction channel").
      await writeFile(join(frictionDir, "a.md"), "note a\n");
      await writeFile(join(frictionDir, ".gitkeep"), "");

      const r = await runCli(repo.dir, ["friction"]);
      expect(r.code).toBe(0);
      // The listing is non-vacuous — the real note is there — and the
      // placeholder is not a row of it.
      expect(r.out).toMatch(/a\.md\s+7\s+\d{4}-\d{2}-\d{2}T.*Z/);
      expect(r.out.split("\n").filter((l) => l.includes(".gitkeep"))).toEqual(
        [],
      );
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("the friction read verb refuses a name beginning with a dot", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
      const frictionDir = join(repo.dir, ".flume", "friction");
      await mkdir(frictionDir, { recursive: true });
      // The placeholder genuinely exists and is a direct child, so the
      // refusal comes from the name alone, never from absence or scope.
      await writeFile(join(frictionDir, ".gitkeep"), "placeholder bytes");

      const named = await runCli(repo.dir, ["friction", ".gitkeep"]);
      const spelled = await runCli(repo.dir, ["friction", "./.gitkeep"]);
      const missing = await runCli(repo.dir, ["friction", "does-not-exist.md"]);
      expect(named.code).toBe(2);
      expect(named.code).toBe(missing.code);
      expect(named.out).toContain("no note named '.gitkeep'");
      expect(named.out).not.toContain("placeholder bytes");
      // A dot-evading spelling of the same direct child is refused too: the
      // test is on the resolved name, not on how the caller typed it.
      expect(spelled.code).toBe(2);
      expect(spelled.out).not.toContain("placeholder bytes");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("refuses usage-shaped (exit 2) naming Chain.friction when the chain declares no channel", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
      // No .flume/friction dir created — never written by any tick yet.

      const r = await runCli(repo.dir, ["friction"]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("flume friction refuses a name the channel's listing holds no note for as absent rather than unreadable", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
      const frictionDir = join(repo.dir, ".flume", "friction");
      await mkdir(frictionDir, { recursive: true });
      await writeFile(join(frictionDir, "a.md"), "note a\n");
      // A subdirectory of the channel: a direct child the listing's isFile()
      // filter omits, so the name it spells names no note. Nothing about the
      // channel is obstructed — the note beside it lists and reads — so the
      // only disposition left for the name is the absent one the help page
      // states, and an EX_IOERR here would be a read that never needed to
      // happen (`.claude/rules/engineering.md`, "The fix lands at the
      // mechanism").
      await mkdir(join(frictionDir, "subdir"), { recursive: true });

      // Non-vacuity: the listing is populated and the channel is readable, so
      // the refusal below is the name's and not the channel's.
      const bare = await runCli(repo.dir, ["friction"]);
      expect(bare.code).toBe(0);
      expect(bare.out).toContain("a.md");
      expect(bare.out).not.toContain("subdir");
      const sibling = await runCli(repo.dir, ["friction", "a.md"]);
      expect(sibling.code).toBe(0);
      expect(sibling.out).toContain("note a");

      const named = await runCli(repo.dir, ["friction", "subdir"]);
      expect(named.code).toBe(2);
      expect(named.out).toContain("no note named 'subdir'");
      expect(named.out).not.toContain("failed to read");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it.runIf(process.platform !== "win32")("exits EX_IOERR naming the error on a note read failure, instead of reporting 'no such note'", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
      const frictionDir = join(repo.dir, ".flume", "friction");
      await mkdir(frictionDir, { recursive: true });
      await writeFile(join(frictionDir, "note.md"), "note bytes\n");

      // Non-vacuity: the note reads before the channel is denied, so the
      // refusal below is the denial's and not a name the listing never held.
      const before = await runCli(repo.dir, ["friction", "note.md"]);
      expect(before.code).toBe(0);
      expect(before.out).toContain("note bytes");

      // Read without traverse on the channel dir: the descent stats it, the
      // listing still enumerates the note, and the open of it fails EACCES.
      // No permission-independent fixture reaches this arm — the note test is
      // the listing's own isFile(), so a directory, a symlink, or a device in
      // a note's place is refused as absent rather than read (the case above)
      // — so this declares its host, the precedent the stat-failure case
      // below and the `flume status` friction-line case share
      // (`.claude/rules/platform-facts.md`, *chmod denies nothing on win32*).
      await chmod(frictionDir, 0o444);

      const r = await runCli(repo.dir, ["friction", "note.md"]);
      expect(r.code).toBe(EX_IOERR);
      expect(r.out).not.toContain("no note named");
      expect(r.out).toContain("failed to read");
    } finally {
      await chmod(join(repo.dir, ".flume", "friction"), 0o755).catch(() => {});
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("flume friction refuses a named note whose declared channel is present and is not a directory", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
      // A plain file where the declared channel should be — the structural
      // denial that denies on every host (`.claude/rules/platform-facts.md`,
      // *chmod denies nothing on win32*), and the one fixture that separates
      // the read's errno from a proven absence: posix answers the note's own
      // read `ENOTDIR` and win32 answers it `ENOENT` (*win32 reports a path
      // through a non-directory as not found*), so only the descent from the
      // state root down to the channel refuses alike on both lanes. This is
      // the converse case that page sanctions: the reader under test carries
      // the descent, so obstructing the channel *is* the arm, not an
      // un-armed parent denial.
      await mkdir(join(repo.dir, ".flume"), { recursive: true });
      await writeFile(join(repo.dir, ".flume", "friction"), "not a dir\n");

      const r = await runCli(repo.dir, ["friction", "note.md"]);
      expect(r.code).toBe(EX_IOERR);
      // The refusal names the rung an operator has to go fix, and never the
      // absent reading the bare errno would have produced on win32.
      expect(r.out).toContain("is present but is not a directory");
      expect(r.out).not.toContain("no note named");
    } finally {
      await repo.cleanup();
    }
  }, SPAWN_BUDGET_MS);

  it("exits EX_IOERR naming the error on a non-ENOENT bare-list readdir failure, instead of listing empty", async () => {
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
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
    const repo = await makeScratchRepo("flume-cli-repo-", "main");
    try {
      await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "friction" }));
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
  // Baton.test.ts's "win32 MAX_PATH fix" precedent — `livePidClaimAt`
  // (`src/pidClaim.ts`) is the reference shape every loop.pid call site here
  // must match. The name
  // itself now comes from `loopLockPath` (src/paths.ts), so the pin is on the
  // accessor being read, not on a filename spelled here. Neither call site
  // folds its own path any more: one hands it to the stake (`stakePidClaim`,
  // `src/pidClaim.ts`, which folds the target and its dirname itself) and one
  // to the descent probe (`existsLoudUnder`, `src/fsProbe.ts`, which folds the
  // rungs it walks and the leaf it stats), so what these cases hold is that
  // each binding reaches a callee that owns the fold and no fs call of this
  // file's own.
  const src = readFileSync(CLI_SRC_PATH, "utf8");

  it("reads the status-check loop-lock path (statusLockPath) off loopLockPath and probes it under the state root, which folds it", () => {
    expect(src).toMatch(/const statusLockPath = loopLockPath\(flumeDir\);/);
    // The probe that proves the absence also owns the fold — a
    // `namespacedJoin` at this site would hand the descent a path in win32's
    // namespaced alphabet to take `relative` against.
    expect(src).toMatch(
      /existsLoudUnder\("loop lock", flumeDir, statusLockPath\)/,
    );
  });

  it("takes the loop lock through the shared stake, and addresses lockPath with no fs call of its own", () => {
    // Vacuity: the binding this case is about, off the engine's own accessor.
    expect(src).toMatch(/const lockPath = loopLockPath\(flumeDir\);/);
    expect(src).toMatch(/stakePidClaim\(lockPath\)/);
    // A write or an unlink of the lock here is the probe-then-write guard the
    // stake replaced — and an unfolded path reaching an fs call, since the
    // win32 fold now lives at the stake (`namespacedJoin`, src/pidClaim.ts).
    expect(src).not.toMatch(/writeFileSync\(lockPath/);
    expect(src).not.toMatch(/unlinkSync\(lockPath\)/);
    // Exactly one drop site: `dropLock`. The refused-tip-claim rollback and
    // the signal handlers all call it rather than releasing again, so a
    // second occurrence here means a second owner has grown back
    // (spec/loop.md "The loop lock and the tip claim").
    const releases = src.match(/loopLock\?\.release\(\)/g);
    expect(releases).not.toBeNull();
    expect(releases!.length).toBe(1);
  });

  it("every loopLockPath call in cli.ts binds a path a callee folds — the stake or the descent probe", () => {
    const uses = [...src.matchAll(/\bloopLockPath\(\w+\)/g)];
    expect(uses.length).toBeGreaterThan(1);
    let staked = 0;
    let probed = 0;
    for (const use of uses) {
      const before = src.slice(0, use.index!);
      if (/const lockPath = $/.test(before)) {
        staked += 1;
      } else if (/const statusLockPath = $/.test(before)) {
        probed += 1;
      } else {
        // Neither: a path this file spells and reaches disk with itself, which
        // is the read a too-long win32 path reports as absent.
        expect(before, `unfolded loopLockPath call: ${use[0]}`).toMatch(
          /const (?:lockPath|statusLockPath) = $/,
        );
      }
    }
    // Both arms populated, so neither direction is asserted over nothing.
    expect(staked).toBe(1);
    expect(probed).toBe(1);
  });
});

/**
 * The verbs' absent arms, over a state root that is present and unreachable.
 *
 * Each of these reads an artifact's absence as silence — no supervisor line,
 * no stop line, no claimed tip, no note filed — and each now proves that
 * absence by descending from a root it holds (`existsLoudUnder`,
 * `src/fsProbe.ts`) rather than off one stat's errno. A plain file above the
 * artifact answers that stat `ENOENT` on win32
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*), so the lane that reds without the descent is
 * the win32 one; what these cases hold on every host is that the verb refuses
 * rather than printing the reading an operator must never get — no supervisor
 * over a possibly-live loop, a run started over an unacknowledged stop, an
 * unclaimed tip.
 *
 * Which arm states the refusal is the verb's own ordering, and the two rooted
 * at the state root are reached only past `new Baton(flumeDir)`, whose
 * `mkdirSync` refuses this same root on both hosts. So the end-to-end claim
 * available at those two is the absence of the reading, and the rung each
 * refusal names is pinned where the descent lives
 * (`tests/fsProbe.test.ts`). The tip claim's root is git's common dir, which
 * nothing above that line touches — that one names its rung here.
 *
 * Denied structurally, at the *parent* on purpose: a reader that carries the
 * descent is exercised by nothing else (`tests/helpers/denial.ts`).
 */
describe("the absent arms — a state root present and not a directory", () => {
  it(
    "flume status refuses a loop lock whose state root is present and is not a directory",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const sealed = join(repo.dir, "state");
        await writeFile(sealed, "obstruction\n", "utf8");

        const r = await runCli(repo.dir, ["status"], {
          ...hermeticEnv(),
          FLUME_DIR: sealed,
        });

        // The verb refuses, and reports the root it could not descend.
        expect(r.code).not.toBe(0);
        expect(r.out).toContain(sealed);
        // And it reports *nothing* about the lock: neither a live supervisor,
        // nor a stale one, nor the silence that means no loop is running. The
        // refusal that lands first on a posix host is the awake-flag read
        // above this line, which `mkdir`s the same obstructed root — so what
        // this case pins at the verb is that no arm of it reads the root as
        // nothing there. The guard's own descent, and the rung its refusal
        // names, are `existsLoudUnder`'s own cover (`tests/fsProbe.test.ts`).
        expect(r.out).not.toMatch(/supervisor pid|loop\.pid present/);
        expect(r.out).not.toContain("hibernating");
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume loop refuses to start over a state root that is present and is not a directory, rather than taking a tick past it",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const sealed = join(repo.dir, "state");
        await writeFile(sealed, "obstruction\n", "utf8");

        const r = await runCli(repo.dir, ["loop", "--max", "1"], {
          ...hermeticEnv(),
          FLUME_DIR: sealed,
        });

        // No run starts, and the refusal names the root. Which arm states it
        // is the verb's own ordering: the dispatcher's awake-flag `mkdir`
        // refuses this root on both hosts (measured) before the stop-flag
        // guard beneath it is reached, so the guard's descent is covered where
        // it lives (`tests/fsProbe.test.ts`) and what this case holds at the
        // verb is that no reading of the flag lets a run begin.
        expect(r.code).not.toBe(0);
        expect(r.out).toContain(sealed);
        expect(r.out).not.toContain("reached --max");
        expect(r.out).not.toMatch(/tick \d+|stop flag present;/);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it(
    "flume status refuses a tip claim whose ancestor under the git common dir is present and is not a directory",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        // The claim nests under `<common dir>/flume`; nothing has staked one
        // here, so this is the directory a claim would be written into.
        const sealed = join(repo.dir, ".git", "flume");
        await writeFile(sealed, "obstruction\n", "utf8");

        const r = await runCli(repo.dir, ["status"]);

        expect(r.code).toBe(EX_IOERR);
        // Non-vacuity: the verb reached this line, so the refusal is the tip
        // claim's arm and not something above it.
        expect(r.out).toContain("hibernating");
        expect(r.out).toContain("tip claim at");
        expect(r.out).toContain(
          `tip claim is unreadable: ${sealed} is present but is not a directory`,
        );
        // Never the reading that says the tip is nobody's.
        expect(r.out).not.toContain("tip claim present");
        expect(r.out).not.toMatch(/tip claimed by pid/);
      } finally {
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, stubbedAgentChainSrc());
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        await writeRepoConfig(repo.dir, realStopVerbChainSrc("probe"));
        const flumeDir = join(repo.dir, ".flume");
        const baton = new Baton(flumeDir);
        baton.wake("probe");

        // The phase re-wakes itself every tick, so absent the flag this run
        // burns all 4 iterations. The agent runs the real `flume stop` from
        // inside the first child tick; the supervisor's per-iteration check
        // (src/loopSupervisor.ts) is the only thing that can see it.
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
 * A chain whose agent calls the runtime's own `liveLoopPid`
 * (`src/pidClaim.ts`) —
 * the reader side of the one-supervisor lock — from inside the child tick,
 * and records what it read. The writer is the real `flume loop` that spawned
 * that child: nothing here writes or names a pidfile.
 */
function loopLockReaderChainSrc(phaseName: string, observedPath: string): string {
  const pidClaimSrc = new URL("../src/pidClaim.ts", import.meta.url).href;
  return (
    `import { writeFileSync } from "node:fs";\n` +
    `import { liveLoopPid } from ${JSON.stringify(pidClaimSrc)};\n` +
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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      const outDir = await mkTempDir("flume-loop-lock-read-");
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

describe("state root layout — an undeclared Chain.pendingDir is one file for every consumer", () => {
  it(
    "the queue at the default location is the one `flume check` validates and the one the dispatcher picks from",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      const wtDir = await mkTempDir("flume-queue-default-");
      try {
        // A fanout phase (the sole kind that picks from pending) on a chain
        // that declares no pendingDir. Worktree provisioning is pointed at
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
 * goes through (`mkFixtureRoot`, tests/helpers/fixtureRoot.ts), pinned against
 * the litter it exists to survive: a `.flume` planted in an ancestor the
 * fixture happens to live under, which is what a leaked `/tmp/.flume` is.
 * Each case carries its own control — the same CLI invocation from an
 * unrooted sibling, proving the planted bay is load-bearing rather than a
 * directory nothing ever reads.
 */
describe("CLI fixtures are rooted against an ancestor `.flume` (CLI-FIXTURE-ANCESTOR-PROOF)", () => {
  it("a `.flume` planted above the fixture does not change `flume status`'s verdict", async () => {
    const attic = await mkTempDir("flume-attic-");
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
 * spec/jobs.md "Runtime ignores" — every state root the runtime writes into
 * takes the runtime-owned `.gitignore` merge at every `loop` start. Without
 * it a fresh adopter (whose repo `.gitignore` was never hand-taught the
 * runtime's layout) commits tick artifacts.
 *
 * Driven through the real CLI with `--max 0`: the merge sits under the tip
 * claim and ahead of the startup sweep, both of which `--max 0` reaches
 * before stopping without spawning a child tick. The expectation reads
 * `RUNTIME_IGNORES` (`src/runtimeIgnores.ts`) rather than respelling the block, so a
 * line added there is asserted here by construction.
 */
describe("flume loop — runtime ignores at the default state root", () => {
  it(
    "a loop start merges the runtime ignores into the default state root's .gitignore",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        const ignorePath = join(repo.dir, ".flume", ".gitignore");
        // Nothing has seeded this root, so the file the merge must create
        // genuinely does not exist yet.
        expect(existsSync(ignorePath)).toBe(false);
        // A chain, so the run this case is about is a real one: a `loop`
        // whose chain does not resolve ends mount-dead before it reaches
        // the baton at all.
        await writeRepoConfig(repo.dir, minimalChainSrc());

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("hibernating after 0 tick(s)");

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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      try {
        // Declared with a backslash and a doubled trailing slash: the entry
        // that lands must be the `frictionIgnoreEntry`
        // (`src/runtimeIgnores.ts`)
        // normalization the merge applies, not whatever the chain wrote.
        await writeRepoConfig(repo.dir, minimalChainSrc({ friction: "scratch\\friction//" }));
        const ignorePath = join(repo.dir, ".flume", ".gitignore");

        const r = await runCli(repo.dir, ["loop", "--max", "0"]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("hibernating after 0 tick(s)");

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
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
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
        // A chain, so the run this case is about is a real one: a `loop`
        // whose chain does not resolve ends mount-dead before it reaches
        // the baton at all.
        await writeRepoConfig(repo.dir, minimalChainSrc());

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

/**
 * spec/chain.md, *The package a chain loads through* — the git 2.36 floor the
 * engine's `worktree list --porcelain -z` read sits on, as the two verbs that
 * read it at start report it.
 *
 * Driven through the real CLI over a `git` planted on PATH: the version the
 * warning turns on is one only git itself states, and no host here can be
 * made to ship an old build. The shim answers `--version` and delegates every
 * other invocation to the host's own git, so the run the warning rides is a
 * real one — `--max 0` reaches the floor read, the tip claim and the startup
 * sweep, and stops without spawning a child tick.
 *
 * POSIX only, and the ledger carries the reason: `src/git.ts` spawns `git`
 * through `execFile` with no shell, and win32 refuses a `.cmd` shim from a
 * direct spawn (`spec/cli.md`, *win32 is a supported host*), so the plant the
 * whole block is built on cannot be reached there.
 */
describe("flume loop — the git floor warning", () => {
  /**
   * The host's own git, found the way a spawn would find it — on the PATH
   * this process had before any shim was planted in front of it.
   */
  function hostGit(): string {
    for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
      if (dir === "") continue;
      const candidate = join(dir, "git");
      if (existsSync(candidate)) return candidate;
    }
    throw new Error("this host has no git on PATH");
  }

  /**
   * A directory holding a `git` that answers `--version` with `line` and
   * hands everything else to the host's git.
   *
   * The delegation is what keeps the case honest: the CLI runs perhaps a
   * dozen git commands during a `--max 0` loop, and a shim that answered any
   * of them itself would be testing the fixture rather than the engine.
   */
  async function plantGit(line: string): Promise<string> {
    const dir = await mkTempDir("flume-git-shim-");
    const shim = join(dir, "git");
    await writeFile(
      shim,
      `#!/bin/sh\n` +
        `if [ "$1" = "--version" ]; then\n` +
        `  printf '%s\\n' ${JSON.stringify(line)}\n` +
        `  exit 0\n` +
        `fi\n` +
        `exec ${JSON.stringify(hostGit())} "$@"\n`,
      { mode: 0o755, encoding: "utf8" },
    );
    return dir;
  }

  /** `hermeticEnv()` with `dir`'s git ahead of the host's. */
  const withGit = (dir: string): NodeJS.ProcessEnv => ({
    ...hermeticEnv(),
    PATH: `${dir}${delimiter}${process.env["PATH"] ?? ""}`,
  });

  /** How many times `out` carries the floor warning's own sentence. */
  const warnings = (out: string): number =>
    out.split("is below the git 2.36 floor").length - 1;

  it.skipIf(process.platform === "win32")(
    "flume loop below the git floor warns once naming the version, the floor, and what degrades",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      const shim = await plantGit("git version 2.35.9");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());

        const r = await runCli(
          repo.dir,
          ["loop", "--max", "0"],
          withGit(shim),
        );

        // A warning, not a refusal: the run the operator asked for happened.
        expect(r.code).toBe(0);
        expect(r.out).toContain("hibernating after 0 tick(s)");
        // Once — the read is the run's, never the tick's.
        expect(warnings(r.out)).toBe(1);
        // The version git itself stated, verbatim.
        expect(r.out).toContain("git version 2.35.9");
        // What degrades, and the read it degrades at.
        expect(r.out).toContain("worktree reclamation degrades");
        expect(r.out).toContain("git worktree list --porcelain -z");
      } finally {
        await rm(shim, { recursive: true, force: true });
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "a loop under a relocated state root below the git floor warns once and still runs",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      const shim = await plantGit("git version 2.35.9");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());
        const relocated = join(repo.dir, "state");
        await mkdir(relocated, { recursive: true });

        const r = await runCli(repo.dir, ["loop", "--max", "0"], {
          ...withGit(shim),
          FLUME_DIR: relocated,
        });

        expect(r.code).toBe(0);
        expect(r.out).toContain("hibernating after 0 tick(s)");
        expect(warnings(r.out)).toBe(1);
        expect(r.out).toContain("git version 2.35.9");
        // The run really was against the relocated root: nothing landed in
        // the bay.
        expect(existsSync(join(repo.dir, ".flume", "loop.pid"))).toBe(false);
      } finally {
        await rm(shim, { recursive: true, force: true });
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "a git at or above the floor warns nothing",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      const atFloor = await plantGit("git version 2.36.0");
      const belowFloor = await plantGit("git version 2.35.9");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());

        const quiet = await runCli(
          repo.dir,
          ["loop", "--max", "0"],
          withGit(atFloor),
        );
        expect(quiet.code).toBe(0);
        expect(quiet.out).toContain("hibernating after 0 tick(s)");
        expect(warnings(quiet.out)).toBe(0);
        expect(quiet.out).not.toContain("2.36.0");

        // The control the silence above means nothing without: the same
        // fixture, one minor lower, does warn — so the quiet run is a git
        // that met the floor rather than a warning nothing could produce
        // (`.claude/rules/engineering.md`, *A green verdict is proven
        // non-vacuous*). The floor's own version is the boundary, and it is
        // on the quiet side of it.
        const loud = await runCli(
          repo.dir,
          ["loop", "--max", "0"],
          withGit(belowFloor),
        );
        expect(loud.code).toBe(0);
        expect(warnings(loud.out)).toBe(1);
      } finally {
        await rm(atFloor, { recursive: true, force: true });
        await rm(belowFloor, { recursive: true, force: true });
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );

  it.skipIf(process.platform === "win32")(
    "a git whose version cannot be read warns that the floor is unconfirmed",
    async () => {
      const repo = await makeScratchRepo("flume-cli-repo-", "main");
      // A `git` answering `--version` with something no version can be read
      // out of — the arm a wrapper script on PATH reaches.
      const shim = await plantGit("a wrapper, not a version");
      try {
        await writeRepoConfig(repo.dir, minimalChainSrc());

        const r = await runCli(
          repo.dir,
          ["loop", "--max", "0"],
          withGit(shim),
        );

        expect(r.code).toBe(0);
        expect(r.out).toContain("hibernating after 0 tick(s)");
        // Unconfirmed, never read as met.
        expect(r.out).toContain("git version unread");
        expect(r.out).toContain("a wrapper, not a version");
        expect(r.out).toContain("2.36");
      } finally {
        await rm(shim, { recursive: true, force: true });
        await repo.cleanup();
      }
    },
    SPAWN_BUDGET_MS,
  );
});
