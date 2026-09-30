/**
 * thrown — the one reading of a value a `catch` received: the sentence the
 * harness prints for it, and the two facts a record reports about it.
 *
 * `catch` binds `unknown`, and every stage of a tick that turns a throw into
 * operator-facing prose, a failure signature, a gate's `details` or a refusal
 * summary needs the same reading of it. One home, so a thrown non-`Error`
 * reads the same wherever it surfaces (`.claude/rules/engineering.md`, *A
 * module is one job*).
 *
 * The guarded reading is the one that holds for every input, and the throws
 * this covers include chain-author code — a `setupWorktree` hook, the module
 * `chainLoadGate` loads, a `handoff`, an `Agent.invoke` adapter — which the
 * engine does not get to assume threw an `Error`. A cast prints `undefined`
 * for a thrown string, and for a thrown `null` it throws a `TypeError` inside
 * the `catch` itself: a second failure raised from the handler that exists to
 * account for the first, escaping past the accounting rather than being
 * recorded by it (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * On the `Error` path the text is `err.message` unchanged, so the strings an
 * operator greps for are the ones every site already emits.
 */

/**
 * What a throw reports: the message it raised and, when it has one, the stack
 * that raised it. Every seam that answers a throw with a record rather than
 * losing the tick reads it here — a gate's `{ message, details }`
 * (`spec/chain.md`, *What a gate returns*) and a hook's render-refused record
 * (*What a hook receives*) are the same two facts under two names, so the
 * decoding is shared rather than re-derived beside each one
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * `stack` is absent rather than a second copy of `message` when the thrown
 * value has none — a non-`Error`, or an `Error` whose `stack` was stripped —
 * because a duplicated line reads as evidence while carrying none
 * (*Derived state is computed, never restated beside its source*).
 */
export function throwFacts(err: unknown): { message: string; stack?: string } {
  const message = err instanceof Error ? err.message : String(err);
  const stack =
    err instanceof Error && typeof err.stack === "string" && err.stack
      ? err.stack
      : undefined;
  return stack ? { message, stack } : { message };
}

/**
 * The message half of {@link throwFacts}, for the sites whose record is one
 * sentence — a log line, a signature, a gate's `details`. Computed from the
 * facts rather than respelling the same guard beside them, so the text a
 * stack-carrying site reports and the text a one-line site reports cannot
 * drift (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 */
export function thrownMessage(err: unknown): string {
  return throwFacts(err).message;
}
