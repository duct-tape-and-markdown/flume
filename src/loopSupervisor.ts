/**
 * The `flume loop` supervisor — the process-per-tick outer loop.
 *
 * Split out of `src/Dispatcher.ts` (`.claude/rules/posture-sweep.md`, "A
 * violation counts only when verified on disk this tick"): the supervisor
 * spawns child ticks and reads their on-disk leavings — a verdict
 * (`src/tickVerdict.ts`), an exit code (`src/exitCodes.ts`) — so it depends
 * on the dispatcher's surface one way only.
 */

import { Baton } from "./Baton.js";
import { diskChainLoader } from "./chainLoad.js";
import { type TerminalMisconfiguration } from "./Dispatcher.js";
import { EX_MOUNT_DEAD, EX_TERMINAL_MISCONFIG } from "./exitCodes.js";
import { consoleLogger, type Logger } from "./log.js";
import {
  readTickVerdict,
  tickVerdictPath,
  totalAgentUsageByPhase,
  type PhaseAgentUsage,
  type StageFailureEntry,
  type TickVerdict,
} from "./tickVerdict.js";
import { frictionCountLine } from "./friction.js";
import { existsLoud } from "./fsProbe.js";
import { defaultStateRoot, namespacedJoin, stopFlagPath } from "./paths.js";
import { signalProcessTree, spawnProcessTree } from "./processTree.js";

/**
 * Engine default for the run-scoped quarantine — the scope `superviseLoop`
 * applies to a failure a tick blamed on one entry, absent a chain's
 * `supervisorPolicy.quarantineScope` (`src/Phase.ts`): withhold that entry's
 * quarantine key for the rest of the run. One home: the option below reads
 * this rather than restating the member beside it, and the chain-facing
 * option's hover text points here.
 */
export const DEFAULT_QUARANTINE_SCOPE = "run" as const;

/**
 * Engine default for the consecutive-identical-failure abort backstop — the
 * number of consecutive ticks one stage-tagged signature must repeat before
 * `superviseLoop` aborts the run, absent a chain's
 * `supervisorPolicy.abortThreshold` (`src/Phase.ts`). One home: the help
 * text that quotes this default to an operator (`src/cliHelp.ts`) reads it
 * from here rather than restating the number beside it.
 */
export const DEFAULT_ABORT_THRESHOLD = 3;

/**
 * Engine default for how many `flume tick` children the supervisor holds at
 * once, absent a chain's `supervisorPolicy.maxTicks` (`src/Phase.ts`): one,
 * which is the serial loop — one phase tick at a time, every consumer's
 * behavior until it declares otherwise. One home: the help text that quotes
 * this default to an operator (`src/cliHelp.ts`) reads it from here rather
 * than restating the number beside it.
 */
export const DEFAULT_MAX_TICKS = 1;

/**
 * Engine default for the total number of children one run may start — the
 * `flume loop --max N` cap, the bound that is spent rather than held. One
 * home, same as its siblings above: `src/cliHelp.ts` quotes it.
 */
export const DEFAULT_TICK_BUDGET = 50;

/**
 * What one child the supervisor holds is asked for. The phase is the whole
 * reason this is a record rather than a bare quarantine set: a supervisor
 * that holds several children at once must tell each which phase it is, and
 * the child that reads it back is `flume tick --phase <name>`.
 */
export interface TickChildRequest {
  /**
   * The phase this child runs — one the chain declares, chosen by the
   * supervisor off the baton in declared order. The child runs it awake or
   * not (`TickRequest.phase`, `src/Dispatcher.ts`): the supervisor holds the
   * flags, and a child re-reading them to second-guess what it was told is
   * the engine inferring a statement it was already given
   * (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
   */
  phase: string;
  /**
   * This run's accumulated run-scoped quarantine so far — the default runner
   * carries it to the child via the `FLUME_QUARANTINED_SLUGS` env var; a test
   * stub may ignore it.
   */
  quarantinedSlugs: ReadonlySet<string>;
  /**
   * The run's teardown ({@link SuperviseLoopOptions.stopSignal}), handed to
   * the runner because the child handle lives there and nowhere else: a
   * runner that spawns a process **signals it on abort and still resolves on
   * the child's `exit`**, never on the abort itself — resolving early is what
   * leaves the supervisor's caller releasing a claim out from under a live
   * writer. A stub with nothing to signal may ignore it.
   */
  stopSignal: AbortSignal;
}

