/**
 * `flume loop` — the supervisor: the loop lock and the tip claim this run
 * holds, the guards it refuses to start over, and the `superviseLoop` call
 * that spends its budget of `flume tick` children.
 *
 * Every refusal here is taken before the run writes anything — the stop flag,
 * a HEAD that names no ref, a lock another supervisor holds, an unreconciled
 * merge marker — and each is its own exit code, so a caller classifies the
 * outcome from the status without reading logs (spec/loop.md, *Exit codes —
 * the run never lies to CI*).
 */

import { takeCountValue } from "./cliArgs.js";
import type { CliVerbRun } from "./cliRunContext.js";
import { installSignalledTeardown } from "./cliTeardown.js";
import { describeRefFailure, loopCompletionSummary, loopExitCode } from "./cliVerdict.js";
import { diskChainLoader } from "./chainLoad.js";
import { EX_IOERR, EX_TERMINAL_MISCONFIG } from "./exitCodes.js";
import { existsLoudUnder } from "./fsProbe.js";
import {
  acquireTipClaim,
  currentRefPath,
  readGitVersion,
  TipClaimHeldError,
  WORKTREE_LIST_Z_FLOOR,
  type GitVersion,
} from "./git.js";
import {
  DEFAULT_TICK_BUDGET,
  superviseLoop,
  type SuperviseResult,
} from "./loopSupervisor.js";
import { readMergingMarkers } from "./mergingMarkers.js";
import { loopLockPath, mergingDir, stopFlagPath } from "./paths.js";
import type { Chain } from "./Phase.js";
import { stakePidClaim, type StakedPidClaim } from "./pidClaim.js";
import { DEFAULT_KILL_GRACE_MS } from "./processTree.js";
import { ensureRuntimeIgnores, frictionIgnoreEntry } from "./runtimeIgnores.js";

/**
 * What a run has to say about the git it found, or nothing when that git
 * carries the floor the engine reads at.
 *
 * spec/chain.md, *The package a chain loads through*: below 2.36 the engine's
 * `worktree list --porcelain -z` read fails, and reclamation — and nothing
 * else — degrades. That bound is what makes proceeding a **declared** degrade
 * rather than a silent one (`.claude/rules/engineering.md`, *Loud or
 * nothing*): the operator is told which git answered, what the engine needs,
 * and exactly what stops working, and the run they scheduled still happens.
 *
 * A version that could not be read warns too. The floor is then unconfirmed
 * rather than met, and reading silence as "at or above" is the one degrade
 * this exists to rule out.
 */
function gitFloorWarning(version: GitVersion): string | undefined {
  const floor = `${WORKTREE_LIST_Z_FLOOR.major}.${WORKTREE_LIST_Z_FLOOR.minor}`;
  const degrades =
    "worktree reclamation degrades — `git worktree list --porcelain -z` is " +
    "how the engine learns which paths git still holds a worktree at, so " +
    "residue is left standing and an occupied path is refused as one git " +
    "does not own";
  if (!version.read) {
    return (
      `[flume] git version unread (${version.reason}), so this run cannot ` +
      `confirm the git ${floor} floor the engine reads at: below it, ${degrades}.`
    );
  }
  if (version.meetsWorktreeListZFloor) return undefined;
  return (
    `[flume] ${version.line} is below the git ${floor} floor the engine ` +
    `reads at: ${degrades}. The run continues; git ${floor} or newer ends ` +
    `the warning.`
  );
}

