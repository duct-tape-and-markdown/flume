/**
 * The declared friction channel as a findings source (`spec/harness.md`,
 * *Declared findings sources*) — what is waiting in it under a state root,
 * and whether the inbox slice's friction leg is open right now.
 *
 * The channel itself is the **engine's**: `Chain.friction` declares it, the
 * engine creates it lazily, writes a revert note into it, harvests a torn-down
 * worktree's mirror into it, counts it for `flume status`, and seeds the
 * ignore line that keeps it untracked (`spec/chain.md`, *`Chain.friction` —
 * the declared friction channel*). What the package adds is the one thing the
 * engine deliberately does not do: **route** what lands there. A loop whose
 * only channel to its owner is a directory nobody reads has a findings source
 * with no drain, and every consumer would otherwise write the same prompt
 * paragraph telling its plan tick to look in it
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
 *
 * **What counts as a note is the engine's rule, taken rather than restated.**
 * `frictionNotes` (`src/friction.ts`) is the channel's one listing — the same
 * call the count, the bare `friction` verb and the teardown harvest read — so
 * this listing and the `friction: N` line `flume status` prints cannot
 * disagree about what the channel holds (`.claude/rules/engineering.md`, *A
 * fact the engine holds is reported, never rediscovered*). This is the record
 * queue's rule's opposite number and deliberately not a copy of it: a record
 * is `*.md` because the package writes records, and a friction note is
 * whatever the engine and the consumer's loop wrote.
 *
 * **These answer host-native**, like `recordFiles` (`harness/records.ts`)
 * and for its reason: the caller hands the absolute state root and the declared
 * directory, and what comes back is read off disk and rendered for a tick to
 * open, never handed to git. The friction channel is gitignored by machinery,
 * so a note leaves this queue by `rm` rather than by a commit — nothing here
 * is ever a fence glob or a pathspec.
 */

import { join } from "node:path";

import { frictionNotes } from "../src/friction.js";

/**
 * Every note waiting in the declared friction channel under `stateRoot`,
 * as host-native paths sorted by name.
 *
 * An undeclared channel holds nothing: a consumer that declared no
 * `friction` has no directory to read, and the leg is off rather than
 * reading some default the package chose.
 *
 * A missing directory contributes nothing, exactly as an absent record queue
 * does — the engine creates the channel lazily, so "never written to" and
 * "empty" are one fact. Every **other** listing failure throws, and this
 * caller lets it: a caller here is about to read these bytes, and a channel
 * that silently lost a note is a finding that never reaches the slice
 * draining it (`.claude/rules/engineering.md`, *Loud or nothing*). Both
 * readings, and the win32 fold the channel's nesting needs, are
 * `frictionNotes`'s; all this adds is the directory the names sit under.
 *
 * The state root goes down with it, because that absence is proven from the
 * path rather than read off an errno — the descent `listUnderStateRoot`
 * (`harness/dirListing.ts`) runs for the record queue beside it, so an
 * obstructed state root refuses here instead of rendering an empty inbox
 * window on win32 (`.claude/rules/platform-facts.md`, *win32 reports a path
 * through a non-directory as not found*). This caller already holds the root
 * the descent starts from; nothing about it is re-derived here.
 *
 * One listing, two readers — {@link frictionPending} below asks whether it
 * is empty, and the inbox window renders these files' bytes. A second walk
 * beside it is a window that shows a note the predicate did not count
 * (`.claude/rules/engineering.md`, *Derived state is computed, never restated
 * beside its source*).
 */
export function frictionFiles(
  stateRoot: string,
  friction: string | undefined,
): string[] {
  if (friction === undefined) return [];
  const dir = join(stateRoot, friction);
  return frictionNotes(stateRoot, dir).map((name) => join(dir, name));
}

/**
 * Whether the declared friction channel holds anything to route — the inbox
 * slice's friction leg, true while {@link frictionFiles} names anything.
 *
 * Where that listing throws, the leg reports **live**, as the record leg's
 * predicate does: an unreadable channel is a reason to run the tick that
 * drains it, never a reason to skip one. The degradation is bounded — the
 * slice it wakes renders the same listing and fails loudly there rather than
 * proceeding over the unread bytes (`.claude/rules/engineering.md`, *Loud or
 * nothing*).
 */
export function frictionPending(
  stateRoot: string,
  friction: string | undefined,
): boolean {
  try {
    return frictionFiles(stateRoot, friction).length > 0;
  } catch {
    return true;
  }
}