/** Options for {@link superviseLoop}. */
interface SuperviseLoopOptions {
  /** Repo root; child ticks spawn with this as their cwd. */
  repoRoot: string;
  /**
   * Mutable-state root the supervisor reads baton state from between child
   * ticks. Must match the `flumeDir` the children write to (the CLI carries it
   * across the process boundary via the `FLUME_DIR` env var, which children
   * inherit). Defaults to `<repoRoot>/.flume`.
   */
  flumeDir?: string;
  /**
   * Chain+prompts dir the supervisor loads the chain from for the loop-end
   * friction summary — repo-resident, never a job dir (mirrors
   * every other `configDir` default). Defaults to `<repoRoot>/.flume`.
   */
  configDir?: string;
  /**
   * How many children this run may start **in total** before it stops — the
   * `flume loop --max N` cap, defaulting to {@link DEFAULT_TICK_BUDGET}. A
   * budget, not a width: it is spent by every child the run starts, whether
   * they ran one after another or several at once.
   *
   * Named apart from {@link maxTicks} deliberately. The two bound different
   * things — how many children a run starts, against how many it holds at
   * once — and one name over both would read as the chain's knob at the one
   * call site that forwards the operator's flag.
   */
  tickBudget?: number;
  /**
   * How many children the supervisor holds at once, defaulting to
   * {@link DEFAULT_MAX_TICKS}. The CLI forwards this from the resolved
   * chain's `supervisorPolicy.maxTicks` (`src/Phase.ts`); undeclared falls
   * through to the default here, which is the serial loop.
   *
   * Bound once, before the first child: the supervisor is the one process
   * that never reloads (`spec/chain.md`, *Supervisor policy is a
   * chain-overridable default*). A value below one is refused at chain load,
   * because a supervisor that may hold no child can never run one — reaching
   * `superviseLoop` anyway, it refuses rather than reporting the standing
   * flags as orphaned.
   */
  maxTicks?: number;
  /**
   * The chain's phases in declared order — the priority and the tiebreak for
   * which awake phase gets a child when the budget is short (spec/loop.md,
   * *Baton — presence wakes, absence hibernates*), and the roster that says
   * which standing flags name a phase at all.
   *
   * The CLI reads it off the one chain resolve it already makes for
   * `supervisorPolicy`; a resolve that failed reports itself on
   * {@link chainUnresolved} instead, which ends the run before any child.
   * Absent with no failure beside it is a caller that declined to declare an
   * order at all — the baton's own name order stands in.
   */
  phaseOrder?: readonly string[];
  /**
   * The chain-load failure the caller's own resolve hit, when it hit one. The
   * run ends mount-dead before its first child, naming it.
   *
   * Reported rather than rediscovered (`.claude/rules/engineering.md`, *A
   * fact the engine holds is reported, never rediscovered*): the caller has
   * already read this failure, and a chain that will not resolve in the
   * supervisor's process will not resolve in a child's either — spending one
   * to hear it said again buys nothing, and over an empty baton it buys
   * worse than nothing, because the child the supervisor no longer needs was
   * the only thing that would have reported it at all.
   */
  chainUnresolved?: Error;
  log?: Logger;
  /**
   * Chain-declared override for the run-scoped quarantine (spec/loop.md
   * "Repeated identical failures — quarantine, then abort", which covers the
   * provision, merge and gate stages alike). `"none"` disables per-entry
   * quarantine outright — a tagged provision/merge/gate failure is never
   * withheld from later ticks this run — while the
   * consecutive-identical-failure backstop (`abortThreshold` below) still
   * applies. Defaults to {@link DEFAULT_QUARANTINE_SCOPE}, whose hold is
   * pinned by tests/loopSupervisor.test.ts's "a chain declaring neither
   * supervisor knob gets both defaults: a run-scoped quarantine and a
   * three-tick abort" case. The CLI forwards this from the resolved chain's
   * `supervisorPolicy.quarantineScope` (`src/Phase.ts`); undeclared falls
   * through to the default here.
   */
  quarantineScope?: "run" | "none";
  /**
   * Chain-declared override for the consecutive-identical-failure abort
   * threshold — the number of consecutive ticks the same *stage-tagged* signature
   * (provision, merge, or gate) must repeat, with no successful tick between
   * them, before the run aborts. Defaults to {@link DEFAULT_ABORT_THRESHOLD},
   * pinned by tests/loopSupervisor.test.ts's "a chain declaring neither
   * supervisor knob gets both defaults: a run-scoped quarantine and a
   * three-tick abort" case, which drives both defaults at once. The CLI
   * forwards this from the resolved chain's `supervisorPolicy.abortThreshold`;
   * undeclared falls through to the default here.
   */
  abortThreshold?: number;
  /**
   * The run's teardown, reaching the tick tree the run owns. Aborting it ends
   * the run: the in-flight tick child is signalled, awaited with no bound of
   * this level's, and only then does `superviseLoop` resolve — so a caller
   * that releases a resource the run held (the loop lock and the tip claim,
   * `src/cli.ts`) releases it with no process of this run's still writing
   * under it. No further child is spawned once it has aborted.
   *
   * A caller that declines one gets a signal that never aborts: the run is
   * then bounded by `tickBudget`, hibernation and the stop flag alone,
   * exactly as before.
   */
  stopSignal?: AbortSignal;
  /**
   * Run one `flume tick` as a fresh child process for the phase the request
   * names; resolves with its exit code when it exits. Defaults to re-execing
   * the running flume entrypoint (mirrors `process.execArgv`/`argv[1]`, so
   * it works whether launched from the built `dist/src/cli.js` or from
   * source under tsx). Injected by tests — the stubbed-spawn seam.
   *
   * Called once per child the supervisor holds, so several calls may be
   * outstanding at a `maxTicks` above one; each gets its own
   * {@link TickChildRequest}.
   */
  runTick?: (
    child: TickChildRequest,
  ) => Promise<{ exitCode: number | null }>;
}

/**
 * Every stage a per-entry failure record can come from — the three the tick
 * verdict carries in separate lists (`provisionFailures`, `mergeFailures`,
 * `gateFailures`), declared once as a runtime value so whatever enumerates
 * the stages — the fold below, a prompt, a test driving every stage through
 * the abort path — names them from the engine rather than from a copy an
 * engine rename would strand (`.claude/rules/engineering.md`, *Derived state
 * is computed, never restated beside its source*).
 *
 * Load-bearing rather than decorative: `superviseLoop`'s per-stage failure
 * fold is keyed by this roster, so a member added here is a compile error
 * until the verdict list it reads is named.
 */
export const FAILURE_STAGES = ["provision", "merge", "gate"] as const;

