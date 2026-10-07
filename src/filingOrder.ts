/**
 * Filing order — when each entry in a queue was filed, read off git, and the
 * order a selection takes over those times when the chain declares none
 * (`spec/pending.md`, *The entry core*).
 *
 * One home, because the fact has more than one reader: every selection a tick
 * takes orders by it, and it is a fact the engine holds about the queue rather
 * than one each consumer re-derives (`.claude/rules/engineering.md`, *A fact
 * the engine holds is reported, never rediscovered*).
 *
 * Filing is an **add under the entry's own filename** and nothing else: an
 * entry's file is named by its tag (`entryFileName`, `src/PendingSchema.ts`),
 * so the oldest commit that added that name is the moment the queue first
 * carried the tag. A later rewrite of the same file — a producer amending an
 * entry, the dispatcher recording a footprint — is no add, and neither is a
 * re-file after the tag once left the queue: both leave the first add
 * standing, which is what keeps an entry from moving under the work being
 * done to it.
 */

import { addedPathTimes } from "./git.js";
import { entryTagFromFileName, type PendingEntry } from "./PendingSchema.js";

/**
 * Each tag this history has filed → the unix second it was filed at. Keyed by
 * tag rather than by filename, because that is what a queue's entries carry
 * and what every consumer looks one up by.
 *
 * The map a chain's own sequencing policy is handed, too
 * (`OrderContext.filedAt`, `src/Phase.ts`): the comparator below is one
 * policy over these times, and a chain declaring another reads the same
 * engine-held read rather than shelling out to git for a second one
 * (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
 * never rediscovered*). A tag absent from it is one no commit has filed, and
 * {@link byFilingThenTag} is where that absence has its consequence.
 *
 * Every tag the ledger directory has *ever* held, not only the queue's own: a
 * tag that shipped and was filed again is the same filing, and narrowing the
 * map to the entries standing right now would make that fact unreadable.
 */
export type FilingTimes = ReadonlyMap<string, number>;

/**
 * Where an entry no commit has filed sorts: after every entry one has
 * ({@link byFilingThenTag}).
 *
 * An entry on disk that no commit holds is one a producer has only just
 * written — and a selection is taken against the committed tip
 * (`spec/pending.md`, *Dispatch reads come from the tip, not the tree*), so
 * the entry a dispatch read can see but a filing read cannot is the newest
 * thing in the queue either way.
 */
const NEVER_FILED = Number.POSITIVE_INFINITY;

/**
 * The filing times of the entry files under `dirRel` at `ref`.
 *
 * `dirRel` is repo-relative in git's own alphabet, and `undefined` is a ledger
 * relocated outside the repo root — invisible to git by construction
 * (`isPendingRelocated`, `src/pendingLedger.ts`), so it has no filing times at
 * all and every entry under it ties. That is the declared degrade this read
 * carries: the order such a queue takes is the tag alone, which is the whole
 * of {@link byFilingThenTag}'s tiebreak rather than a substituted value
 * standing in for a time nobody could read (`.claude/rules/engineering.md`,
 * *Loud or nothing*).
 *
 * Names that are no entry file's are dropped — a chain may keep sidecars
 * beside the entries and the listing that decides what is work already
 * ignores them (`readQueueOnDisk`, `src/pendingLedger.ts`).
 */
export async function readFilingTimes(
  repoRoot: string,
  ref: string,
  dirRel: string | undefined,
): Promise<FilingTimes> {
  if (dirRel === undefined) return new Map();
  const byPath = await addedPathTimes(repoRoot, ref, dirRel);
  const byTag = new Map<string, number>();
  for (const [path, seconds] of byPath) {
    // git names the path from the repo root; the entry's own name is its last
    // segment, and the tag is that name's (`entryTagFromFileName`,
    // `src/PendingSchema.ts`).
    const name = path.slice(path.lastIndexOf("/") + 1);
    const tag = entryTagFromFileName(name);
    if (tag !== null) byTag.set(tag, seconds);
  }
  return byTag;
}

/**
 * The order a selection serves a queue in where the chain declared none:
 * oldest filing first, then tag ascending (`spec/pending.md`, *The entry
 * core*).
 *
 * Tags compare by code unit rather than `localeCompare`, so the ordering is
 * the same on every host: `TAG_PATTERN` (`src/PendingSchema.ts`) admits ASCII
 * alone, where code-unit order *is* ascending, and a locale-sensitive collator
 * would make the queue's order a property of the machine reading it.
 *
 * A comparator over times the caller already read, rather than a read of its
 * own: a selection is synchronous — a freed fanout slot takes one inside its
 * own continuation (`nextDisjointPick`, `src/selection.ts`) — and the times a
 * selection orders by are the ones read beside the queue it is taken over.
 */
export function byFilingThenTag(
  times: FilingTimes,
): (a: PendingEntry, b: PendingEntry) => number {
  return (a, b) => {
    const at = times.get(a.tag) ?? NEVER_FILED;
    const bt = times.get(b.tag) ?? NEVER_FILED;
    if (at !== bt) return at < bt ? -1 : 1;
    return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;
  };
}
