/**
 * What a verb that may run a tick is handed before it starts: the loop
 * supervisor's env handoff decoded once, and the one `Dispatcher` this
 * process builds from it.
 *
 * Its own file because the handoff is read by more than one verb and decoded
 * for all of them here — `flume tick` asks whether it takes a tip claim of
 * its own, and the dispatcher below is built from the other two facts the same
 * decode answers (`.claude/rules/engineering.md`, *A module is one job*).
 */

import { claudeCode } from "./claudeCode.js";
import { Dispatcher } from "./Dispatcher.js";
import type { FlumePaths } from "./flumeApi.js";
import type { Logger } from "./log.js";

/**
 * The supervisor's tip-claim handoff, as one decoded value.
 *
 * spec/loop.md, *The loop lock and the tip claim*: the loop runner tells the
 * children it spawns which pid holds the claim they run under
 * (`FLUME_TIP_CLAIM_HELD=<pid>`, `defaultTickRunner`, `src/loopSupervisor.ts`)
 * rather than leaving them to probe pids and infer parentage. Every question
 * this process asks of that handoff — the pid its wave's tip-verify treats as
 * its own, whether it acquires a claim itself, and whether it is the
 * supervised run whose wave reads the stop flag — is answered off this one
 * decode, because three reads under three predicates disagreed on exactly the
 * values the writer never produces: an empty string is falsy (no supervisor
 * pid), defined (a supervised run), and not `undefined` (no claim acquired),
 * which ran a bare tick over the ref under no claim at all while its wave
 * honored a stop flag spec/loop.md promises a bare tick ignores.
 *
 * So a value that is present and names no pid is refused here rather than read
 * three ways (`.claude/rules/engineering.md`, *Loud or nothing*): the writer
 * emits a decimal pid and nothing else, so anything else is an operator's or a
 * foreign runner's hand on the var, and the one reading that would let the
 * tick proceed — "no supervisor, take my own claim" — is the reading the
 * operator can state outright by unsetting it.
 */
type TipClaimHandoff =
  | { kind: "bare" }
  | { kind: "supervised"; pid: number }
  | { kind: "malformed"; raw: string };

function decodeTipClaimHandoff(raw: string | undefined): TipClaimHandoff {
  if (raw === undefined) return { kind: "bare" };
  // Exactly what the writer spells — `String(process.pid)`. Not `Number`,
  // which reads an empty string as 0, a signed or fractional literal as a pid
  // no process bears, and whitespace as the number it surrounds: each is a
  // value that cannot match the claim file's first line (`liveForeignClaimPid`,
  // `src/tipVerify.ts`), so decoding it is a silent degrade wearing a number.
  if (!/^[1-9][0-9]*$/.test(raw)) return { kind: "malformed", raw };
  return { kind: "supervised", pid: Number(raw) };
}

/** The operator's sentence for a handoff that names no pid. */
function tipClaimHandoffRefusal(raw: string): string {
  return (
    `[flume] refuses: FLUME_TIP_CLAIM_HELD is set to '${raw}', which names ` +
    `no pid — the loop supervisor sets it to its own pid on the ticks it ` +
    `spawns (spec/loop.md, "The loop lock and the tip claim"). Unset it to ` +
    `run a tick that takes its own tip claim.`
  );
}

/**
 * What `flume render`, `flume tick` and `flume loop` are each handed — one
 * vocabulary for the three verbs that hold a dispatcher, so no two of them
 * spell the same request differently (`.claude/rules/engineering.md`, *A
 * module is one job*).
 */
export interface CliVerbRun {
  /** The two roots this process resolved, by reference, as a chain reads them. */
  readonly paths: FlumePaths;
  /** The argv words behind the verb, still unparsed. */
  readonly rest: string[];
  /** The CLI's stamped narration (`src/cliLog.ts`). */
  readonly log: Logger;
  /** The one chain-factory application a `flume tick` process makes. */
  readonly dispatcher: Dispatcher;
  /** Aborted by this process's teardown, reaching the agent a tick starts. */
  readonly stopTick: AbortController;
  /**
   * `true` when no supervisor handed this process a claim — the bare tick
   * that acquires and releases one of its own around its single tick.
   */
  readonly takesOwnTipClaim: boolean;
}

/**
 * The context resolved, or the one refusal resolving it can take.
 *
 * Refused is the malformed handoff alone, reported here because the value is
 * this module's to decode and a caller re-deriving the sentence would be a
 * second spelling of it.
 */