/**
 * One member of {@link FAILURE_STAGES}, derived from it so the two cannot
 * disagree. Rides {@link SuperviseResult.repeatedFailure} so a consumer reads
 * the aborting streak's stage instead of re-deriving it from the signature's
 * wording.
 */
export type FailureStage = (typeof FAILURE_STAGES)[number];

/** Outcome of a supervised loop: how many child ticks ran and why it stopped. */
export interface SuperviseResult {
  ticks: number;
  hibernated: boolean;
  /**
   * Set when the loop fail-fasted on a child exiting
   * {@link EX_TERMINAL_MISCONFIG}. `phases` are the orphaned awake
   * flags read off disk for the summary — the stop *decision* is the exit
   * code alone.
   */
  terminal?: TerminalMisconfiguration;
  /**
   * Set when the loop fail-fasted on a child exiting {@link EX_MOUNT_DEAD}
   * the mount-dead failure class (chain cannot load, state root
   * missing, declaration invalid). Distinct from `terminal` — a
   * mount-dead run never resolved a chain at all, so there is no phase list
   * to name in the summary, only the fact of the abort.
   */
  mountDead?: boolean;
  /**
   * Every entry tag shipped by any child tick this run, accumulated across
   * iterations from each child's on-disk {@link TickVerdict} — the run-level
   * exit-code decision (non-zero iff ≥1 tick errored AND zero entries
   * shipped) needs the whole run's total, not
   * just the last tick's.
   */
  shippedTags: string[];
  /**
   * One line per child tick that errored — a genuine tick-level failure
   * (`gate-revert` or `platform-preempt`, derived from the tick's {@link
   * TickVerdict} at the read site) — this run, in tick order, read
   * alongside `shippedTags`. Non-empty even on a 0 exit (partial success:
   * ships landed despite some tick errors) — `flume loop`'s completion
   * summary names these so they never vanish into a silent green exit.
   */
  erroredTicks: string[];
  /**
   * What this run spent on agents, one entry per phase whose ticks invoked
   * one, in the order each phase first did ({@link totalAgentUsageByPhase})
   * — summed from the usage rows the
   * children wrote to their verdicts (spec/loop.md "Every agent invocation
   * leaves a usage row"), which is the only place the counts cross the
   * child→supervisor boundary. Empty when no tick this run invoked an agent
   * at all: a phase that never ran is absent rather than present at zero, so
   * "nothing was spent" and "nothing ran" read the same because they are.
   * `flume loop`'s completion summary names these, so what a run cost is
   * read where its outcome is.
   *
   * This run's rows alone — never the verdict log's history, which spans
   * runs the caller never asked about.
   */
  agentUsageByPhase: PhaseAgentUsage[];
  /**
   * Set when the run aborted because the same stage-tagged signature
   * repeated on `abortThreshold` ({@link DEFAULT_ABORT_THRESHOLD} by
   * default) consecutive ticks with no
   * successful tick between them (spec/loop.md "Repeated identical failures
   * — quarantine, then abort") — the consecutive-failure backstop for
   * non-entry-scoped walls the run-scoped quarantine can't isolate, and a
   * wider abort than the mount-dead one, which keeps its own semantics.
   * `stage` names which of the three walls the aborting streak came from —
   * the supervisor holds it at the abort site, so it is reported rather than
   * left for a consumer to infer from the signature's wording. `signature`
   * is the raw comparison key, never prefixed with the stage it came from —
   * the stage rides the sibling field, never the signature text. Distinct
   * from `mountDead` — the chain resolved and ran fine; only a provision,
   * merge, or gate wall kept hitting the identical failure.
   */
  repeatedFailure?: { stage: FailureStage; signature: string; count: number };
  /**
   * spec/loop.md "Graceful stop — the stop flag": set when `<flumeDir>/stop`
   * was found present at the per-iteration boundary after a child tick
   * finished, ending the run there rather than at hibernation or `--max`.
   * Distinct from `hibernated` — the baton may still carry awake flags when
   * a stop ends the run; `hibernated` above reflects the baton's actual
   * disk state at that same moment, independent of this field. Read by
   * `flume loop`'s completion summary to name the stop flag as the reason
   * iteration ended (spec/loop.md); never consulted by `loopExitCode` —
   * a stopped run's exit code stays decided by the run totals alone.
   */
  stoppedByFlag?: boolean;
}

/**
 * The stop-shaped half of a {@link SuperviseResult} — why the run ended, with
 * the run's own totals left to the one place that spells them.
 */
type StopFacts = Omit<
  SuperviseResult,
  "ticks" | "shippedTags" | "erroredTicks" | "agentUsageByPhase"
>;

/**
 * What ends a supervised run. Held rather than returned the moment it is
 * decided, because a run that has decided to end still drains the children it
 * holds: the caller releases the loop lock and the tip claim on
 * `superviseLoop`'s promise, so that promise may not resolve over a live
 * writer (spec/loop.md, *The loop lock and the tip claim*). `finish` is what
 * the old early `return` said on its way out — the announcement, and the
 * loop-end friction summary where that stop logs one — run once, after the
 * drain, so a tick count it names is the run's rather than the moment's.
 */
interface RunEnd {
  stop: StopFacts;
  finish: () => Promise<void>;
}

/** One child the supervisor held, as its exit hands it back. */
interface SettledChild {
  phase: string;
  exitCode: number | null;
}

