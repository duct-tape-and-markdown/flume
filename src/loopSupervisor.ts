/**
 * The `flume loop` supervisor — the process-per-tick outer loop.
 *
 * Split out of `src/Dispatcher.ts` (`.claude/rules/posture-sweep.md`, "A
 * violation counts only when verified on disk this tick"): the supervisor
 * spawns child ticks and reads their on-disk leavings, so it depends on the
 * dispatcher's surface one way only and shares none of the `buildFlumeApi`
 * cycle constraint that keeps chain loading and tick execution colocated
 * there.
 */

import { spawn } from "node:child_process";

import { Baton } from "./Baton.js";
import {
  consoleLogger,
  diskChainLoader,
  readTickVerdict,
  EX_MOUNT_DEAD,
  EX_TERMINAL_MISCONFIG,
  type Logger,
  type StageFailureEntry,
  type TerminalMisconfiguration,
  type TickVerdict,
} from "./Dispatcher.js";
import { frictionCountLine } from "./friction.js";
import { existsLoud } from "./fsProbe.js";
import { defaultStateRoot, namespacedJoin, stopFlagPath } from "./paths.js";

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
  /** Max child ticks before stopping (the `--max N` cap). Default 50. */
  maxTicks?: number;
  log?: Logger;
  /**
   * Chain-declared override for the run-scoped quarantine (spec/loop.md
   * "Repeated identical failures", which covers the provision, merge and gate
   * stages alike). `"none"` disables per-entry quarantine outright — a tagged
   * provision/merge/gate failure is never withheld from later ticks this run —
   * while the consecutive-identical-failure backstop (`abortThreshold` below)
   * still applies. Defaults to {@link DEFAULT_QUARANTINE_SCOPE}, whose hold
   * is pinned by tests/loopSupervisor.test.ts's "a chain declaring neither
   * supervisor knob gets both defaults: a run-scoped quarantine and a
   * three-tick abort" case.
   * The CLI forwards this from the resolved chain's
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
   * Run one `flume tick` as a fresh child process; resolves with its exit
   * code when it exits. Defaults to re-execing the running flume entrypoint
   * (mirrors `process.execArgv`/`argv[1]`, so it works whether launched from
   * the built `dist/src/cli.js` or `tsx src/cli.ts`). Injected by tests — the
   * stubbed-spawn seam. `quarantinedSlugs` is this run's
   * accumulated run-scoped quarantine so far — the default runner carries it
   * to the child via the `FLUME_QUARANTINED_SLUGS` env var; a test stub may
   * ignore it.
   */
  runTick?: (
    quarantinedSlugs: ReadonlySet<string>,
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
   * Set when the run aborted because the same stage-tagged signature
   * repeated on `abortThreshold` ({@link DEFAULT_ABORT_THRESHOLD} by
   * default) consecutive ticks with no
   * successful tick between them (spec/loop.md "Repeated identical
   * failures") — the consecutive-failure backstop for non-entry-scoped
   * walls the run-scoped quarantine can't isolate, and a wider abort than
   * the mount-dead one, which keeps its own semantics. `stage` names which
   * of the three walls the aborting streak came from — the supervisor holds
   * it at the abort site, so it is reported rather than left for a consumer
   * to infer from the signature's wording. `signature` is the raw comparison
   * key, never prefixed with the stage it came from — the stage rides the
   * sibling field, never the signature text. Distinct from `mountDead` — the
   * chain resolved and ran fine; only a provision, merge, or gate wall kept
   * hitting the identical failure.
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
 * `flume loop` supervisor. Spawns exactly one `flume tick` child process
 * per iteration, carrying no in-memory chain or phase state across them — the
 * only correct re-resolution mechanism (Node's ESM registry is non-evictable,
 * so an in-process loop is pinned to chain.ts's first evaluation; see
 * `loadChainModule`). Between children it reads the on-disk baton
 * (disk-is-truth): no awake flags ⇒ hibernation ⇒ stop. A child that exits
 * a plain tick failure (agent-level, per-entry) is logged and the loop
 * proceeds — the supervisor never crashes — except
 * {@link EX_TERMINAL_MISCONFIG} (Axis-C terminal misconfiguration) and
 * {@link EX_MOUNT_DEAD} (mount-dead: the chain never resolved),
 * either of which stops the loop immediately: both defeat the hibernation
 * check (nothing on disk changed to reflect them), so proceeding would
 * hot-spin to `--max` while masquerading each iteration as routine. Bounded
 * by `maxTicks` (the `--max N` cap).
 */
export async function superviseLoop(
  opts: SuperviseLoopOptions,
): Promise<SuperviseResult> {
  const log = opts.log ?? consoleLogger;
  const maxTicks = opts.maxTicks ?? 50;
  const flumeDir = opts.flumeDir ?? defaultStateRoot(opts.repoRoot);
  const configDir = opts.configDir ?? defaultStateRoot(opts.repoRoot);
  const baton = new Baton(flumeDir);
  const runTick = opts.runTick ?? defaultTickRunner(opts.repoRoot);

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

  let ticks = 0;
  const shippedTags = new Set<string>();
  const erroredTicks: string[] = [];
  // Run-scoped quarantine (`quarantineKey` (`src/Dispatcher.ts`) values —
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
  for (let i = 0; i < maxTicks; i++) {
    const { exitCode } = await runTick(quarantinedSlugs);
    ticks++;

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
    const verdict = await readTickVerdict(flumeDir);
    let countedAsErrored = false;
    if (verdict) {
      for (const tag of verdict.shippedTags) shippedTags.add(tag);
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
      log.error(
        `[flume] the same ${abort.stage}-stage failure signature repeated on ` +
          `${abort.count} consecutive ticks (${abort.signature}); aborting ` +
          `after ${ticks} tick(s) instead of burning the remaining ticks ` +
          `against the same wall.`,
      );
      return {
        ticks,
        hibernated: false,
        repeatedFailure: abort,
        shippedTags: [...shippedTags],
        erroredTicks,
      };
    }

    if (exitCode === EX_TERMINAL_MISCONFIG) {
      // Axis-C fail-fast: the child classified a terminal
      // misconfiguration (orphaned awake flags). The decision comes from the
      // exit signal alone — the orphaned flags definitionally defeat
      // `baton.hibernating()`, so it is never consulted here. The flags are
      // still on disk (the child leaves them); read them only to *name* the
      // orphans in the summary.
      const phases = baton.awake();
      log.error(
        `[flume] tick exited ${exitCode} (terminal misconfiguration): ` +
          `orphaned awake flags name unknown phases: ` +
          `${phases.length > 0 ? phases.join(", ") : "(none on disk)"}; ` +
          `stopping after ${ticks} tick(s). Inspect, then ` +
          `\`flume sleep <phase>\` or fix the chain.`,
      );
      return {
        ticks,
        hibernated: false,
        terminal: { kind: "orphaned-awake", phases },
        shippedTags: [...shippedTags],
        erroredTicks,
      };
    }
    if (exitCode === EX_MOUNT_DEAD) {
      // Mount-dead fail-fast: the child could not resolve a chain
      // at all — no agent ran, nothing here is retryable by waiting. A chain
      // that fails to load now is exactly as unloadable next tick as this
      // one, so continuing would only burn the remaining `--max` ticks
      // re-hitting the same wall instead of surfacing the failure to CI.
      log.error(
        `[flume] tick exited ${exitCode} (mount-dead): the chain failed to ` +
          `load; aborting after ${ticks} tick(s) instead of burning the ` +
          `remaining ticks against the same failure. Inspect and restore ` +
          `the chain (or its state root), then re-run.`,
      );
      return {
        ticks,
        hibernated: false,
        mountDead: true,
        shippedTags: [...shippedTags],
        erroredTicks,
      };
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
    // spec/loop.md "Graceful stop — the stop flag": checked at the same
    // per-iteration boundary as the baton re-read below, never mid-tick —
    // the in-flight tick above always completed (merge, park, verdict, and
    // handoff ran exactly as they would have) before this is reached. A
    // flag written while that tick was running is picked up here, ending
    // the run even though the baton may still carry awake flags — the
    // hibernation check below never gets a chance to end it on its own
    // terms. The flag itself is left on disk; there is no unstop verb.
    //
    // Absent is the only silent reading: `existsLoud` (src/fsProbe.ts) throws
    // on a stop flag that is present but unstattable (a symlink loop, a
    // permission-denied parent) rather than reading it as absent and ticking
    // on over an operator's unacknowledged stop
    // (`.claude/rules/engineering.md`, "Loud or nothing"). Throwing is the
    // disposition this boundary already takes for the same failure class —
    // `baton.hibernating()`'s `readdirSync` one check below throws too — and
    // it surfaces as `flume loop`'s harness-error exit (1), naming the path.
    if (existsLoud(namespacedJoin(stopFlagPath(flumeDir)))) {
      log.info(`[flume] stop flag present; ending run after ${ticks} tick(s)`);
      await logFrictionSummary();
      return {
        ticks,
        hibernated: baton.hibernating(),
        stoppedByFlag: true,
        shippedTags: [...shippedTags],
        erroredTicks,
      };
    }
    // Disk is truth: the child tick slept its phase and woke successors (or
    // didn't). No awake flags ⇒ hibernation. A failed tick does no baton
    // work, so an unguarded broken chain.ts keeps a phase awake and fails
    // loudly every iteration until restored or --max is hit.
    if (baton.hibernating()) {
      log.info(`[flume] hibernating after ${ticks} tick(s)`);
      await logFrictionSummary();
      return {
        ticks,
        hibernated: true,
        shippedTags: [...shippedTags],
        erroredTicks,
      };
    }
  }
  log.info(`[flume] reached --max ${maxTicks}; stopping`);
  await logFrictionSummary();
  return {
    ticks,
    hibernated: false,
    shippedTags: [...shippedTags],
    erroredTicks,
  };
}

/**
 * Default {@link SuperviseLoopOptions.runTick}: spawn `flume tick` as a fresh
 * process mirroring however the supervisor itself was launched. `execArgv`
 * carries node flags (e.g. `--import tsx` when run from source); `argv[1]` is
 * the cli entrypoint (`dist/src/cli.js` built, `src/cli.ts` from source).
 * `quarantinedSlugs` crosses the process boundary via the
 * `FLUME_QUARANTINED_SLUGS` env var — comma-joined `quarantineKey`
 * (`src/Dispatcher.ts`) values, which the CLI's `tick` command reads back into
 * `DispatcherOptions.quarantinedSlugs`; omitted entirely when empty. The var
 * name predates the key and stands; a key never contains a comma, so the
 * join round-trips by construction.
 * `FLUME_TIP_CLAIM_HELD` (spec/loop.md "The loop lock and the tip claim")
 * carries this supervisor process's own pid — the one that acquired the tip
 * claim in `src/cli.ts`'s `loop` command — so the child tick trusts the
 * claim already held instead of acquiring (and colliding on) its own.
 */
function defaultTickRunner(
  repoRoot: string,
): (
  quarantinedSlugs: ReadonlySet<string>,
) => Promise<{ exitCode: number | null }> {
  return (quarantinedSlugs) =>
    new Promise((resolveExit) => {
      const env = { ...process.env };
      if (quarantinedSlugs.size > 0) {
        env.FLUME_QUARANTINED_SLUGS = [...quarantinedSlugs].join(",");
      }
      env.FLUME_TIP_CLAIM_HELD = String(process.pid);
      const child = spawn(
        process.execPath,
        [...process.execArgv, process.argv[1]!, "tick"],
        { cwd: repoRoot, stdio: "inherit", env },
      );
      child.on("exit", (code) => resolveExit({ exitCode: code }));
      child.on("error", (err) => {
        consoleLogger.error(
          `[flume] failed to spawn 'flume tick': ${(err as Error).message}`,
        );
        resolveExit({ exitCode: 1 });
      });
    });
}
