/**
 * The one walk under a state root: what the record queue and the questions
 * directory are both read out of — a directory of same-extension files,
 * named at the host's own spelling, whose absence is the honest empty
 * answer.
 *
 * **One walk, because the two legs were one sequence.** The record queue
 * (`recordFiles`, `harness/records.ts`) and the questions render
 * (`renderQuestions`, `harness/questions.ts`) spelled the same steps — prove
 * the directory, list it, keep the files carrying the extension, sort — and
 * differed only in which directory and which extension. That is one function
 * with two callers (`.claude/rules/engineering.md`, *A module is one job*),
 * and it matters beyond the duplication: the absence arm is the half a copy
 * gets wrong quietly, so a second copy is a second chance to key it off an
 * errno.
 *
 * Where the two callers part is the seam between the halves.
 * `pathsUnderStateRoot` is the descent and the listing, and it is the half
 * the record queue reaches (through `checkoutRecords`, `harness/records.ts`),
 * because that queue applies the filter and the order itself over whichever
 * of its two trees it was handed. `filesCarrying` is that filter and that
 * order. `listUnderStateRoot` is the two composed, for the caller that reads
 * one directory off the disk and wants it filtered and sorted — the
 * questions render, which is the one it has.
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
 * **host-native paths** sorted by name — {@link pathsUnderStateRoot} read
 * through {@link filesCarrying}, and nothing else.
 *
 * The composed half, for a caller reading one directory off one tree: the
 * questions render (`renderQuestions`, `harness/questions.ts`), which asks
 * for the open questions already filtered and in name order. Every absence
 * and refusal rule this listing obeys is the descent's below; all this adds
 * is the filter and the sort.
 */
export function listUnderStateRoot(
  what: string,
  stateRoot: string,
  rel: string,
  ext: string,
): string[] {
  return filesCarrying(pathsUnderStateRoot(what, stateRoot, rel), ext);
}

/**
 * The walk itself: every name `stateRoot`'s `rel` directory holds,
 * **unfiltered and unordered**, each under the path
 * {@link fileUnderStateRoot} composes it at and all of them **host-native**.
 *
 * The half a caller takes when the filter and the order are its own to apply
 * across more than one tree. The record queue is that caller: it reads the
 * same directories off a checkout here and off a commit's tree
 * (`tipPathsUnder`, `harness/gitRange.ts`), and the extension filter, the
 * sort and the claim withholding are one derivation over whichever of them
 * it was handed (`recordFiles`, `harness/records.ts`).
 *
 * `stateRoot` is the absolute one and `rel` is a directory name in git's
 * alphabet, as `layout.ts` spells every name it holds. The fold into the
 * host's separator happens here, at the fs call that needs it: the path that
 * comes back is one a tick opens and a consumer joins its own paths against
 * (`spec/cli.md`, *win32 is a supported host*). A slash-joined absolute root
 * agrees with this on posix and names every file at `C:\repo\.flume/inbox/x.md`
 * on win32 — a spelling fs accepts and no `join`-built path equals.
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
 * rungs for every reader that runs this descent), so both hosts answer
 * alike. `what` is the noun phrase that refusal names — "record queue",
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
 * that renders these builds one prompt per tick. These are small
 * directories.
 */
export function pathsUnderStateRoot(
  what: string,
  stateRoot: string,
  rel: string,
): string[] {
  const dir = join(stateRoot, ...rel.split("/"));
  if (!isDirectoryOrAbsentUnder(what, stateRoot, dir)) return [];
  return readdirSync(namespacedJoin(dir)).map((name) =>
    fileUnderStateRoot(stateRoot, rel, name),
  );
}

/**
 * The `ext` files among `paths`, in name order — the one filter and the one
 * order every queue under a state root is read through.
 *
 * The extension is never taken for granted: a `.gitkeep` holding an
 * otherwise-empty directory in a clone is not a record and not an open
 * question, and must not read as one.
 *
 * Read off the whole path rather than off a name carried beside it: the
 * extension is that path's own tail either way, and a name held alongside is
 * a second value each walk would have to compose and keep in step
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*). The sort is by that path, which within one
 * directory is by name — every path in a call shares its prefix.
 */
export function filesCarrying(
  paths: readonly string[],
  ext: string,
): string[] {
  return paths.filter((path) => path.endsWith(ext)).sort();
}

/**
 * One named file under `stateRoot`'s `rel` directory, at the spelling
 * {@link pathsUnderStateRoot} hands a listed file back at.
 *
 * The composer, so a caller that means to ask "is *this* file in that
 * listing" composes the same string the listing produced rather than a
 * second one that agrees on posix and differs on win32 by a separator
 * (`.claude/rules/posture-sweep.md`, *A repo-relative path composed with
 * `node:path`*). The walk above goes through it too — one join, one answer.
 */
export function fileUnderStateRoot(
  stateRoot: string,
  rel: string,
  name: string,
): string {
  return join(stateRoot, ...rel.split("/"), name);
}
