/**
 * Running one gate — the single place a declared {@link Gate}'s `run` is
 * called, for every gate-run site in the engine.
 *
 * The attempt's afterCommit loop (`src/tickAttempt.ts`) and the two legs'
 * afterMerge loops (`src/singletonTick.ts`, `src/waveTick.ts`) call through
 * here rather than pasting their own
 * guard, so what a throwing gate becomes, and what a gate's checkout is
 * reclaimed by, is spelled once (`.claude/rules/engineering.md`, *The fix
 * lands at the mechanism*).
 */

import type { Gate, GateContext, GateResult } from "./Gate.js";
import type { Logger } from "./log.js";
import { throwFacts } from "./tickVerdict.js";
import { withGateCheckouts, type WorktreeContext } from "./worktrees.js";

/**
 * What a gate run needs from whoever is running it: the worktree context its
 * checkouts are scoped by, and the logger a throw is narrated to.
 */
export interface GateRunScope {
  readonly worktreeCtx: WorktreeContext;
  readonly log: Logger;
}

/**
 * **A gate that throws is a gate that failed** (spec/chain.md "What a gate
 * returns"): the throw is recorded as `{ ok: false, message: <the error's
 * message>, details: <its stack> }` and the tick continues into exactly the
 * bookkeeping a returned refusal gets — verdict written, merge reverted or
 * refused. A gate's exception is a fact about the gate, never a reason to
 * lose the tick's facts or to strand a merge behind the crash marker
 * (spec/loop.md "Crash equals stop").
 *
 * The stack rides as `details` because that is the field a returned refusal
 * carries its full output in — so the retry prompt and the prior-attempt
 * record show the frame that raised, not one line of message. A throw with
 * no stack — a non-`Error` value, or an `Error` whose `stack` was stripped —
 * records **no** `details` rather than a second copy of `message`: a
 * duplicated line reads as evidence while carrying none
 * (`.claude/rules/engineering.md` "Derived state is computed, never restated
 * beside its source").
 *
 * It is also the one **reclamation** point for what a gate checked out:
 * `withGateCheckouts` (`src/worktrees.ts`) scopes the invocation, and any
 * detached tree the gate asked the API for (`api.git.checkoutAt`) is
 * removed when this call unwinds — returned verdict and throw alike, so a
 * differential gate that crashed mid-run cannot leak the tree it was
 * reading (spec/chain.md "What a gate receives"). The scope takes the same
 * `worktreeCtx` every other worktree call site the caller makes reads, so
 * where a gate's checkout lands — declared base and job namespace both — is
 * the placement the startup sweep goes on to read, never a second
 * composition of it.
 */
export async function runGate(
  gate: Gate,
  ctx: GateContext,
  scope: GateRunScope,
): Promise<GateResult> {
  try {
    return await withGateCheckouts(scope.worktreeCtx, () => gate.run(ctx));
  } catch (err) {
    const { message, stack } = throwFacts(err);
    scope.log.warn(
      `[flume] gate '${gate.name}' threw: ${message}; recorded as that gate's failure`,
    );
    return { ok: false, message, ...(stack ? { details: stack } : {}) };
  }
}
