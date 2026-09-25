/**
 * Tick/loop verdict formatting and exit-code classification, split out of
 * `src/cli.ts` (`.claude/rules/posture-sweep.md`, "A violation counts only
 * when verified on disk this tick").
 */

import { type TickOutcome } from "./Dispatcher.js";
import { clauseOf, type ExitCauseLabel } from "./exitCauses.js";
import { EX_TERMINAL_MISCONFIG, EX_MOUNT_DEAD } from "./exitCodes.js";
import { type PhaseAgentUsage, type TickVerdict } from "./tickVerdict.js";
import type { SuperviseResult } from "./loopSupervisor.js";
import type { CurrentRef } from "./git.js";

/**
 * A `flume tick` exit code and why the process took it — the cause phrase
 * every surface that documents that code states for it, so a re-route
 * between two codes already in the verb's range moves the phrase with it
 * instead of leaving a page describing the code it used to be
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * One standalone clause per cause: the reader of these is a `--help`
 * exit-code block (`src/cliHelp.ts`), which lays each out on its own line
 * and supplies no connective vocabulary of its own. `docs/CLI.md` documents
 * the same range in its own register and cannot carry that clause whole,
 * so the clause designates the span both surfaces share as its
 * {@link ExitCauseLabel.phrase}.
 */
interface TickExitCause extends ExitCauseLabel {
  readonly code: number;
}

/**
 * One arm of {@link tickExitCode}: a {@link TickExitCause} plus the outcome
 * shape that reaches it, read in declaration order.
 */
interface TickExitArm extends TickExitCause {
  readonly when: (outcome: TickOutcome) => boolean;
}

/**
 * The arms {@link tickExitCode} reads, in order — the first whose `when`
 * holds decides the code. Ordered rather than keyed by it, because two arms
 * answer 2 and which shape reaches which is the order's to say.
 */
const TICK_EXIT_ARMS: readonly TickExitArm[] = [
  {
    // A chain that resolved but declares an inconsistent world.
    code: EX_TERMINAL_MISCONFIG,
    phrase: "Terminal misconfiguration",
    rest:
      " (EX_CONFIG): every awake flag names a phase the chain does not " +
      "declare. The flags are left on disk — inspect, then `flume sleep " +
      "<phase>` or fix the chain.",
    when: (outcome) => outcome.terminal !== undefined,
  },
  {
    // Argv the surface cannot honor as typed, which is the usage class every
    // other verb already answers with — `wake`, `sleep` and `render` all
    // exit 2 on a phase name their chain does not declare (spec/cli.md,
    // *Subcommand surface*). One refusal carries one code whichever verb is
    // handed it. Reached before `failed` because the code is the request's,
    // not the tick's: no agent ran, no baton flag moved, and the chain
    // mounted fine.
    code: 2,
    phrase: "`--phase <name>`",
    rest:
      " named a phase the chain does not declare — the refusal names the " +
      "phases it does, no agent runs, and no baton flag moves, the same " +
      "code `wake`, `sleep` and `render` answer an undeclared phase name " +
      "with.",
    when: (outcome) => outcome.undeclaredPhase !== undefined,
  },
  {
    // A nameable fix, and read before `failed` for the same reason: a
    // chain-load failure sets at most one of these two.
    code: 2,
    opening: "The chain load failed with ",
    phrase: "the CJS-context refusal",
    rest:
      " — the host repo's package.json (or the one beside .flume/chain.ts) " +
      'lacks "type": "module". Add it and re-run.',
    when: (outcome) => outcome.usageError === true,
  },
  {
    code: 0,
    opening: "Success, or ",
    phrase: "hibernation",
    rest: " (no phase awake).",
    when: (outcome) => outcome.failed !== true,
  },
  {
    // The failure here that says nothing about the mount: the chain loaded,
    // the wave ran, its entries are on trunk, and only the queue rewrite's
    // own `git commit` refused. Exiting 69 over that fail-fasts `flume loop`
    // as mount-dead (spec/loop.md, *Exit codes — the run never lies to CI*)
    // over a wall the next process has every reason to get past, so it exits
    // 1 and the run proceeds.
    code: 1,
    opening: "A wave whose entries merged and gated clean and whose ",
    phrase: "pending-ledger commit",
    rest:
      " then refused — a paused merge or cherry-pick in the checkout, a " +
      "lost index.lock: the shipped entries are on trunk, the chain is " +
      "fine, and a fresh process has every reason to get further. Clear " +
      "the refusal and re-run; the queue still names what has not shipped.",
    when: (outcome) => outcome.ledgerRefusal === "commit-refusal",
  },
];

/**
 * Every other failed tick's code and cause — the arm with no shape of its
 * own, held apart from {@link TICK_EXIT_ARMS} so the read below is total
 * without a predicate nothing can fail.
 *
 * An unparseable queue is in here rather than an arm of its own: a fresh
 * process reads the same bytes until the queue's declared writer runs over
 * them, so nothing about it is less dead than the mount.
 */
const TICK_EXIT_OTHERWISE: TickExitCause = {
  code: EX_MOUNT_DEAD,
  phrase: "Mount-dead",
  rest:
    " (EX_UNAVAILABLE): the chain module could not load, its state root is " +
    "missing, or its declaration is invalid. No agent ran — fix the chain " +
    "(or its state root) and re-run. Also the queue failing to parse, " +
    "where a fresh process reads the same bytes until the queue's declared " +
    "writer runs over them; a wave that shipped before its rewrite read " +
    "hit them still exits 69, and its work is on trunk.",
};

/**
 * Map a tick outcome to the `flume tick` process exit code — the first arm
 * above whose shape the outcome has, or {@link TICK_EXIT_OTHERWISE}.
 * Exported for the exit-code seam tests.
 */
export function tickExitCode(outcome: TickOutcome): number {
  const arm = TICK_EXIT_ARMS.find((candidate) => candidate.when(outcome));
  return (arm ?? TICK_EXIT_OTHERWISE).code;
}

/**
 * The arms that answer `code`, in the order {@link tickExitCode} reads
 * them — one walk, so the two reads below cannot disagree about which arms
 * a code has (`.claude/rules/engineering.md`, *A module is one job*). Empty
 * for a code no arm returns: the process reaches 74 without ever
 * classifying an outcome, and the page that documents that row owns its
 * causes.
 */
function tickExitArmsFor(code: number): TickExitCause[] {
  return [...TICK_EXIT_ARMS, TICK_EXIT_OTHERWISE].filter(
    (arm) => arm.code === code,
  );
}

/**
 * Why `flume tick` exits with `code` — one standalone clause per arm that
 * answers it, for a `--help` exit-code block to lay out.
 */
export function tickExitCauses(code: number): readonly string[] {
  return tickExitArmsFor(code).map(clauseOf);
}

/**
 * The phrase each of those arms is labelled with — what a surface
 * documenting `code` in a register of its own states that arm's cause
 * under, when the whole clause above is more than its register can carry
 * (`docs/CLI.md`, which spends one flowing sentence per verb on the range).
 */
export function tickExitPhrases(code: number): readonly string[] {
  return tickExitArmsFor(code).map((arm) => arm.phrase);
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
 * One phase's totals as the spend line spells them. That this names every
 * total the fold hands it is pinned against that fold's own output
 * (`tests/cliVerdict.test.ts`), so the roster here is checked rather than
 * promised. Raw counts rather than abbreviated ones — the line is read by CI
 * as often as by a person, and a rounded token count is not a number
 * anything can add up.
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
