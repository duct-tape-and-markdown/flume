/**
 * entryClaims — the per-entry claim: where one lives, how a tick stakes and
 * drops it, and which entries a tick reads as someone else's
 * (`spec/pending.md`, *Claims — an entry in flight is left alone*).
 *
 * A fanout tick stakes `<git-common-dir>/flume/claims/<checkout>/<slug>`
 * before it provisions the entry's worktree and drops it when the attempt
 * ends. The common dir resolves identically from every linked worktree, so a
 * claim taken in one is the claim every sibling tick of that checkout reads —
 * the same keying the tip claim and the two wait locks take (`spec/loop.md`,
 * *The loop lock and the tip claim*) — while the checkout segment past it
 * keeps a second checkout's unrelated queue out of this one's answer.
 *
 * The statement in the file and the stake that writes it are every guard's
 * (`renderPidClaim` / `stakePidClaim`, `src/pidClaim.ts`); what this module
 * adds is the address — one file per entry of one checkout, named by the
 * entry's slug — and
 * the walk that answers "which entries are in flight right now". A live
 * holder is left alone rather than refused by name, because selection has
 * already dropped a claimed entry and a tick that lost a race to stake one
 * simply does not carry it (`src/waveTick.ts`).
 *
 * Nothing about what a *producer* does with the set is here: the engine
 * reports which entries are claimed, and what to do about one a producer
 * would have rewritten is the chain's (`.claude/rules/engine-boundary.md`,
 * *Routing rule (plan, build, and interactive sessions)*).
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { isDirectoryOrAbsentUnder } from "./fsProbe.js";
import { checkoutAddress } from "./git.js";
import { namespacedJoin, slugify } from "./paths.js";
import {
  livePidClaimAt,
  stakePidClaim,
  type PidClaim,
  type PidClaimStake,
} from "./pidClaim.js";

/**
 * The entry-claim directory for one checkout under a git common dir:
 * `<commonDir>/flume/claims/<checkout>`. Beside the tip claims and the wait
 * locks (`tipClaimPath`, `src/git.ts`), which key on the repository because
 * the resource they guard is the repository's.
 *
 * A claim's resource is not: it is an entry in *this* checkout's queue, and
 * two checkouts of one repository hold two queues whose tags are unrelated.
 * So the checkout's own segment (`checkoutAddress`, `src/git.ts`) — the same
 * one its branches carry — stands between the claims directory and the slug,
 * and a sibling checkout's claim on a tag of the same spelling is neither
 * read by this checkout's walk nor hidden behind by its stake.
 */
export function entryClaimsDir(commonDir: string, checkout: string): string {
  return join(commonDir, "flume", "claims", checkout);
}

/**
 * The subject {@link EntryClaimStore.readHolders}'s descent names when it
 * refuses (`isDirectoryOrAbsentUnder`, `src/fsProbe.ts`) — one spelling, so
 * the rung an operator is told to go fix reads the same whichever ancestor
 * was obstructed.
 */
const CLAIM_STORE_SUBJECT = "entry-claim store";

/**
 * Where one entry's claim lives. `slug` is the entry's tag through the
 * engine's own filesystem-safe fold ({@link entryClaimSlug}) — the spelling
 * `spec/pending.md` names the file by, and the one a selection compares
 * against; `checkout` is the segment {@link entryClaimsDir} explains.
 */
export function entryClaimPath(
  commonDir: string,
  checkout: string,
  slug: string,
): string {
  return join(entryClaimsDir(commonDir, checkout), slug);
}

/**
 * The identity a claim keys on: the entry's tag, slugged
 * (`slugify`, `src/paths.ts`).
 *
 * The claim's own key, spelled once here rather than at the stake and again
 * at the selection that compares against it — a second fold would let a tick
 * hold one file while reading another (`.claude/rules/engineering.md`, *The
 * fix lands at the mechanism*). Not the declaration key the quarantine holds
 * by (`entryDeclaredKey`, `src/entryKey.ts`): a claim is on the entry, and
 * an entry re-scoped mid-flight is exactly what the claim exists to refuse,
 * so it must not hash to a different file.
 */