/**
 * `flume loop` supervisor. Holds a table of `flume tick` children — one per
 * awake phase that has none of its own in flight, started in the chain's
 * declared order until `maxTicks` are running — each a fresh process told
 * which phase it is, carrying no in-memory chain or phase state across them:
 * the only correct re-resolution mechanism (Node's ESM registry is
 * non-evictable, so an in-process loop is pinned to chain.ts's first
 * evaluation; see `loadChainModule`). At every child boundary it re-reads the
 * baton and the stop flag off disk (disk-is-truth), and the run ends once no
 * flag stands and no child is in flight.
 *
 * A child that exits a plain tick failure (agent-level, per-entry) is logged
 * and the run proceeds — the supervisor never crashes — except
 * {@link EX_TERMINAL_MISCONFIG} (Axis-C terminal misconfiguration) and
 * {@link EX_MOUNT_DEAD} (mount-dead: the chain never resolved), either of
 * which ends the run: both defeat the hibernation check (nothing on disk
 * changed to reflect them), so proceeding would hot-spin to the budget while
 * masquerading each iteration as routine. Every such stop drains the children
 * already in flight before it resolves; it starts no further one. Bounded in
 * total by `tickBudget` (the `--max N` cap).
 */
export async function superviseLoop(
  opts: SuperviseLoopOptions,
): Promise<SuperviseResult> {
  const log = opts.log ?? consoleLogger;
  const tickBudget = opts.tickBudget ?? DEFAULT_TICK_BUDGET;
  const flumeDir = opts.flumeDir ?? defaultStateRoot(opts.repoRoot);
  const configDir = opts.configDir ?? defaultStateRoot(opts.repoRoot);
  const baton = new Baton(flumeDir);
  const runTick = opts.runTick ?? defaultTickRunner(opts.repoRoot);
  // A caller with no teardown of its own gets one that never fires, so the
  // runner and both checks below read one shape rather than branching on
  // whether a signal was supplied.
  const stopSignal = opts.stopSignal ?? new AbortController().signal;

  // Best-effort — a missing or broken chain must never fail
  // the loop-end summary, only silently withhold the friction line.
  const logFrictionSummary = async (): Promise<void> => {
    try {
      const { chain } = await diskChainLoader({
        repoRoot: opts.repoRoot,
        configDir,
        flumeDir,
      })();
      const line = await frictionCountLine(flumeDir, chain);
      if (line) log.info(`[flume] ${line}`);
    } catch {
      // no chain, or a chain that fails to load — nothing to summarize
    }
  };

  // Engine defaults, overridable per opts above.
  const quarantineScope = opts.quarantineScope ?? DEFAULT_QUARANTINE_SCOPE;
  const abortThreshold = opts.abortThreshold ?? DEFAULT_ABORT_THRESHOLD;
  const maxTicks = opts.maxTicks ?? DEFAULT_MAX_TICKS;
  const phaseOrder = opts.phaseOrder;

  let ticks = 0;
  const shippedTags = new Set<string>();
  const erroredTicks: string[] = [];
  // Every verdict this run's children left behind, kept for the spend fold in
  // `settled` below. Accumulated the same way `shippedTags` is, and for the
  // same reason: the rows cross the child boundary one tick at a time, and
  // what the summary owes an operator is the run's total. The grouping itself
  // is `totalAgentUsageByPhase`'s (`src/tickVerdict.ts`) — one totaller for
  // this run and for the live-run line `flume status` prints from the same
  // rows.
  const runVerdicts: TickVerdict[] = [];
  // Run-scoped quarantine (`entryDeclaredKey` (`src/entryKey.ts`) values —
  // `slug@hash` of the entry as the failing tick read it) plus the
  // consecutive-identical-signature streak for the abort backstop. Both reset
  // to empty on every fresh `superviseLoop` call — quarantine never outlives
  // the run.
  const quarantinedSlugs = new Set<string>();
  // spec/loop.md "Repeated identical failures — quarantine, then abort"
  // generalizes both legs past provisioning to the merge and gate stages,
  // keyed by *stage-tagged* signature (`${stage}:${signature}`) so a
  // coincidentally-identical message from a different stage never shares a
  // streak with this one, and never shadows it in the quarantine loop either.
  // Keyed by signature, not "the last one seen" — a tick's failures can carry
  // several distinct signatures across stages (a repo-level provisioning
  // failure pushed first, then per-entry ones, then a merge or gate failure),
  // and any of them can be the one that repeats every tick. Tracking only
  // index 0 let a varying sibling there shadow a genuinely-repeating
  // signature elsewhere in the list forever.
  const failureStreaks = new Map<string, number>();
  // The children this supervisor owns right now, keyed by the phase each was
  // told to run — the process tree's fact, never the run's state: a fresh
  // supervisor rebuilds it from nothing (spec/loop.md, *One tick is one fresh
  // process*). The key is what keeps a phase to one worker: its flag standing
  // while its child runs is a re-run queued, not a second child.
  const inFlight = new Map<string, Promise<SettledChild>>();
  // Children started this run, against `tickBudget`. Distinct from `ticks`,
  // which counts the ones that have already come back: under a `maxTicks`
  // above one the two differ for as long as the table is non-empty.
  let started = 0;
  // Every exit carries the same run-level totals and differs only in why the
  // run stopped, so the totals are spelled once here and each exit states its
  // `StopFacts` alone. The loop below has one `return`, which applies this to
  // whichever `RunEnd` won, so a total added here reaches every exit by
  // construction rather than by a hand-copy at each one
  // (`.claude/rules/engineering.md`, *A module is one job*).
  const settled = (stop: StopFacts): SuperviseResult => ({
    ticks,
    shippedTags: [...shippedTags],
    erroredTicks,
    agentUsageByPhase: totalAgentUsageByPhase(runVerdicts),
    ...stop,
  });
  const signalledEnd = (): RunEnd => ({
    stop: { hibernated: false },
    finish: async () => {
      log.info(`[flume] signalled; stopping after ${ticks} tick(s)`);
    },
  });

  /**
   * Start one child per awake phase that has none, in the chain's declared
   * order, until the table is full or the budget is spent. Declaration order
   * is the priority and the tiebreak — never flag order, never flag mtime
   * (spec/loop.md, *Baton — presence wakes, absence hibernates*). With no
   * declared order the baton's own name order stands in — a caller that
   * declined to declare one, since a resolve that failed ends the run above
   * rather than reaching here.
   */
  const fill = (): void => {
    const awake = baton.awake();
    for (const phase of phaseOrder ?? awake) {
      if (inFlight.size >= maxTicks || started >= tickBudget) return;
      if (!awake.includes(phase) || inFlight.has(phase)) continue;
      started++;
      inFlight.set(
        phase,
        runTick({ phase, quarantinedSlugs, stopSignal }).then(
          ({ exitCode }) => ({ phase, exitCode }),
        ),
      );
    }
  };

  // The run's teardown, read at the two boundaries that matter: before a
  // child is spawned (so an abort landing in the bookkeeping below never
  // starts one more tick) and immediately after one exits (so nothing is read
  // off a half-tick's leavings). Whatever is still in flight at that point is
  // drained below before this function resolves — `runTick` has already
  // terminated and reaped each child by then, so the returned result is the
  // whole tree's and the caller may release what it held.
  let ending: RunEnd | undefined;
  // Mount-dead before the first child: the caller's own resolve already
  // failed, so this run has no declared order to schedule by and no chain a
  // child could load either. Named here rather than left for a child to
  // rediscover — and over an empty baton there is no child to rediscover it,
  // which is how a broken chain would otherwise be reported as a quiet
  // hibernation (`.claude/rules/engineering.md`, *Loud or nothing*).
  if (opts.chainUnresolved !== undefined) {
    const why = opts.chainUnresolved;
    ending = {
      stop: { hibernated: false, mountDead: true },
      finish: async () => {
        log.error(
          `[flume] mount-dead: the chain failed to load (${why.message}); ` +
            `starting no tick, because a chain that will not resolve here ` +
            `will not resolve in a child either. Inspect and restore the ` +
            `chain (or its state root), then re-run.`,
        );
      },
    };
  }
  while (true) {
    if (ending === undefined && stopSignal.aborted) ending = signalledEnd();
    if (ending === undefined) fill();
    // No flag stands that this supervisor can start on, and no child is in
    // flight: the run is over, whatever decided it.
    if (inFlight.size === 0) break;
    const child = await Promise.race(inFlight.values());
    inFlight.delete(child.phase);
    ticks++;
    const { exitCode } = child;
    if (stopSignal.aborted) {
      ending ??= signalledEnd();
      continue;
    }

    // Recover this tick's facts from its verdict artifact — the
    // exit code alone (settled/errored/mount-dead) is the only signal that
    // crosses the child→supervisor boundary today (child stdio stays
    // `inherit`), and it can't carry a run-wide total. Absent on a tick that
    // returned before reaching the write (chain-load failure, hibernation,
    // terminal misconfiguration) — nothing to add. `errored` is not a stored
    // field on the verdict (which carries facts only) — derived here, at the
    // read site: a genuine tick-level failure is
    // `gate-revert`/`platform-preempt`/`render-refused` (the prompt itself
    // was broken), `tipMoved` (the
    // ref moved out from under this tick — worth surfacing even on a wave
    // that also shipped something, unlike the provisioning/merge legs below,
    // since it signals something else is writing to this ref), a
    // provisioning or merge (cherry-pick) failure that left nothing shipped,
    // or a `not-shipped` merge outcome the chain's `shipped` predicate
    // *threw* into (the predicate is broken, so the tick's ship decision was
    // never actually made — counted like `tipMoved` rather than the
    // provisioning/merge legs, since a sibling entry shipping does not make
    // this predicate any less broken)
    // — never a `clean-exit` (an agent exiting cleanly with nothing to
    // commit is not evidence anything went wrong), and never a
    // `not-shipped` the chain *returned*, for the same reason one rung up:
    // the chain's `shipped` predicate declining a landed commit is that
    // chain's own verdict, not a failure of the tick that produced it
    // (spec/loop.md "The tick verdict — one facts artifact", *No
    // interpretation fields*). The `threw` field exists precisely so the two
    // `not-shipped` causes never collapse into one record
    // (`TickVerdictMergeOutcome.threw`), and they are read apart here.
    // The formula is an allowlist for exactly this — a fact absent from it
    // is excluded by construction, and each of the two above stays named
    // here so that exclusion reads as decided rather than overlooked.
    //
    // The read itself refuses a verdict file that is present and unreadable
    // (`readTickVerdict`, `src/tickVerdict.ts`) rather than answering
    // "this tick left nothing behind". That refusal is answered here rather
    // than let escape: uncaught it would take the whole `SuperviseResult`
    // with it — the ticks already run, what they shipped, what they cost —
    // and leave `flume loop` a raw stack. The run ends instead, the way the
    // mount-dead and terminal arms below end it and for the same reason: the
    // next tick writes to that same unreadable path, so continuing would
    // hot-spin to the budget against a wall that cannot clear itself.
    let verdict: TickVerdict | undefined;
    try {
      // Read by the phase this supervisor named the child with, which is the
      // name that child wrote its verdict under — no inference, and no path
      // two children of one run can share.
      verdict = await readTickVerdict(flumeDir, child.phase);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      erroredTicks.push(
        `tick verdict present but unreadable (${why}); run ended before the verdict's facts could be counted`,
      );
      ending ??= {
        stop: { hibernated: false },
        finish: async () => {
          log.error(
            `[flume] this tick's verdict at ${tickVerdictPath(flumeDir, child.phase)} is ` +
              `present but could not be read (${why}); stopping after ${ticks} ` +
              `tick(s) rather than counting the tick as one that reported ` +
              `nothing. Make the path readable, then re-run.`,
          );
        },
      };
      continue;
    }
    let countedAsErrored = false;
    if (verdict) {
      for (const tag of verdict.shippedTags) shippedTags.add(tag);
      runVerdicts.push(verdict);
      const verdictProvisionFailures = verdict.provisionFailures ?? [];
      const verdictMergeFailures = verdict.mergeFailures ?? [];
      const shipHookThrew = verdict.mergeOutcomes.filter(
        (o) => o.outcome === "not-shipped" && o.threw !== undefined,
      );
      const errored =
        verdict.noCommit === "gate-revert" ||
        verdict.noCommit === "platform-preempt" ||
        verdict.noCommit === "render-refused" ||
        verdict.tipMoved === true ||
        shipHookThrew.length > 0 ||
        (verdictProvisionFailures.length > 0 &&
          verdict.shippedTags.length === 0) ||
        (verdictMergeFailures.length > 0 && verdict.shippedTags.length === 0);
      if (errored) {
        erroredTicks.push(
          verdictProvisionFailures.length > 0
            ? `${verdict.summary} — worktree provisioning failed: ${verdictProvisionFailures
                .map((f) => (f.tag ? `${f.tag} (${f.signature})` : f.signature))
                .join("; ")}`
            : verdictMergeFailures.length > 0
              ? `${verdict.summary} — merge failed: ${verdictMergeFailures
                  .map((f) =>
                    f.tag ? `${f.tag} (${f.signature})` : f.signature,
                  )
                  .join("; ")}`
              : shipHookThrew.length > 0
                ? `${verdict.summary} — shipped predicate threw: ${shipHookThrew
                    .map((o) =>
                      o.entryTag ? `${o.entryTag} (${o.threw})` : o.threw,
                    )
                    .join("; ")}`
                : verdict.summary,
        );
        countedAsErrored = true;
      }
    }

    // Every per-entry failure fact the
    // verdict records, tagged with the stage it came from — a clean exit
    // never joins this list, since it writes no provision/merge/gate failure
    // record at all.
    // The one place a roster member meets the verdict list that carries it.
    // Keyed by `FailureStage`, so the mapping is exhaustive over
    // `FAILURE_STAGES` by type: a stage added to the roster is a compile
    // error here until its list is named, never a member the fold below
    // silently drops.
    const stageLists: Record<
      FailureStage,
      readonly (StageFailureEntry & { signature: string; message: string })[]
    > = {
      provision: verdict?.provisionFailures ?? [],
      merge: verdict?.mergeFailures ?? [],
      gate: verdict?.gateFailures ?? [],
    };
    const failures = FAILURE_STAGES.flatMap((stage) =>
      stageLists[stage].map((f) => ({ stage, ...f })),
    );

    // Quarantine every *blamed* failure this tick named, whichever stage it
    // came from — isolating the entry so the rest of the run stops
    // re-attempting a wall it already hit once. The hold stands under the
    // key the failing tick reported (`StageFailureEntry`), never a key
    // recomputed here: the supervisor holds only the verdict, and the queue
    // on disk may already have moved. A repo-level/unblamed failure (no
    // single entry to blame) falls to the backstop below instead. A
    // chain declaring `quarantineScope: "none"` opts out of this leg
    // entirely — the backstop below still fires.
    if (quarantineScope !== "none") {
      for (const f of failures) {
        if (!f.tag) continue;
        if (!quarantinedSlugs.has(f.quarantineKey)) {
          quarantinedSlugs.add(f.quarantineKey);
          log.warn(
            `[flume] quarantining ${f.tag} (${f.quarantineKey}) for the rest of this run: ` +
              `${f.stage}-stage failure (${f.signature})`,
          );
        }
      }
    }

    // Fold every stage-tagged signature into the consecutive-identical
    // streak (the backstop for the non-entry-scoped class quarantine can't
    // isolate, e.g. a repo-level `git worktree prune` failure, or a
    // singleton's own gate revert — nothing to quarantine either way). A
    // tick with no failure of a given stage-tagged signature clears that
    // signature's streak — only an unbroken run of the identical wall
    // counts.
    // Keyed by the stage-tagged streak key, valued by the failure record
    // itself: the stage is a fact this loop already holds, and the abort
    // below reports it rather than leaving a consumer to read it back out of
    // the signature's wording (`.claude/rules/engineering.md`, *A fact the
    // engine holds is reported, never rediscovered*).
    const thisFailures = new Map(
      failures.map((f) => [`${f.stage}:${f.signature}`, f]),
    );
    for (const key of [...failureStreaks.keys()]) {
      if (!thisFailures.has(key)) failureStreaks.delete(key);
    }
    let abort: SuperviseResult["repeatedFailure"];
    for (const [key, failure] of thisFailures) {
      const count = (failureStreaks.get(key) ?? 0) + 1;
      failureStreaks.set(key, count);
      if (count >= abortThreshold && count > (abort?.count ?? 0)) {
        // The raw signature, never the streak key — the stage rides its own
        // field, so the reported comparison key stays what the tick wrote.
        abort = { stage: failure.stage, signature: failure.signature, count };
      }
    }
    if (abort) {
      const repeated = abort;
      ending ??= {
        stop: { hibernated: false, repeatedFailure: repeated },
        finish: async () => {
          log.error(
            `[flume] the same ${repeated.stage}-stage failure signature repeated on ` +
              `${repeated.count} consecutive ticks (${repeated.signature}); aborting ` +
              `after ${ticks} tick(s) instead of burning the remaining ticks ` +
              `against the same wall.`,
          );
        },
      };
      continue;
    }

    if (exitCode === EX_TERMINAL_MISCONFIG) {
      // Axis-C fail-fast: the child classified a terminal
      // misconfiguration (orphaned awake flags). The decision comes from the
      // exit signal alone — the orphaned flags definitionally defeat
      // `baton.hibernating()`, so it is never consulted here. The flags are
      // still on disk (the child leaves them); read them only to *name* the
      // orphans in the summary.
      const phases = baton.awake();
      ending ??= {
        stop: {
          hibernated: false,
          terminal: { kind: "orphaned-awake", phases },
        },
        finish: async () => {
          log.error(
            `[flume] tick exited ${exitCode} (terminal misconfiguration): ` +
              `orphaned awake flags name unknown phases: ` +
              `${phases.length > 0 ? phases.join(", ") : "(none on disk)"}; ` +
              `stopping after ${ticks} tick(s). Inspect, then ` +
              `\`flume sleep <phase>\` or fix the chain.`,
          );
        },
      };
      continue;
    }
    if (exitCode === EX_MOUNT_DEAD) {
      // Mount-dead fail-fast: the child could not resolve a chain
      // at all — no agent ran, nothing here is retryable by waiting. A chain
      // that fails to load now is exactly as unloadable next tick as this
      // one, so continuing would only burn the remaining budget re-hitting
      // the same wall instead of surfacing the failure to CI.
      ending ??= {
        stop: { hibernated: false, mountDead: true },
        finish: async () => {
          log.error(
            `[flume] tick exited ${exitCode} (mount-dead): the chain failed to ` +
              `load; aborting after ${ticks} tick(s) instead of burning the ` +
              `remaining ticks against the same failure. Inspect and restore ` +
              `the chain (or its state root), then re-run.`,
          );
        },
      };
      continue;
    }
    if (exitCode !== 0) {
      log.warn(
        `[flume] tick process exited with code ${exitCode}; ` +
          `supervisor continuing (next tick is a fresh process)`,
      );
      // LOOP-ERRORED-TICKS-SILENT-EXIT: a child that exits non-zero without
      // ever reaching the verdict write — the CJS-context refusal (2), the
      // detached-HEAD/harness-error refusal (1), an uncaught throw out of
      // `Dispatcher.tick` — is still a tick that failed to do work. Left
      // uncounted, `erroredTicks` stays empty and `loopExitCode` reads a run
      // where nothing succeeded as a clean 0. Guarded on `countedAsErrored`
      // so a tick whose verdict already flagged it (belt-and-suspenders, not
      // reachable today since every verdict-errored path exits 0 via
      // `tickExitCode`) isn't double-counted.
      if (!countedAsErrored) {
        erroredTicks.push(
          `tick process exited ${exitCode} with no verdict written to disk`,
        );
      }
    }
    // spec/loop.md "Graceful stop — the stop flag": checked at the same child
    // boundary as the baton re-read `fill` makes, never mid-tick — the tick
    // that just exited always completed (merge, park, verdict, and handoff
    // ran exactly as they would have) before this is reached, and every
    // sibling still in flight finishes too. A flag written while that tick
    // was running is picked up here, ending the run even though the baton may
    // still carry awake flags — the empty-table check above never gets a
    // chance to end it on its own terms. The flag itself is left on disk;
    // there is no unstop verb.
    //
    // Absent is the only silent reading: `existsLoud` (src/fsProbe.ts) throws
    // on a stop flag that is present but unstattable (a symlink loop, a
    // permission-denied parent) rather than reading it as absent and ticking
    // on over an operator's unacknowledged stop
    // (`.claude/rules/engineering.md`, "Loud or nothing"). Throwing is the
    // disposition this boundary already takes for the same failure class —
    // `baton.hibernating()`'s `readdirSync` in `fill` throws too — and it
    // surfaces as `flume loop`'s harness-error exit (1), naming the path.
    if (existsLoud(namespacedJoin(stopFlagPath(flumeDir)))) {
      // Read where the stop was seen, not after the drain: `hibernated` is
      // the baton's state at the boundary this run stopped taking work at.
      const hibernated = baton.hibernating();
      ending ??= {
        stop: { hibernated, stoppedByFlag: true },
        finish: async () => {
          log.info(
            `[flume] stop flag present; ending run after ${ticks} tick(s)`,
          );
          await logFrictionSummary();
        },
      };
    }
  }

  if (ending === undefined) {
    // Disk is truth: the children slept their phases and woke successors (or
    // didn't). Nothing to start and nothing in flight, so what ended the run
    // is whichever of three states the disk and the budget are in. A failed
    // tick does no baton work, so an unguarded broken chain.ts keeps a phase
    // awake and fails loudly every iteration until restored or the budget is
    // spent.
    // One read, because the phases themselves are wanted below and
    // `Baton.hibernating()` is this same list being measured — a second call
    // would be a second answer, and a child settling between them would make
    // the two disagree.
    const awake = baton.awake();
    if (awake.length === 0) {
      ending = {
        stop: { hibernated: true },
        finish: async () => {
          log.info(`[flume] hibernating after ${ticks} tick(s)`);
          await logFrictionSummary();
        },
      };
    } else if (started >= tickBudget) {
      ending = {
        stop: { hibernated: false },
        finish: async () => {
          log.info(`[flume] reached --max ${tickBudget}; stopping`);
          await logFrictionSummary();
        },
      };
    } else if (!awake.some((name) => phaseOrder?.includes(name) ?? true)) {
      // Axis C from the supervisor's side: every flag standing names a phase
      // the chain it resolved does not declare, so there is no child left to
      // classify it. Same verdict the child's own 78 carries below — read
      // from the roster the chain stated rather than guessed at
      // (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
      const phases = awake;
      ending = {
        stop: {
          hibernated: false,
          terminal: { kind: "orphaned-awake", phases },
        },
        finish: async () => {
          log.error(
            `[flume] terminal misconfiguration: orphaned awake flags name ` +
              `phases this chain does not declare: ${phases.join(", ")}; ` +
              `stopping after ${ticks} tick(s). Inspect, then ` +
              `\`flume sleep <phase>\` or fix the chain.`,
          );
        },
      };
    } else {
      // Unreachable while `maxTicks` is at least one: a flag the chain
      // declares, budget left, and an empty table is a supervisor that may
      // hold no child. Loud rather than reported as a quiet hibernation
      // (`.claude/rules/engineering.md`, *Loud or nothing*).
      throw new Error(
        `the loop supervisor started no child for awake phase(s) ${awake.join(", ")} ` +
          `with ${tickBudget - started} of its ${tickBudget}-tick budget left: ` +
          `maxTicks is ${maxTicks}, and a supervisor that may hold no child can ` +
          `never run one. Declare supervisorPolicy.maxTicks as a positive integer.`,
      );
    }
  }
  await ending.finish();
  return settled(ending.stop);
}

