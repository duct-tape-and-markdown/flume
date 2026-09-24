/**
 * entryClaims — the per-entry claim: where one lives, how a tick stakes and
 * drops it, and which entries a tick reads as someone else's
 * (`spec/pending.md`, *Claims — an entry in flight is left alone*).
 *
 * A fanout tick stakes `<git-common-dir>/flume/claims/<slug>` before it
 * provisions the entry's worktree and drops it when the attempt ends. The
 * common dir resolves identically from every linked worktree, so a claim
 * taken in one is the claim every sibling tick reads — the same keying the
 * tip claim and the two wait locks take (`spec/loop.md`, *The loop lock and
 * the tip claim*).
 *
 * The statement in the file and the stake that writes it are every guard's
 * (`renderPidClaim` / `stakePidClaim`, `src/pidClaim.ts`); what this module
 * adds is the address — one file per entry, named by the entry's slug — and
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

import { gitCommonDir } from "./git.js";
import { namespacedJoin, slugify } from "./paths.js";
import {
  livePidClaimAt,
  stakePidClaim,
  type PidClaimStake,
} from "./pidClaim.js";

/**
 * The entry-claim directory under a git common dir:
 * `<commonDir>/flume/claims`. One directory for the repository, beside the
 * tip claims and the wait locks (`tipClaimPath`, `src/git.ts`).
 */
export function entryClaimsDir(commonDir: string): string {
  return join(commonDir, "flume", "claims");
}

/**
 * Where one entry's claim lives. `slug` is the entry's tag through the
 * engine's own filesystem-safe fold ({@link entryClaimSlug}) — the spelling
 * `spec/pending.md` names the file by, and the one a selection compares
 * against.
 */
export function entryClaimPath(commonDir: string, slug: string): string {
  return join(entryClaimsDir(commonDir), slug);
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
 * The claims of one repository: the set a tick reads before it selects, and
 * the stake it takes on an entry it is about to carry.
 *
 * Addressed by repo root, because the common dir the claims live under is
 * git's answer about that root — resolved per call rather than cached, so a
 * store built once at construction still answers correctly for a repository
 * whose git directory moved under it.
 */
export class EntryClaimStore {
  constructor(private readonly repoRoot: string) {}

  /**
   * Every entry slug a live process holds a claim on, right now.
   *
   * A claim whose file names a dead pid is absent from the set — that is the
   * reclaim `spec/loop.md`, *Crash equals stop* promises: the next selection
   * picks the entry up, and the stake below unlinks the stale file on its way
   * to taking it. An absent directory is the empty set (no tick has ever
   * staked one here); every other read failure travels out, because a claims
   * directory that cannot be read is not a repository with nothing in flight
   * (`.claude/rules/engineering.md`, *Loud or nothing*).
   */
  async readLive(): Promise<ReadonlySet<string>> {
    const dir = entryClaimsDir(await gitCommonDir(this.repoRoot));
    let names: string[];
    try {
      names = await readdir(namespacedJoin(dir));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
      throw err;
    }
    const live = new Set<string>();
    for (const name of names) {
      if ((await livePidClaimAt(join(dir, name))) !== null) live.add(name);
    }
    return live;
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
    const commonDir = await gitCommonDir(this.repoRoot);
    return stakePidClaim(entryClaimPath(commonDir, entryClaimSlug(tag)));
  }
}