export function entryClaimSlug(tag: string): string {
  return slugify(tag);
}

/**
 * The claims of one checkout: the set a tick reads before it selects, and
 * the stake it takes on an entry it is about to carry.
 *
 * Addressed by repo root, because both halves of the address the claims live
 * under — the common dir and this checkout's segment — are git's answer about
 * that root ({@link checkoutAddress}, `src/git.ts`), resolved per call rather
 * than cached, so a store built once at construction still answers correctly
 * for a repository whose git directory moved under it.
 */
export class EntryClaimStore {
  constructor(private readonly repoRoot: string) {}

  /**
   * Every entry slug a live process holds a claim on, right now, each paired
   * with the holder that stated it.
   *
   * A claim whose file names a dead pid is absent from the map — that is the
   * reclaim `spec/loop.md`, *Crash equals stop* promises: the next selection
   * picks the entry up, and the stake below unlinks the stale file on its way
   * to taking it. An absent directory is the empty map (no tick has ever
   * staked one here); every other read failure travels out, because a claims
   * directory that cannot be read is not a repository with nothing in flight
   * (`.claude/rules/engineering.md`, *Loud or nothing*).
   *
   * That absence is proven from the **path**, never from the errno a listing
   * raised: a plain file above the claims directory is `ENOENT` on win32 and
   * `ENOTDIR` on posix (`.claude/rules/platform-facts.md`, *win32 reports a
   * path through a non-directory as not found*), so an errno-keyed silent arm
   * tells one host's selection that nothing is in flight and lets two ticks
   * carry one entry — and tells the pending gate's claim check to pass over
   * an entry a build tick holds. So the same descent
   * `PriorAttemptStore.readAll` and `readMergingMarkers` run
   * ({@link isDirectoryOrAbsentUnder}, `src/fsProbe.ts`), from the common dir
   * git just resolved down to the directory being listed; the listing past it
   * keeps no absent arm of its own, because every ancestor is proven by then.
   * The common dir is where the descent starts: git answered for it, and what
   * stands above it is git's.
   *
   * The holder rides along because one reader needs it: selection only asks
   * *whether* an entry is in flight ({@link readLive}), while the pending
   * gate's claim check refuses a ledger commit **naming** the holder
   * (`spec/pending.md`, *Claims — an entry in flight is left alone*). One
   * walk answers both rather than a liveness probe beside a second read of
   * the same files.
   */
  async readHolders(): Promise<ReadonlyMap<string, PidClaim>> {
    const { commonDir, segment } = await checkoutAddress(this.repoRoot);
    const dir = entryClaimsDir(commonDir, segment);
    const live = new Map<string, PidClaim>();
    if (!isDirectoryOrAbsentUnder(CLAIM_STORE_SUBJECT, commonDir, dir))
      return live;
    const names = await readdir(namespacedJoin(dir));
    for (const name of names) {
      const held = await livePidClaimAt(join(dir, name));
      if (held !== null) live.set(name, held);
    }
    return live;
  }

  /**
   * The slugs alone — {@link readHolders} for the reader that asks only
   * whether an entry is in flight. Derived from the one walk rather than a
   * second listing beside it (`.claude/rules/engineering.md`, *Derived state
   * is computed, never restated beside its source*).
   */
  async readLive(): Promise<ReadonlySet<string>> {
    return new Set((await this.readHolders()).keys());
  }

  /**
   * Stake `tag`'s claim, or report the live holder that already has it.
   *
   * The stake is the shared one ({@link stakePidClaim}), so a claim left by a
   * tick that died is reclaimed here by the same liveness probe
   * {@link readLive} filters on. A `held` answer is a race this tick lost
   * between its selection's read and this call — a fact for the caller, not a
   * refusal: the entry stays in the queue and its holder carries it.
   */
  async stake(tag: string): Promise<PidClaimStake> {
    const { commonDir, segment } = await checkoutAddress(this.repoRoot);
    return stakePidClaim(
      entryClaimPath(commonDir, segment, entryClaimSlug(tag)),
    );
  }
}
