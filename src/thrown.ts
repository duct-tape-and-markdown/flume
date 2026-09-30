/**
 * thrown — the one fold from a value a `catch` received to the sentence the
 * harness prints for it.
 *
 * `catch` binds `unknown`, and every stage of a tick that turns a throw into
 * operator-facing prose, a failure signature, a gate's `details` or a refusal
 * summary needs the same reading of it. One home, so a thrown non-`Error`
 * reads the same wherever it surfaces (`.claude/rules/engineering.md`, *A
 * module is one job*).
 *
 * The guarded reading is the one that holds for every input, and the throws
 * this covers include chain-author code — a `setupWorktree` hook, the module
 * `chainLoadGate` loads, a `handoff` — which the engine does not get to
 * assume threw an `Error`. A cast prints `undefined` for a thrown string, and
 * for a thrown `null` it throws a `TypeError` inside the `catch` itself:
 * a second failure raised from the handler that exists to account for the
 * first, escaping past the accounting rather than being recorded by it
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * On the `Error` path the text is `err.message` unchanged, so the strings an
 * operator greps for are the ones every site already emits.
 */
export function thrownMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
