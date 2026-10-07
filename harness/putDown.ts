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
 * The third reading is the one *inside* a record rather than at its path: the
 * step tags a session names as finished (`spec/harness.md`, *A tick puts work
 * down*). Two surfaces ask it — the `shipped` predicate, which ships exactly
 * those tags, and the records gate, which refuses a tag the entry does not
 * carry — and a second parse beside either is the copy that stops matching
 * the day the line's spelling moves, in the direction that ships nothing and
 * says nothing.
 *
 * The paths themselves stay `layout.ts`'s; what lives here is only what each
 * location *means* to a commit that touched it, and what a record *says* about
 * which of the entry's steps are done.
 */

import { join } from "node:path";

import { existsLoud, readFileLoudUnder } from "../src/fsProbe.js";
import { namespacedJoin } from "../src/paths.js";
import type { PendingEntry } from "../src/PendingSchema.js";

import { continuingNotePath, notePath, parkedNotePath } from "./layout.js";

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

/**
 * The lead a record's step line opens with — the one spelling the build prompt
 * tells a session to write and both readers below look for.
 *
 * One constant, because the prompt's paragraph and the parse are two sides of
 * one seam: a lead spelled twice is a prompt asking for a line nothing reads.
 */
export const FINISHED_STEPS_LEAD = "Finished";

/**
 * The step tags a record names as finished — every token on a line whose lead
 * is {@link FINISHED_STEPS_LEAD}, in the order the record names them, each
 * token once.
 *
 * **Every token, never only the ones that look like tags.** A line carrying
 * prose or a misspelling yields tags the entry does not carry, which the
 * records gate refuses by name; a parse that kept only well-formed-looking
 * tokens would drop a typo silently and ship nothing, which is the one outcome
 * the spec names as the failure to avoid (`.claude/rules/engineering.md`,
 * *Loud or nothing*). So the tolerance here is in the *decoration* an agent
 * writes around a list and nowhere else: a leading bullet or blockquote mark,
 * bold around the lead, backticks around a tag, a trailing sentence stop.
 *
 * `null` — no such record at all — names nothing, which is the same answer as
 * a record with no such line: a commit that did not say which steps it
 * finished finished none it can be held to.
 */
export function namedSteps(text: string | null): string[] {
  if (text === null) return [];
  const named: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[\s>#*+-]+/, "").replaceAll("**", "");
    const lead = `${FINISHED_STEPS_LEAD}:`;
    if (line.slice(0, lead.length).toLowerCase() !== lead.toLowerCase())
      continue;
    for (const token of line.slice(lead.length).split(/[,\s]+/)) {
      const tag = token.replaceAll("`", "").replace(/[.;:]+$/, "");
      if (tag.length > 0 && !named.includes(tag)) named.push(tag);
    }
  }
  return named;
}

/**
 * The step tags the record a span wrote names as finished, read off the span's
 * own tree.
 *
 * **Which record is the kind the span declared** ({@link putDownPredicate}),
 * and the kinds are not interchangeable: a session that put the rest of the
 * entry down says what it finished in its continuation, and one that finished
 * the entry says it in its note to plan, so reading the wrong one of the two
 * would read an absent file and ship nothing. A **park** names none — nothing
 * of a refused entry leaves the queue, whatever its note lists — so the park
 * is answered here rather than left to a caller's own branch beside the
 * ship.
 *
 * The tree is the span's, for the reason {@link putDownPredicate} reads one:
 * the record this asks about is the one *that commit* left, and trunk by
 * classification time carries every sibling in the wave.
 */
export function finishedSteps(
  stateRoot: string,
  entry: PendingEntry,
  span: PutDownSpan,
  kind: PutDownKind | undefined,
): string[] {
  if (kind === "parked") return [];
  const rel =
    kind === "continuing"
      ? continuingNotePath(stateRoot, entry.tag)
      : notePath(stateRoot, entry.tag);
  // Joined with `node:path` and namespaced by the reader at the syscall, not
  // here: the descent the reader runs measures `path` against `root`, and a
  // namespaced path measured against a plain root sits under nothing
  // (`readFileLoudUnder`, `src/fsProbe.ts`).
  return namedSteps(readFileLoudUnder(RECORD_SUBJECT, span.tree, join(span.tree, rel)));
}

/**
 * The subject a refused read of a record reports — the span's own tree, which
 * is what an obstructed ancestor under it means.
 */
const RECORD_SUBJECT = "the span's record";
