/**
 * gateDeadline — the wall clock every child the engine runs on a gate's
 * behalf is held to: the scope one gate invocation opens, and the bound a
 * spawn inside it takes.
 *
 * The bound is **ambient rather than threaded** because the children are not
 * all the engine's own to name. A gate's declared command is
 * (`shellGate`, `src/builtinGates.ts`), and so is every git invocation a gate
 * drives through the API; but a shipped runner's tool spawn
 * (`captureRun`, `harness/toolRun.ts`) and the provisioning a base run lays
 * down (`setupWorktree`, `src/setupWorktree.ts`) reach the same doors from
 * code the engine never sees a call site of. One scope at the gate boundary
 * covers all of them, and a door added later inherits the bound instead of
 * having to remember it (`.claude/rules/engineering.md`, *The fix lands at
 * the mechanism*).
 *
 * **What the deadline reached does is lose the gate, not the spawn.** The
 * refusal rejects the gate invocation itself, so a gate that catches its
 * command's failure — which every gate that reports a non-zero exit as a
 * verdict does — cannot absorb the engine's own refusal and report a verdict
 * over a child that was killed (`.claude/rules/engineering.md`, *Loud or
 * nothing*). The gate then fails exactly the way a gate that threw does
 * (`runGate`, `src/gateRun.ts`).
 *
 * **And it settles on its own clock, not the child's.** `execFile` resolves
 * on the child's `close`, which waits for the captured streams to close, so
 * a grandchild holding the inherited stdout keeps that promise pending after
 * the child it was spawned by is gone. Racing the gate against the deadline
 * is what makes the refusal arrive at the stated millisecond whatever the
 * pipes do.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { PromiseWithChild } from "node:child_process";

import {
  DEFAULT_KILL_GRACE_MS,
  terminateProcessTree,
  type SignalReach,
} from "./processTree.js";

/**
 * How far the termination of a gate's child reaches: the child itself.
 *
 * `execFile` is what every spawn door here starts its child through, and node
 * composes that spawn's options itself — `detached` among the ones it does
 * not forward — so the child sits in the engine's own process group and there
 * is no group of its own to signal. A grandchild the gate's command spawned
 * is reparented and survives, which is the narrower reach stated rather than
 * assumed (`.claude/rules/engineering.md`, *Loud or nothing*): the deadline's
 * job is that the gate fails loudly at the stated millisecond, and reaching a
 * grandchild would take a capturing door this package does not have.
 */
const GATE_CHILD_REACH: SignalReach = "child";

/**
 * What a chain declared about the children its gates run — the deadline each
 * is held to, and the grace one that reached it gets before the SIGKILL.
 *
 * Both optional and read independently: an absent `timeoutMs` is **no cap**,
 * which is the shape `AgentBounds` (`src/tickAttempt.ts`) already takes for
 * the per-invocation one, and an absent grace is
 * {@link DEFAULT_KILL_GRACE_MS}.
 */
export interface GateBounds {
  timeoutMs?: number;
  killGraceMs?: number;
}

/**
 * The refusal a reached deadline raises, naming the deadline and the command
 * it bounded.
 *
 * The command is the line the engine spawned, so an operator reading a gate
 * row knows which of a gate's children stalled — a gate runs more than one,
 * and "the gate timed out" names none of them.
 */
function deadlineRefusal(
  command: string,
  timeoutMs: number,
  graceMs: number,
): Error {
  return new Error(
    `\`${command}\` was still running ${timeoutMs}ms after the engine ` +
      `started it, which is the gate deadline this chain declares ` +
      `(supervisorPolicy.gateTimeoutMs). It was signalled SIGTERM and ` +
      `SIGKILLed ${graceMs}ms later, and this gate fails on the deadline ` +
      `rather than waiting on a child that may never exit.`,
  );
}