export async function loopVerb(run: CliVerbRun): Promise<number> {
  const { paths, rest, log: operatorLog, dispatcher } = run;
  const { repoRoot, configDir, flumeDir } = paths;
  const words = [...rest];
  const requested = takeCountValue(words, "--max");
  // loop consumes zero positionals — an unexpected trailing token past
  // `--max N` runs something other than what the operator typed
  // (spec/cli.md "Subcommand surface", gh#1). A `--max` carrying no count is
  // left standing by the take, so it is refused here whether it is read as
  // the flag's own failure or as the token it leaves behind.
  if (requested === null || words.length > 0) {
    operatorLog.error("usage: flume loop [--max N]");
    return 2;
  }
  // The budget this run spends, and the engine default when the operator
  // named none — the take answers what was typed and this verb owns its
  // fallback.
  const max = requested ?? DEFAULT_TICK_BUDGET;
  // The git floor, read once per run and never per tick: the `flume tick`
  // children `superviseLoop` spawns below reach no branch that reads it, so
  // a run warns exactly once (spec/chain.md, "The package a chain loads
  // through").
  const gitFloorLine = gitFloorWarning(await readGitVersion(repoRoot));
  if (gitFloorLine !== undefined) operatorLog.error(gitFloorLine);
  // spec/loop.md "Graceful stop — the stop flag": presence at start
  // refuses the run before any tick — a stale flag must never silently
  // swallow a scheduled run.
  // Absent is the only silent reading, and it is proven from the path:
  // `existsLoudUnder` (src/fsProbe.ts) descends from the state root this run
  // is about to take its lock in before it stats the flag, so neither a flag
  // that is present but unstattable nor one under a root a plain file stands
  // at can start the run — which is the one outcome this guard exists to
  // rule out, and the one a single stat takes on win32, where an obstructed
  // ancestor is spelled `ENOENT` (`.claude/rules/platform-facts.md`, *win32
  // reports a path through a non-directory as not found*;
  // `.claude/rules/engineering.md`, "Loud or nothing"). The refusal names
  // the underlying error — the operator must resolve the flag either way
  // before a run starts.
  const loopStopPath = stopFlagPath(flumeDir);
  let loopStopPresent: boolean;
  try {
    loopStopPresent = existsLoudUnder("stop flag", flumeDir, loopStopPath);
  } catch (err) {
    operatorLog.error(
      `[flume] loop refuses: stop flag at ${loopStopPath} failed to stat: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EX_IOERR;
  }
  if (loopStopPresent) {
    operatorLog.error(
      `[flume] loop refuses: stop flag present at ${loopStopPath} — ` +
        "remove it to acknowledge the stop before starting a new run",
    );
    return 1;
  }
  // Refuse before any tick when HEAD does not name a ref — the tip claim
  // acquired below keys on the ref HEAD resolves to.
  const headRefResult = await currentRefPath(repoRoot);
  if (headRefResult.kind !== "ref") {
    operatorLog.error(`[flume] loop refuses: ${describeRefFailure(headRefResult)}`);
    return 1;
  }
  const headRef = headRefResult.path;
  // Cross-process loop lock: one supervisor per state root. A stale pidfile
  // (dead pid) is reclaimed; a live one refuses the second loop — two
  // supervisors against one state root race plan/build state. Lives under
  // flumeDir: the state root is what races, and a relocated dock must carry
  // its lock with it.
  // The path in this verb's own alphabet. The stake below is what addresses
  // the file, and the win32 MAX_PATH fold a relocated flumeDir needs is
  // taken there (`namespacedJoin`, `src/paths.ts`) rather than a second
  // time here — see .claude/rules/platform-facts.md. What this name is for
  // is the refusal that states it.
  const lockPath = loopLockPath(flumeDir);
  // Release is installed before either lock is taken, never after both. A
  // signal landing between the two acquisitions must find a handler, not
  // node's default disposition — which runs nothing and leaves whatever is
  // already on disk. The handler drops what is held *at the moment it
  // fires*: an unacquired guard is `undefined` and releases nothing, so a
  // run refused over another supervisor's live `loop.pid` never deletes the
  // file it lost to, and a staked one drops at most once
  // (`StakedPidClaim`, `src/pidClaim.ts`), so the rollback below and the
  // exit handler may both run.
  let loopLock: StakedPidClaim | undefined;
  let tipClaim: Awaited<ReturnType<typeof acquireTipClaim>> | undefined;
  const dropLock = () => {
    loopLock?.release();
    tipClaim?.release();
  };
  // The release the signal handlers perform is the whole tick tree's, never
  // this process's alone. `superviseLoop` spawns a `flume tick` child that
  // writes under the very state root `loop.pid` and the tip claim guard, so
  // dropping both while that child still runs hands the root to the next
  // acquirer with a live writer inside it — the release the section
  // promises has not happened yet. `stopRun` reaches the supervisor, which
  // signals the in-flight child's group and resolves only once it has
  // exited; the drop and the exit ride that promise.
  //
  // The wait is that child's, not a timer's. `supervisorPolicy.killGraceMs`
  // is the grace the child escalates under, over the agent tree only it can
  // see (`src/Phase.ts`); a bound here would fire first and orphan that
  // agent. A child wedged past its own handler therefore holds this exit
  // open rather than releasing over a live writer — the operator kills it,
  // and the next acquirer's liveness probe reclaims the claim.
  //
  // Before the run starts (and after it returns) `supervisedRun` is
  // undefined and the handler drops immediately: there is no tree to take
  // with it, and waiting on nothing would only delay the exit.
  //
  // The sequence itself is `installSignalledTeardown`'s
  // (`src/cliTeardown.ts`), shared with `flume tick`: what is this verb's is
  // the child it waits on, the grace it names and the two locks it drops.
  const stopRun = new AbortController();
  let supervisedRun: Promise<SuperviseResult> | undefined;
  // The grace that wait ends under, read off the resolve below: the
  // supervisor has no window into the child's own, so it names the same
  // declaration the child will read for itself. Initialized to the engine
  // default so a signal landing before that resolve — or after one that
  // failed — still names the number the child's teardown would apply.
  let childKillGraceMs = DEFAULT_KILL_GRACE_MS;
  installSignalledTeardown({
    abort: stopRun,
    waitingOn: "the in-flight tick child and the tree it spawned",
    inFlight: () => supervisedRun,
    killGraceMs: () => childKillGraceMs,
    release: dropLock,
    log: operatorLog,
  });
  // The exclusive-create stake every guard flume takes (`stakePidClaim`,
  // `src/pidClaim.ts`), which is the whole arbitration: probing the lock and
  // then writing it let two starts both read no holder and the second
  // overwrite the first's claim, where the loser of a `wx` race reads the
  // winner's statement instead of deciding anything from timing. The stake
  // creates the state root on the way — its `mkdir` of the lock's dirname —
  // so the run has one directory-create, not a second beside it.
  //
  // Absent is the only silent reading: the stake reclaims a pidfile whose
  // recorded pid is dead and throws for every other read failure — a
  // directory at the path, a permission-denied file — so a lock that is
  // present but will not open is this arm's refusal to classify, exactly as
  // the stop-flag guard above classifies its own probe. Outside a guard the
  // throw escaped to `main()`'s catch as a raw stack and exit 1: the same
  // code `another loop ... already runs` takes, naming no pid, over a lock
  // whose holder is unknown rather than absent
  // (`.claude/rules/engineering.md`, "Loud or nothing").
  let lockStake: Awaited<ReturnType<typeof stakePidClaim>>;
  try {
    lockStake = await stakePidClaim(lockPath);
  } catch (err) {
    operatorLog.error(
      `[flume] loop refuses: loop lock at ${lockPath} failed to read: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EX_IOERR;
  }
  if (lockStake.kind === "held") {
    operatorLog.error(
      `[flume] another loop (pid ${lockStake.by.pid}) already runs against ${flumeDir}; refusing`,
    );
    return 1;
  }
  loopLock = lockStake.claim;
  // Advisory per-ref tip claim — one flume writer per tip, the resource
  // two flume runs over one checkout actually contend on. Guards a different
  // resource than loop.pid (a ref vs. a state root); both stand. A refusal
  // here rolls back the loop.pid claim just taken above — through the same
  // `dropLock` the signal handlers call, so the rollback has one owner.
  //
  // The claim is handed the state root this run resolved, so its refusal can
  // name that root beside the holder's: the two guards above and here are
  // what a second effort under its own `FLUME_DIR` in this checkout meets,
  // and the loop lock it passes (a root of its own) is exactly why the tip's
  // refusal is the one that has to say which roots are involved.
  try {
    tipClaim = await acquireTipClaim(repoRoot, headRef, flumeDir);
  } catch (err) {
    dropLock();
    if (err instanceof TipClaimHeldError) {
      operatorLog.error(`[flume] ${err.message}`);
      return 1;
    }
    throw err;
  }
  // spec/loop.md "Crash equals stop": a merge marker still standing is a
  // pick that died before its ship bookkeeping — the picked commit may sit
  // on trunk ungated with its entry still `open`, and starting would pick
  // it again. Refuse here: under the tip claim (so no concurrent engine is
  // mid-merge against this root) and ahead of both the ignore merge and the
  // startup sweep below, so the run touches nothing and the abandoned
  // branch each marker names survives for the operator. Removal is the
  // acknowledgement — as with the stop flag, no engine verb performs it.
  //
  // The listing's own non-ENOENT failure is classified here, not left to
  // escape: `readMergingMarkers` rethrows anything but absence
  // (src/mergingMarkers.ts), and uncaught the throw reached `main().catch` as a
  // raw stack and an exit 1 — indistinguishable from a harness error, when
  // it is the same unreadable-state refusal every other stat failure this
  // CLI maps (`.claude/rules/platform-facts.md`, "Exit codes come
  // from `sysexits.h`"). EX_IOERR, not EX_TERMINAL_MISCONFIG: nothing was
  // read, so whether a marker stands is unknown — the operator must make
  // the dir readable before that question can even be asked.
  const mergingPath = mergingDir(flumeDir);
  let interrupted: Awaited<ReturnType<typeof readMergingMarkers>>;
  try {
    interrupted = await readMergingMarkers(flumeDir);
  } catch (err) {
    operatorLog.error(
      `[flume] loop refuses: merging markers at ${mergingPath} failed to list: ${err instanceof Error ? err.message : String(err)}`,
    );
    operatorLog.error(
      "[flume] an unreadable merging dir is not an empty one — a marker " +
        "standing behind it would mean a merge interrupted before its ship " +
        "bookkeeping. Nothing was touched and the startup sweep has not " +
        "run. Make the directory readable, then start again.",
    );
    return EX_IOERR;
  }
  if (interrupted.length > 0) {
    operatorLog.error(
      "[flume] loop refuses: a merge interrupted before its ship " +
        "bookkeeping is unreconciled",
    );
    for (const { path, marker } of interrupted) {
      operatorLog.error(
        marker
          ? `[flume]   ${path}: entry ${marker.tag} on branch ${marker.branch} (span ${marker.baseSha}..${marker.branch})`
          : `[flume]   ${path}: unreadable marker — the interrupted merge it names cannot be identified`,
      );
    }
    operatorLog.error(
      "[flume] the picked commit may already sit on trunk ungated with its " +
        "entry still open; reconcile (revert the commit, or mark the entry " +
        "shipped), then remove the file to acknowledge. Nothing was " +
        "touched and the startup sweep has not run, so each branch above " +
        "still stands.",
    );
    return EX_TERMINAL_MISCONFIG;
  }
  // Best-effort read of the chain, for the two consumers below — the
  // `friction` dir the ignore merge folds in, and the `supervisorPolicy`
  // override the supervisor reads. A chain that fails to load here surfaces
  // nothing new: the merge still writes the base runtime set, the first
  // child tick still reports mount-dead exactly as it does today, and
  // `superviseLoop` falls through to the engine defaults meanwhile.
  let supervisorPolicy: Chain["supervisorPolicy"];
  let friction: Chain["friction"];
  // The chain's phases in declared order, for the supervisor's own
  // scheduling: declaration order is the priority and the tiebreak for
  // which awake phase gets a child (spec/loop.md, *Baton — presence wakes,
  // absence hibernates*). Read off the same resolve as the policy rather
  // than left for the supervisor to rebuild — it is a fact this process
  // already holds (`.claude/rules/engineering.md`, *A fact the engine holds
  // is reported, never rediscovered*).
  let phaseOrder: string[] | undefined;
  // What that resolve threw, when it threw — handed to the supervisor,
  // which ends the run mount-dead before its first child rather than
  // spending one to hear the same failure said again. Swallowed here, it
  // was reported by nothing at all over an empty baton.
  let chainUnresolved: Error | undefined;
  try {
    const { chain } = await diskChainLoader(paths)();
    ({ supervisorPolicy, friction } = chain);
    phaseOrder = chain.phases.map((p) => p.name);
    childKillGraceMs = supervisorPolicy?.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  } catch (err) {
    chainUnresolved = err instanceof Error ? err : new Error(String(err));
  }
  // spec/jobs.md "Runtime ignores": the state root this run writes under
  // takes the runtime-owned merge — declared `Chain.friction` included,
  // through the one `frictionIgnoreEntry` spelling (`src/runtimeIgnores.ts`) — so a
  // fresh adopter never commits a tick artifact because a line was missing
  // from the repo's own ignore file. Under the tip claim and ahead of the
  // sweep below: the claim is what rules out a concurrent writer against
  // this root, and the sweep is the first thing this run writes under it.
  // Idempotent — a root already carrying the entries is left
  // byte-identical. `loop` is the only verb that merges; a bare tick never
  // does.
  await ensureRuntimeIgnores(
    flumeDir,
    friction !== undefined ? [frictionIgnoreEntry(friction)] : [],
  );
  // Startup sweep (spec/worktrees.md "Startup sweep — a dead wave's
  // residue is removed at the next start"): once, right after the tip
  // claim above and before the first tick, so a dead prior wave's
  // abandoned worktrees/branches never linger past this start. Safe here
  // and only here — holding the claim just acquired is what rules out a
  // live sibling owning anything under this state root's worktree base. A
  // bare `flume tick` never sweeps.
  await dispatcher.sweepStaleWorktrees();
  // Supervisor: one fresh `flume tick` process per phase it starts, each
  // told its phase. Past the sweep call above, the dispatcher constructed
  // above is otherwise unused on this path — each child builds its own and
  // resolves chain.ts in its own process. A terminal stop or a mount-dead
  // abort propagates the child's exit code out of `flume loop` too: exiting
  // 0 here would re-mask either as clean at the next process boundary up.
  //
  // `supervisorPolicy` and `phaseOrder` were read above, alongside the
  // ignore merge's `friction`, from the one best-effort chain resolve this
  // start makes.
  //
  // Two caps, and they stay two: `--max N` is this run's whole budget of
  // children (`tickBudget`), the chain's `supervisorPolicy.maxTicks` is how
  // many of them run at once. One is spent, the other is held.
  supervisedRun = superviseLoop({
    repoRoot,
    flumeDir,
    configDir,
    tickBudget: max,
    stopSignal: stopRun.signal,
    // As for the dispatcher above: the supervisor narrates through the
    // CLI's stamp rather than the engine default it would otherwise fall
    // through to.
    log: operatorLog,
    ...(phaseOrder !== undefined ? { phaseOrder } : {}),
    ...(chainUnresolved !== undefined ? { chainUnresolved } : {}),
    ...(supervisorPolicy?.quarantineScope !== undefined
      ? { quarantineScope: supervisorPolicy.quarantineScope }
      : {}),
    ...(supervisorPolicy?.abortThreshold !== undefined
      ? { abortThreshold: supervisorPolicy.abortThreshold }
      : {}),
    ...(supervisorPolicy?.maxTicks !== undefined
      ? { maxTicks: supervisorPolicy.maxTicks }
      : {}),
  });
  const supervised = await supervisedRun;
  // Name surfaced tick errors in the completion summary even on a 0 exit
  // (partial success) — they must not vanish silently.
  const completion = loopCompletionSummary(supervised);
  if (completion) operatorLog.info(completion);
  return loopExitCode(supervised);
}