/**
 * Default {@link SuperviseLoopOptions.runTick}: spawn `flume tick` as a fresh
 * process mirroring however the supervisor itself was launched. `execArgv`
 * carries node flags (e.g. `--import tsx` when run from source); `argv[1]` is
 * the cli entrypoint (`dist/src/cli.js` built, `src/cli.ts` from source).
 * The phase the request names crosses as the child's own `--phase <name>`
 * argument (spec/loop.md, *Baton — presence wakes, absence hibernates*): the
 * supervisor tells each child what it is for rather than letting several
 * children race the baton for whichever flag they each read first.
 * `quarantinedSlugs` crosses the process boundary via the
 * `FLUME_QUARANTINED_SLUGS` env var — comma-joined `entryDeclaredKey`
 * (`src/entryKey.ts`) values, which the CLI's `tick` command reads back into
 * `DispatcherOptions.quarantinedSlugs`; omitted entirely when empty. The var
 * name predates the key and stands; a key never contains a comma, so the
 * join round-trips by construction.
 * `FLUME_TIP_CLAIM_HELD` (spec/loop.md "The loop lock and the tip claim")
 * carries this supervisor process's own pid — the one that acquired the tip
 * claim in `src/cli.ts`'s `loop` command — so the child tick trusts the
 * claim already held instead of acquiring (and colliding on) its own.
 *
 * `stopSignal` is the run's teardown reaching this child: on abort the child's
 * group is signalled with SIGTERM (`spawnProcessTree`/`signalProcessTree`,
 * `src/processTree.ts` — the child leads its own process group) and the
 * promise resolves on the child's `exit` — the supervisor hands its caller a
 * settled tree, not a kill that was merely requested.
 *
 * The wait carries no bound of its own. The agent the child started leads a
 * group of its own, which this signal never reaches and a timer here could
 * only orphan: at the grace the supervisor would SIGKILL the child moments
 * before the child's own escalation reached that agent. The one timer in the
 * tree is the child's, over the tree it can see (spec/loop.md, "The loop lock
 * and the tip claim"). The cost that section names is a child wedged past its
 * handler, which holds the run open rather than releasing over a live writer
 * — the operator kills it, and the next acquirer's liveness probe reclaims
 * the claim.
 */
