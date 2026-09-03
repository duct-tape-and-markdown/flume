/**
 * Tick/loop verdict formatting and exit-code classification, split out of
 * `src/cli.ts` (`.claude/rules/posture-sweep.md`, "A violation counts only
 * when verified on disk this tick").
 */

import {
  EX_TERMINAL_MISCONFIG,
  EX_MOUNT_DEAD,
  type TickOutcome,
  type SuperviseResult,
  type TickVerdict,
} from "./Dispatcher.js";
import type { CurrentRef } from "./git.js";

/**
 * Map a tick outcome to the `flume tick` process exit code — the process
 * boundary classification at the intersection of §3, v0.7 §4, and v0.7 §5:
 * 78 (`EX_CONFIG`) terminal misconfiguration (a chain that resolved but
 * declares an inconsistent world), 2 (usage) the RELEASE-v0.7 §5
 * CJS-context refusal (a nameable fix, checked before `failed` since a
 * chain-load failure sets at most one of the two), 69 (`EX_UNAVAILABLE`,
 * {@link EX_MOUNT_DEAD}) the chain never resolved at all for any other
 * reason, 0 otherwise (work done or clean hibernation). Exported for the
 * exit-code seam tests.
 */
export function tickExitCode(outcome: TickOutcome): number {
  if (outcome.terminal) return EX_TERMINAL_MISCONFIG;
  if (outcome.usageError) return 2;
  return outcome.failed ? EX_MOUNT_DEAD : 0;
}

/**
 * Map a whole `flume loop` / `job run` supervised run to its process exit
 * code (v0.7 §4, amended): `terminal`/`mountDead` propagate the child's
 * abort code unchanged (§3, v0.7 §4's mount-dead class). `repeatedFailure`
 * (§16) is unconditionally non-zero — the consecutive-failure backstop
 * fired regardless of how much the run shipped before hitting the wall.
 * Otherwise non-zero iff at least one child tick errored AND the run shipped
 * nothing — "settled with nothing to do" (no errors) and partial success
 * (ships landed despite some tick errors) both stay 0. Exported for the
 * exit-code seam tests.
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
 * `tick` and `loop`'s pre-work refusal message for a `CurrentRef` that
 * failed to name a ref — one branch per {@link CurrentRef} failure kind, so
 * a caller outside a repository is told that, not "HEAD is detached"
 * (v0.11 §4 drift). Exhaustive over the non-`"ref"` kinds; a new kind is a
 * compile error here, not a silent fallthrough.
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
 * `flume loop` / `job run`'s completion summary line naming surfaced tick
 * errors, (§16) an abort on the consecutive-failure backstop, and (spec/
 * loop.md "Graceful stop") a stop-flag-ended run — undefined when the run
 * had none of these. Printed even on a 0 exit (partial success, or a
 * graceful stop): none of these facts may vanish into a green exit silently
 * (v0.7 §4).
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
      `aborted: identical worktree provisioning failure repeated ` +
        `${result.repeatedFailure.count} consecutive ticks — ` +
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
  if (parts.length === 0) return undefined;
  return `[flume] ${parts.join(" | ")}`;
}

/**
 * `flume log`'s human-form line for one `TickVerdict` — the exact five field
 * groups spec/cli.md's "Subcommand surface" names for that form: phase,
 * committed, gate results, shipped tags, merge outcomes. A rendering of
 * those fields alone, nothing derived or reclassified from them — no
 * park/bail vocabulary, which is the chain's own reading, not engine
 * vocabulary (engine-boundary.md, "Told, not inferred").
 */
export function formatTickVerdictLine(v: TickVerdict): string {
  const gates = v.gateResults
    .map((g) => `${g.gate}:${g.ok ? "ok" : "FAIL"}`)
    .join(",");
  const merge = v.mergeOutcomes
    .map((m) => `${m.tag}:${m.outcome}`)
    .join(",");
  return (
    `${v.phaseName}  committed=${v.committed}  gates=[${gates}]  ` +
    `shipped=[${v.shippedTags.join(",")}]  merge=[${merge}]`
  );
}
