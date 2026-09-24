/**
 * How a build commit says it **put its work down** — the package's one
 * reading of the two notes whose location is a verdict (`spec/harness.md`,
 * *A tick puts work down*): a park under the parked directory, a
 * continuation under the continuing one.
 *
 * Its own module because four surfaces ask the same question and none of
 * them owns it: the chain's `shipped` predicate, which decides whether the
 * entry leaves the queue; the judge's gate, which declines to rule on a span
 * that put its work down; the records gate, which holds a *finishing* commit
 * to taking the entry's continuation with it; and the inbox slice's
 * classifier, which reads the declaration back off the record a declined ship
 * left behind, to tell the park it must route from the continuation it must
 * not (`standingRefusal.ts`). A copy at any of them
 * is the one that goes stale (`.claude/rules/engineering.md`, *Derived state
 * is computed, never restated beside its source*), and a copy in a test is
 * the seam re-authored by the tester's hand (*A seam gate reads what the real
 * writer wrote*).
 *
 * The paths themselves stay `layout.ts`'s; what lives here is only what each
 * location *means* to a commit that touched it.
 */

import { existsLoud } from "../src/fsProbe.js";
import { namespacedJoin } from "../src/paths.js";
import type { PendingEntry } from "../src/PendingSchema.js";

import { continuingNotePath, parkedNotePath } from "./layout.js";

/**
 * Which note a build tick put its work down with — the two kinds whose
 * location says the entry is not finished (`spec/harness.md`, *A tick puts
 * work down*): a park, and a continuation.
 */
export type PutDownKind = "parked" | "continuing";

/**
 * The span a put-down is read from: what the commit touched, and a checkout
 * whose working tree *is* that commit — the tick's own worktree where a gate
 * runs `afterCommit` and where the ship classifies it, the trunk the span
 * landed on `afterMerge`.
 *
 * The tree rides along because the touch alone cannot tell a note written
 * from one removed, and one of the two kinds is removed by a build commit: a
 * park is plan's to drain, so a build tick only ever writes one, while a
 * continuation leaves with the tick that completes the entry. A predicate
 * reading the touch alone would read that removal as the declaration it
 * retires, and the entry the tick just finished would never leave the queue.
 */
export interface PutDownSpan {
  /** Repo-relative paths the span touched, as the engine reported them. */
  readonly touched: readonly string[];
  /** A checkout root whose working tree is the span's commit. */
  readonly tree: string;
}

/**
 * How a build commit put its work down, or `undefined` for one that finished
 * the entry.
 */
export type PutDownPredicate = (
  entry: PendingEntry,
  span: PutDownSpan,
) => PutDownKind | undefined;

/**
 * The package's predicate over a consumer's state root, repo-relative in
 * git's alphabet — the alphabet a span's touched paths arrive in.
 *
 * What it reads is **where** the tick wrote, and nothing about the shape of
 * the path list around it: a refusal that could not help leaving a
 * half-edited file behind is still a refusal, a segment that landed green is
 * still a continuation however much of the entry it covered, and a commit
 * carrying an observation note beside its work is a tick that shipped and had
 * something to say. Told, every way, rather than inferred from how much the
 * commit touched (`.claude/rules/engine-boundary.md`, *Told, not inferred*).
 *
 * The park is read first, so a tick that wrote both notes is the refusal it
 * declared rather than the continuation: only one of them can be true of an
 * entry, and the one that keeps the work in front of plan is the safer
 * reading of a tick that said two things.
 *
 * **The continuation is one that stands.** A park is plan's to drain, so the
 * only thing a build commit ever does to that path is write it; a
 * continuation leaves with the tick that completes the entry, whose commit
 * therefore touches that same path to remove it. Asking the span's own tree
 * whether the note is still there is what "a commit carrying a note at that
 * path" says: written, and not removed.
 */
export function putDownPredicate(stateRoot: string): PutDownPredicate {
  return (entry, span) => {
    const declared = declaredPutDown(stateRoot, entry, span.touched);
    if (declared !== "continuing") return declared;
    return existsLoud(
      namespacedJoin(span.tree, continuingNotePath(stateRoot, entry.tag)),
    )
      ? "continuing"
      : undefined;
  };
}

/**
 * Which put-down a commit **declared**, read from its touched paths alone —
 * the park first, for the reason {@link putDownPredicate} reads it first.
 *
 * What a touch cannot say is whether the note was written or *removed*, so a
 * reader holding the span's tree asks it ({@link putDownPredicate}). A reader
 * holding a record the `shipped` predicate already declined has that answer
 * in the record: a commit that removed a continuation is the tick that
 * finished its entry, which shipped, so no such record was written for it.
 *
 * Exported so the two readings share one spelling of where each note lives: a
 * second `includes` beside a record store is the copy that stops matching the
 * day a note's directory moves (`.claude/rules/engineering.md`, *The fix
 * lands at the mechanism*).
 */
export function declaredPutDown(
  stateRoot: string,
  entry: PendingEntry,
  touched: readonly string[],
): PutDownKind | undefined {
  if (touched.includes(parkedNotePath(stateRoot, entry.tag))) return "parked";
  if (touched.includes(continuingNotePath(stateRoot, entry.tag)))
    return "continuing";
  return undefined;
}