function defaultTickRunner(
  repoRoot: string,
): (child: TickChildRequest) => Promise<{ exitCode: number | null }> {
  return ({ phase, quarantinedSlugs, stopSignal }) =>
    new Promise((resolveExit) => {
      const env = { ...process.env };
      if (quarantinedSlugs.size > 0) {
        env.FLUME_QUARANTINED_SLUGS = [...quarantinedSlugs].join(",");
      }
      env.FLUME_TIP_CLAIM_HELD = String(process.pid);
      const child = spawnProcessTree(
        process.execPath,
        [...process.execArgv, process.argv[1]!, "tick", "--phase", phase],
        { cwd: repoRoot, stdio: "inherit", env },
      );
      // Wired by hand rather than through spawn's own `signal` option: that
      // option reports the abort as an `error` event, and a runner that
      // resolved there would hand the supervisor a still-running child.
      const signalChild = (): void => {
        signalProcessTree(child, "SIGTERM");
      };
      if (stopSignal.aborted) signalChild();
      else stopSignal.addEventListener("abort", signalChild, { once: true });
      const settle = (result: { exitCode: number | null }): void => {
        stopSignal.removeEventListener("abort", signalChild);
        resolveExit(result);
      };
      child.on("exit", (code) => settle({ exitCode: code }));
      child.on("error", (err) => {
        consoleLogger.error(
          `[flume] failed to spawn 'flume tick': ${(err as Error).message}`,
        );
        settle({ exitCode: 1 });
      });
    });
}
