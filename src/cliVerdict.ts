/**
 * Tick/loop verdict formatting and exit-code classification, split out of
 * `src/cli.ts` (`.claude/rules/posture-sweep.md`, "A violation counts only
 * when verified on disk this tick").
 */

import { type TickOutcome } from "./Dispatcher.js";
import { EX_TERMINAL_MISCONFIG, EX_MOUNT_DEAD } from "./exitCodes.js";
import { type PhaseAgentUsage, type TickVerdict } from "./tickVerdict.js";
import type { SuperviseResult } from "./loopSupervisor.js";
import type { CurrentRef } from "./git.js";

/**
 * Map a tick outcome to the `flume tick` process exit code: 78 (`EX_CONFIG`)
 * terminal misconfiguration (a chain that resolved but declares an
 * inconsistent world), 2 (usage) the CJS-context refusal (a nameable fix,
 * checked before `failed` since a chain-load failure sets at most one of the
 * two) and a `--phase <name>` the chain does not declare
 * (`TickOutcome.undeclaredPhase`), 1 a ledger commit that refused for
 * anything but an unparseable queue (`TickOutcome.ledgerRefusal`), 69
 * (`EX_UNAVAILABLE`, {@link EX_MOUNT_DEAD}) every other failed tick, 0
 * otherwise (work done or clean hibernation). Exported for the exit-code
 * seam tests.
 *
 * The 1 arm is the failure here that says nothing about the mount: the
 * chain loaded, the wave ran, its entries are on trunk, and only the queue
 * rewrite's own `git commit` refused — a paused cherry-pick, a lost
 * `index.lock`. Exiting 69 over that fail-fasts `flume loop` as mount-dead
 * (spec/loop.md, *Exit codes — the run never lies to CI*) over a wall the
 * next process has every reason to get past, so it exits 1 and the run
 * proceeds. An unparseable queue keeps 69: a fresh process reads the same
 * bytes until the queue's declared writer runs over them.
 *
 * An undeclared `--phase` name is neither: it is argv the surface cannot
 * honor as typed, which is the usage class every other verb already answers
 * with — `wake`, `sleep` and `render` all exit 2 on a phase name their
 * chain does not declare (spec/cli.md, *Subcommand surface*). One refusal
 * carries one code whichever verb is handed it. Reached before `failed`
 * because the code is the request's, not the tick's: no agent ran, no baton
 * flag moved, and the chain mounted fine.
 */
export function tickExitCode(outcome: TickOutcome): number {
  if (outcome.terminal) return EX_TERMINAL_MISCONFIG;
  if (outcome.usageError || outcome.undeclaredPhase) return 2;
  if (!outcome.failed) return 0;
  return outcome.ledgerRefusal === "commit-refusal" ? 1 : EX_MOUNT_DEAD;
}

/**
 * Map a whole `flume loop` supervised run to its process exit
 * code: `terminal`/`mountDead` propagate the child's abort code unchanged.
 * `repeatedFailure` is unconditionally non-zero — the consecutive-failure
 * backstop fired regardless of how much the run shipped before hitting the
 * wall. Otherwise non-zero iff at least one child tick errored AND the run
 * shipped nothing — "settled with nothing to do" (no errors) and partial
 * success (ships landed despite some tick errors) both stay 0. Exported for
 * the exit-code seam tests.
 */
export function loopExitCode(result: SuperviseResult): number {
  if (result.terminal) return EX_TERMINAL_MISCONFIG;
  if (result.mountDead) return EX_MOUNT_DEAD;
  if (result.repeatedFailure) return 1;
  return result.erroredTicks.length > 0 && result.shippedTags.length === 0
    ? 1
    : 0;
}

/**
 * `tick` and `loop`'s pre-work refusal message for a `CurrentRef` that failed
 * to name a ref — one branch per {@link CurrentRef} failure kind, so a caller
 * outside a repository is told that, not "HEAD is detached". Exhaustive over
 * the non-`"ref"` kinds; a new kind is a compile error here, not a silent
 * fallthrough.
 */
export function describeRefFailure(
  ref: Exclude<CurrentRef, { kind: "ref" }>,
): string {
  switch (ref.kind) {
    case "detached":
      return "HEAD is detached — checkout a branch first";
    case "not-a-repository":
      return "not a git repository";
    case "git-unavailable":
      return `git failed to run (${ref.message})`;
  }
}

