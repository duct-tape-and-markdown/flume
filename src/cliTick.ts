/**
 * `flume tick` — one phase, one agent invocation, one commit or none: the
 * bare tick's own tip claim, the signal handlers that take its agent tree
 * with it, and the verdict record the run leaves behind.
 *
 * The tick itself is the dispatcher's (`src/cliRunContext.ts` builds the one
 * this verb runs). What is this verb's is everything around it — which phase
 * was named, what this process claims while the tick runs, and how each
 * outcome becomes an exit code the supervisor can classify without reading
 * logs.
 */

import { installSignalledTeardown } from "./cliTeardown.js";
import { takeFlagValue } from "./cliArgs.js";
import { describeRefFailure, tickExitCode } from "./cliVerdict.js";
import type { CliVerbRun } from "./cliRunContext.js";
import { type TickOutcome } from "./Dispatcher.js";
import { EX_IOERR } from "./exitCodes.js";
import { acquireTipClaim, currentRefPath, TipClaimHeldError } from "./git.js";
import { STATE_ROOT_NAMES } from "./paths.js";
import {
  clearTickVerdict,
  VerdictHistoryUnreadableError,
  writeTickVerdict,
} from "./tickVerdict.js";

export async function tickVerb(run: CliVerbRun): Promise<number> {
  const {
    paths: { repoRoot, flumeDir },
    rest,
    log: operatorLog,
    dispatcher,
    stopTick,
    takesOwnTipClaim,
  } = run;
  // Which phase to run is said with a flag, never a positional: `flume
  // tick plan` is gh#1's field-reported shape — the word was dropped and
  // whichever phase happened to be awake ticked in its name — so the
  // spelling that names a phase is `--phase plan` and a bare word stays
  // refused (spec/cli.md "Subcommand surface").
  const words = [...rest];
  const named = takeFlagValue(words, "--phase");
  // `tick` consumes no positionals — a stray trailing arg past the flag is
  // refused before any tick runs, not honored as something the operator
  // never typed.
  if (named === null || words.length > 0) {
    operatorLog.error("usage: flume tick [--phase <name>]");
    return 2;
  }
  // The name goes to the dispatcher unchecked: what a chain declares is
  // read off the one chain load `tick()` makes, and the refusal comes back
  // as a fact this verb reports (`TickOutcome.undeclaredPhase`), rather
  // than from a second chain resolved here to pre-validate a string
  // (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
  // never rediscovered*).
  const tickRequest = named !== undefined ? { phase: named } : {};
  // Clear any stale verdict before this tick's own work — a tick that
  // returns below without an agent having run (chain-load failure,
  // hibernation, terminal misconfiguration, the detached-HEAD refusal below)
  // must leave no record for `flume loop`'s supervisor to misread as its
  // own.
  //
  // Scoped to the phase this tick was named with, because a supervisor run
  // holds one child per awake phase and a clear of the whole directory
  // would take a sibling's verdict with it. A bare tick names no phase —
  // it picks one off the baton inside `tick()`, past this point — and
  // clears the directory whole, which costs nothing: a bare tick takes the
  // tip claim itself, so it has no sibling child to strip.
  await clearTickVerdict(flumeDir, named);
  // Tick and loop both refuse before any tick when HEAD does not name a ref
  // — the tick record's meaning is advancing a named tip, and the claim
  // taken just below keys on a ref, so there is nothing for a bare tick to
  // claim here either.
  const tickHeadRef = await currentRefPath(repoRoot);
  if (tickHeadRef.kind !== "ref") {
    operatorLog.error(`[flume] tick refuses: ${describeRefFailure(tickHeadRef)}`);
    return 1;
  }
  // spec/loop.md "The loop lock and the tip claim": scope is per run. A
  // loop-spawned child trusts the supervisor's claim — the handoff decoded
  // once before this verb was called, never re-read here under a fourth
  // predicate (`CliVerbRun.takesOwnTipClaim`, `src/cliRunContext.ts`) —
  // rather than probing pids and inferring parentage, and takes none itself.
  // A bare tick has no supervisor to trust, so it acquires and releases its
  // own claim around this single tick, refusing (exit 1) when another live
  // process already holds it.
  //
  // Release rides the same `exit`/`SIGINT`/`SIGTERM` handlers `flume loop`
  // drops its locks through: a `finally` alone runs on neither
  // signal, so a signalled bare tick left its claim standing and the next
  // tick refused over it until a liveness probe happened to catch the pid
  // dead. Nothing gates the drop here: a refused acquisition leaves
  // `bareTipClaim` undefined, and the stake's own release drops at most
  // once, at the file it created (`StakedPidClaim`, `src/pidClaim.ts`), so
  // the handler and the `finally` may both run without the second one
  // deleting a claim a later process has since taken. Handlers precede the
  // acquisition — a signal landing during it must find a handler, not
  // node's default disposition.
  let bareTipClaim: Awaited<ReturnType<typeof acquireTipClaim>> | undefined;
  const dropBareTipClaim = () => {
    bareTipClaim?.release();
  };
  // The release a signalled tick performs is its agent tree's too, never
  // this process's alone: the agent leads its own process group
  // (`src/claudeCode.ts`), writes in the worktree under the very state root the
  // claim guards, and outlives a bare `process.exit` here — which handed
  // that root to the next acquirer with a live writer inside it. Aborting
  // `stopTick` takes the tree down through the same SIGTERM-then-SIGKILL
  // teardown the supervisor applies to a tick tree, and awaiting the tick
  // is what makes the release the whole tree's rather than a kill that was
  // merely requested.
  //
  // Both paths install them, claim or no claim. A loop-spawned child holds
  // no claim of its own, but the supervisor's group signal stops at this
  // process — the agent's group is not the child's — so this handler is the
  // only thing that reaches the agent there too.
  //
  // The wait is the tick's, not a timer's: a chain whose agent never settles
  // on its abort holds this exit open, which is the intended outcome rather
  // than a hang to bound — exiting anyway is the release-over-a-live-writer
  // this whole path exists to stop. What bounds a well-behaved agent is its
  // own teardown (`supervisorPolicy.killGraceMs`, `src/Phase.ts`), which is
  // the number the handler writes into the line it prints at receipt: the
  // wait is silent otherwise, and an agent that swallows the SIGTERM makes
  // it a long one. It reads that number off `Dispatcher.agentKillGraceMs` —
  // the engine's own fold over the chain it resolved, reported rather than
  // re-derived from a chain this process would have to apply a second time
  // (`.claude/rules/engineering.md`, "A fact the engine holds is reported,
  // never rediscovered"). Before the chain resolves — and after one that
  // failed to, which `tick()` reports as mount-dead — the getter still
  // names the engine default the teardown would apply anyway
  // (`src/processTree.ts`).
  //
  // The sequence itself is `installSignalledTeardown`'s
  // (`src/cliTeardown.ts`), shared with `flume loop`: what is this verb's is
  // the tree it waits on, the grace it names and the claim it drops.
  let tickRun: Promise<TickOutcome> | undefined;
  installSignalledTeardown({
    abort: stopTick,
    waitingOn: "the agent tree this tick started",
    inFlight: () => tickRun,
    killGraceMs: () => dispatcher.agentKillGraceMs,
    release: dropBareTipClaim,
    log: operatorLog,
  });
  if (takesOwnTipClaim) {
    try {
      bareTipClaim = await acquireTipClaim(
        repoRoot,
        tickHeadRef.path,
        flumeDir,
      );
    } catch (err) {
      if (err instanceof TipClaimHeldError) {
        operatorLog.error(`[flume] tick refuses: ${err.message}`);
        return 1;
      }
      throw err;
    }
  }
  try {
    tickRun = dispatcher.tick(tickRequest);
    const outcome = await tickRun;
    operatorLog.info(outcome.summary);
    if (outcome.verdict) {
      // The verdict record's own read refusal, mapped at the same boundary
      // as every other stat refusal this CLI takes: `writeTickVerdict` reads
      // the history before appending to it, and a history that is present
      // and unreadable refuses there rather than reporting a repo that has
      // never ticked (src/tickVerdict.ts). Uncaught, that throw reached
      // `main().catch` and left the operator a raw stack and an exit 1 —
      // the tick's own work misread as a harness error
      // (`.claude/rules/platform-facts.md`, "Exit codes come from
      // `sysexits.h`"). The class is what makes this a statement rather
      // than a guess at an errno's prose: everything else out of the call
      // is an ordinary throw and keeps the exit-1 harness-error route.
      try {
        await writeTickVerdict(flumeDir, outcome.verdict);
      } catch (err) {
        if (!(err instanceof VerdictHistoryUnreadableError)) throw err;
        operatorLog.error(
          `[flume] tick: ${STATE_ROOT_NAMES.tickVerdictsLog} failed to read: ${err.message}`,
        );
        // What the code does *not* mean, said outright: the tick ran, its
        // commits are on the tip, and the summary printed above is its
        // outcome. Only the recording of that outcome failed, so an
        // operator reading 74 never goes looking for work to re-run.
        operatorLog.error(
          "[flume] tick: this tick's own work already landed — the summary " +
            "above is its outcome, and recording it is what failed.",
        );
        return EX_IOERR;
      }
    }
    // Fail loudly on the classifying exits so the supervisor — and any human
    // watching exit codes — classifies the failure without reading logs.
    // Which outcome maps to which code is `tickExitCode`'s to state
    // (`src/cliVerdict.ts`); a second copy here is one more thing to go
    // stale against it.
    return tickExitCode(outcome);
  } finally {
    dropBareTipClaim();
  }
}