type RunContextResolution =
  | { readonly kind: "refused"; readonly exitCode: number }
  | { readonly kind: "ready"; readonly run: CliVerbRun };

export function resolveRunContext(base: {
  readonly paths: FlumePaths;
  readonly rest: string[];
  readonly log: Logger;
}): RunContextResolution {
  const { paths, rest, log } = base;
  // The `flume loop` supervisor's run-scoped quarantine crosses the process
  // boundary via this env var (set by `defaultTickRunner`,
  // `src/loopSupervisor.ts`) — an entry whose quarantine key (`slug@hash` of
  // its bytes in the queue) is named here is skipped by this tick's fanout pick
  // without touching the queue. The values are opaque equality keys, split
  // apart on the comma the writer joined on and never parsed further: the hash
  // half means an entry re-scoped since the failing tick simply stops
  // matching, which is how a re-scope lifts a hold without a relaunch.
  const quarantinedSlugs = process.env.FLUME_QUARANTINED_SLUGS
    ? new Set(process.env.FLUME_QUARANTINED_SLUGS.split(",").filter(Boolean))
    : undefined;
  // The supervisor's handoff, decoded once for the three facts this run reads
  // off it ({@link decodeTipClaimHandoff}) — and refused here, ahead of the
  // dispatcher and of any tick, when it is present and names no pid.
  const tipClaimHandoff = decodeTipClaimHandoff(
    process.env.FLUME_TIP_CLAIM_HELD,
  );
  if (tipClaimHandoff.kind === "malformed") {
    log.error(tipClaimHandoffRefusal(tipClaimHandoff.raw));
    return { kind: "refused", exitCode: 1 };
  }
  // spec/loop.md "The loop lock and the tip claim": which pid the wave's own
  // tip-verify checks (`liveForeignClaimPid`, `src/tipVerify.ts`) treat as
  // this run's own rather than a foreign concurrent engine — a loop-spawned
  // child's supervisor, or this process's own pid otherwise, which is exactly
  // the pid a bare tick's own claim (`src/cliTick.ts`) is filed under.
  const ownTipClaimPid =
    tipClaimHandoff.kind === "supervised" ? tipClaimHandoff.pid : process.pid;
  // spec/loop.md "Graceful stop — the stop flag": the flag ends a
  // supervisor's iteration and a supervised wave's refill, and a bare tick
  // ignores it. The same handoff says which this process is — the supervisor
  // sets it on the children it spawns — so the CLI states the fact and the
  // wave never infers it from a quarantine set or a pid match
  // (.claude/rules/engine-boundary.md, "Told, not inferred").
  const supervisedRun = tipClaimHandoff.kind === "supervised";
  // This process's teardown, reaching the agent a tick starts: the tick
  // command's signal handlers abort it and await the tick, so the agent tree
  // is gone before the tip claim drops (spec/loop.md, "The loop lock and the
  // tip claim"). Constructed here because the dispatcher is — the signal
  // handlers that abort it are installed by `flume tick` (`src/cliTick.ts`),
  // the only verb that runs one.
  const stopTick = new AbortController();
  // Dispatcher resolves .flume/chain.ts from configDir once at tick start —
  // the one chain-factory application a `flume tick` process makes, which is
  // why every fact a tick needs off its chain is read back off the dispatcher
  // rather than resolved again by a verb (`Dispatcher.agentKillGraceMs` is the
  // teardown's). `flume loop` re-resolves by spawning a fresh `flume tick` per
  // iteration; a chain.ts whose factory returns `agent` overrides the default
  // agent per tick.
  const dispatcher = new Dispatcher({
    repoRoot: paths.repoRoot,
    configDir: paths.configDir,
    flumeDir: paths.flumeDir,
    agent: claudeCode(),
    ownTipClaimPid,
    supervisedRun,
    stopSignal: stopTick.signal,
    // The CLI's own stamp, in place of the engine's unstamped default
    // (`consoleLogger`, `src/log.ts`): a tick child's harness narration
    // reaches the operator through this dispatcher, interleaved with the
    // supervisor's own lines on one inherited stream, and an unstamped line
    // among stamped ones is the one an operator cannot place.
    log,
    ...(quarantinedSlugs ? { quarantinedSlugs } : {}),
  });
  return {
    kind: "ready",
    run: {
      paths,
      rest,
      log,
      dispatcher,
      stopTick,
      takesOwnTipClaim: tipClaimHandoff.kind === "bare",
    },
  };
}