/**
 * `flume loop`'s completion summary line naming surfaced tick
 * errors, an abort on the consecutive-failure backstop (named by the stage
 * `superviseLoop` reported it against — provision, merge or gate — never
 * fixed to one of the three), (spec/loop.md "Graceful stop — the stop flag")
 * a stop-flag-ended run, and what the run spent on agents, by phase —
 * undefined when the run had none of these. Printed even on a 0 exit (partial
 * success, or a graceful stop): none of these facts may vanish into a green
 * exit silently, and what a run cost is read where its outcome is rather than
 * by re-reading the verdict log.
 *
 * The spend is last: an error or an abort is what an operator reads first,
 * and the totals are context for it.
 */
export function loopCompletionSummary(
  result: SuperviseResult,
): string | undefined {
  const parts: string[] = [];
  if (result.stoppedByFlag) {
    parts.push(
      `stop flag present: ended the run after ${result.ticks} tick(s)`,
    );
  }
  if (result.repeatedFailure) {
    parts.push(
      `aborted: identical ${result.repeatedFailure.stage}-stage failure ` +
        `repeated ${result.repeatedFailure.count} consecutive ticks — ` +
        `${result.repeatedFailure.signature}`,
    );
  }
  if (result.erroredTicks.length > 0) {
    const shipped =
      result.shippedTags.length > 0
        ? `shipped ${result.shippedTags.join(", ")}; `
        : "";
    parts.push(
      `${shipped}${result.erroredTicks.length} tick(s) errored: ` +
        result.erroredTicks.join(" | "),
    );
  }
  const spend = agentUsageLine("agent usage", result.agentUsageByPhase);
  if (spend) parts.push(spend);
  if (parts.length === 0) return undefined;
  return `[flume] ${parts.join(" | ")}`;
}

/**
 * `label`, then one segment per phase — the whole spend line, or `undefined`
 * when the span spent nothing (a phase that never invoked an agent is absent
 * from the fold rather than present at zero — `totalAgentUsageByPhase`
 * (`src/tickVerdict.ts`)).
 *
 * Both surfaces that report spend take this: `flume loop`'s completion
 * summary for the run it just finished, `flume status` for what the live run
 * has spent so far. The label is each surface's own sentence; the numbers
 * are not respelled beside each other (`.claude/rules/engineering.md`, *The
 * fix lands at the mechanism*).
 */
export function agentUsageLine(
  label: string,
  byPhase: readonly PhaseAgentUsage[],
): string | undefined {
  if (byPhase.length === 0) return undefined;
  return `${label}: ${byPhase.map(phaseUsageSegment).join("; ")}`;
}

/**
 * One phase's totals as the spend line spells them. Every total the
 * supervisor carries is named: a count the engine summed and then declined to
 * print is a fact it holds and does not report. Raw counts rather than
 * abbreviated ones — the line is read by CI as often as by a person, and a
 * rounded token count is not a number anything can add up.
 */
function phaseUsageSegment(usage: PhaseAgentUsage): string {
  return (
    `${usage.phase} ×${usage.invocations} ` +
    `(${usage.turns} turns, ${(usage.durationMs / 1000).toFixed(1)}s, ` +
    `${usage.inputTokens} in / ${usage.outputTokens} out tokens, ` +
    `${usage.cacheCreationInputTokens} cache-write / ` +
    `${usage.cacheReadInputTokens} cache-read, ` +
    `$${usage.costUsd.toFixed(4)})`
  );
}

/**
 * `flume log`'s human-form line for one `TickVerdict` — the exact five field
 * groups spec/cli.md's "Subcommand surface" names for that form: phase,
 * committed, gate results, shipped tags, merge outcomes. A rendering of
 * those fields alone, nothing derived or reclassified from them — no
 * park/bail vocabulary, which is the chain's own reading, not engine
 * vocabulary (.claude/rules/engine-boundary.md, "Told, not inferred").
 */
export function formatTickVerdictLine(v: TickVerdict): string {
  const gates = v.gateResults
    .map((g) => `${g.gate}:${g.ok ? "ok" : "FAIL"}`)
    .join(",");
  const merge = v.mergeOutcomes
    // A singleton phase's own span carries no tag
    // (`TickVerdictMergeOutcome.entryTag`), so it renders as the bare
    // outcome. Not the phase name in its place: the line's first field
    // already states it (.claude/rules/engineering.md, "Derived state is
    // computed, never restated beside its source").
    .map((m) => (m.entryTag === undefined ? m.outcome : `${m.entryTag}:${m.outcome}`))
    .join(",");
  return (
    `${v.phaseName}  committed=${v.committed}  gates=[${gates}]  ` +
    `shipped=[${v.shippedTags.join(",")}]  merge=[${merge}]`
  );
}
