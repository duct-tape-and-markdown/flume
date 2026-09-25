/**
 * The one listing under a state root: what the record queue and the
 * questions directory both are — a directory of same-extension files, named
 * at the host's own spelling, whose absence is the honest empty answer.
 *
 * **One walk, because the two legs were one sequence.** `recordFiles`
 * (`harness/records.ts`) and the questions render (`harness/questions.ts`)
 * spelled the same four steps — prove the directory, list it, keep the
 * records, sort, join — and differed only in which directory and which
 * extension. That is one function with two callers
 * (`.claude/rules/engineering.md`, *A module is one job*), and it matters
 * beyond the duplication: the absence arm below is the half a copy gets
 * wrong quietly, so a second copy is a second chance to key it off an errno.
 *
 * What a listed file *holds* — a record's byte cap, a question's prose —
 * belongs to its caller; where the directory sits belongs to `layout.ts`.
 * This module is the walk alone.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { isDirectoryOrAbsentUnder } from "../src/fsProbe.js";
import { namespacedJoin } from "../src/paths.js";

/**
 * Every file under `stateRoot`'s `rel` directory carrying `ext`, as
 * **host-native paths** sorted by name.
 *
 * `stateRoot` is the absolute one and `rel` is a directory name in git's
 * alphabet, as `layout.ts` spells every name it holds. The fold into the
 * host's separator happens here, at the fs call that needs it: the path that
 * comes back is one a tick opens and a consumer joins its own paths against
 * (`spec/cli.md`, *win32 is a supported host*). A slash-joined absolute root
 * agrees with this on posix and names every file at `C:\repo\.flume/inbox/x.md`
 * on win32 — a spelling fs accepts and no `join`-built path equals.
 *
 * `ext` is the filter, never taken for granted: a `.gitkeep` holding an
 * otherwise-empty directory in a clone is not a record and not an open
 * question, and must not read as one.
 *
 * **A missing directory contributes nothing** — a consumer that has never
 * written one should not have to create it to say so, and an empty queue and
 * an absent one are one fact. Every **other** failure throws: a directory
 * present and unreadable, a plain file where the directory belongs, a plain
 * file at any ancestor. A caller here is about to read these bytes, and a
 * queue that silently lost a file is a finding that never reaches the slice
 * draining it (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * That absence is proven from the **path**, never read off the errno the
 * listing raised. A plain file above the directory makes the directory
 * beneath it `ENOENT` on win32 while posix raises `ENOTDIR`
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*), so an errno-keyed silent arm answers
 * "nothing open" and "no records waiting" over an obstructed state root on
 * exactly one host — which would tell a plan tick that a question it cannot
 * see is closed. Hence the descent that `PriorAttemptStore.readAll` and
 * `readMergingMarkers` run: the state root, then each segment of `rel`,
 * every one asserted a directory before the next is probed
 * ({@link isDirectoryOrAbsentUnder}, `src/fsProbe.ts`, which composes those
 * rungs for every reader that runs this descent), so both hosts answer alike. `what` is the noun phrase that refusal names — "record queue",
 * "questions dir". The state root is where the descent starts: the caller
 * supplied it, and what stands above it is the caller's to answer for.
 *
 * Every ancestor is proven by then, so the listing keeps no absent arm of
 * its own — a failure there is real. It still goes through
 * `namespacedJoin`, since these directories sit under a chain-declared state
 * root (`.claude/rules/platform-facts.md`, *Windows MAX_PATH (~260 chars)
 * breaks fs calls with no long component*); the names handed back stay
 * plain, because they are what a prompt renders and a human opens.
 *
 * Synchronous by its callers' contract: a slice's liveness predicate is pure
 * over its inputs and runs on the selection path, and the prompt composition
 * that renders these builds one prompt per tick. These are small directories.
 */
export function listUnderStateRoot(
  what: string,
  stateRoot: string,
  rel: string,
  ext: string,
): string[] {
  const dir = join(stateRoot, ...rel.split("/"));
  if (!isDirectoryOrAbsentUnder(what, stateRoot, dir)) return [];
  return readdirSync(namespacedJoin(dir))
    .filter((name) => name.endsWith(ext))
    .sort()
    .map((name) => fileUnderStateRoot(stateRoot, rel, name));
}

/**
 * One named file under `stateRoot`'s `rel` directory, at the spelling
 * {@link listUnderStateRoot} hands a listed file back at.
 *
 * The composer, so a caller that means to ask "is *this* file in that
 * listing" composes the same string the listing produced rather than a
 * second one that agrees on posix and differs on win32 by a separator
 * (`.claude/rules/posture-sweep.md`, *A repo-relative path composed with
 * `node:path`*). The listing above goes through it too — one join, one
 * answer.
 */
export function fileUnderStateRoot(
  stateRoot: string,
  rel: string,
  name: string,
): string {
  return join(stateRoot, ...rel.split("/"), name);
}