/**
 * One gate invocation's deadline: the timers armed over its children, and the
 * refusal the first child to reach the deadline loses the invocation with.
 *
 * The refusal is held as a rejected promise rather than a flag a caller polls
 * — the point of the deadline is that nothing downstream has to remember to
 * look (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
class GateDeadline {
  /** Armed deadlines, by the child each bounds, cleared when the gate returns. */
  private readonly armed = new Set<NodeJS.Timeout>();
  private breach: ((err: Error) => void) | undefined;
  /** Rejects with {@link deadlineRefusal} when a child of this gate reaches the deadline. */
  readonly breached: Promise<never>;

  constructor(
    private readonly timeoutMs: number,
    private readonly graceMs: number,
  ) {
    this.breached = new Promise<never>((_resolve, reject) => {
      this.breach = reject;
    });
  }

  /**
   * Arm this gate's deadline over `spawned`'s child and hand the spawn back
   * unchanged, so the caller still reads whatever the child wrote.
   *
   * The arming is cancelled at the child's own `exit`, so a child that
   * finished inside the deadline leaves nothing to fire, and the escalation
   * can never land on a pid that is no longer this child's
   * (`.claude/rules/platform-facts.md`, *A reaped pid returns to the host's
   * allocation pool*).
   */
  bound<T>(spawned: PromiseWithChild<T>, command: string): PromiseWithChild<T> {
    const { child } = spawned;
    const deadline = setTimeout(() => {
      this.armed.delete(deadline);
      terminateProcessTree(child, {
        graceMs: this.graceMs,
        reach: GATE_CHILD_REACH,
      });
      this.breach?.(deadlineRefusal(command, this.timeoutMs, this.graceMs));
    }, this.timeoutMs);
    this.armed.add(deadline);
    child.once("exit", () => {
      clearTimeout(deadline);
      this.armed.delete(deadline);
    });
    return spawned;
  }

  /** Drop every armed deadline — the gate has ruled, so none of them is still its. */
  disarm(): void {
    for (const timer of this.armed) clearTimeout(timer);
    this.armed.clear();
  }
}

/**
 * The deadline in flight, or none. One store, read by every spawn door rather
 * than passed down through the call chains that reach them.
 */
const inFlight = new AsyncLocalStorage<GateDeadline>();

/**
 * Run `gate` under `bounds`, so every child a spawn door starts inside it is
 * held to the declared deadline — and the invocation loses to the first child
 * that reaches one.
 *
 * A chain declaring no deadline runs `gate` with no store entered at all, so
 * {@link underGateDeadline} finds nothing and every spawn is byte-identical
 * to one made outside a gate. No engine default stands in: a tick runs
 * without a cap, so a cap is the chain's to declare
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
 *
 * The invocation's own promise keeps a rejection handler of its own: the race
 * reads whichever settles first, and the loser's failure — the spawn the
 * SIGTERM broke, most often — is a rejection nothing else would ever read
 * (`.claude/rules/platform-facts.md`, *vitest's JSON reporter can claim
 * success over a non-zero exit*).
 */
export function withGateDeadline<T>(
  bounds: GateBounds,
  gate: () => Promise<T>,
): Promise<T> {
  const { timeoutMs } = bounds;
  if (timeoutMs === undefined) return gate();
  const deadline = new GateDeadline(
    timeoutMs,
    bounds.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
  );
  return inFlight.run(deadline, async () => {
    const ran = gate();
    void ran.catch(() => {});
    try {
      return await Promise.race([ran, deadline.breached]);
    } finally {
      deadline.disarm();
    }
  });
}

/**
 * `spawned` under whatever deadline the gate invocation around it declared,
 * or `spawned` itself where there is no gate in flight and where the chain
 * declared no deadline — the two cases a spawn door cannot tell apart and
 * does not need to.
 *
 * `command` is the line the engine spawned, for the refusal to name.
 */
export function underGateDeadline<T>(
  spawned: PromiseWithChild<T>,
  command: string,
): PromiseWithChild<T> {
  return inFlight.getStore()?.bound(spawned, command) ?? spawned;
}
