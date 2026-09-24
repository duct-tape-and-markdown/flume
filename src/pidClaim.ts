/**
 * pidClaim — the statement every one of flume's process guards writes, held
 * in one place so they spell it once (`.claude/rules/engineering.md`, "The
 * fix lands at the mechanism").
 *
 * The loop lock (`<flumeDir>/loop.pid`), the tip claim
 * (`<git-common-dir>/flume/tip-claims/<ref path>`) and the per-entry claim
 * (`<git-common-dir>/flume/claims/<slug>`) guard different resources under
 * different keying, and each records the same two facts about its holder:
 * the pid on the first line, the instant it took the guard on the second
 * (spec/loop.md, "The loop lock and the tip claim").
 *
 * **The pid stays first because liveness is what every reader needs and the
 * instant is what one reader needs.** A reader after liveness takes line one,
 * where every reader has always looked; `flume status` bounds the live run's
 * spend by line two rather than by the lock file's mtime, which no writer
 * contracts and which an archive restore, a `touch`, or a backup tool moves
 * under a running loop.
 *
 * The read that turns a guard file into a live claim sits here too
 * ({@link livePidClaimAt}), because every guard flume has takes it and a
 * fourth spelling of "parse it, then signal-0 its pid" is how two of them
 * come to disagree about what a truncated file means
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*). Each
 * guard keeps only the path it addresses its own file by: the loop lock's
 * accessor read is {@link liveLoopClaim} below, the tip claim's ref-keyed
 * one is `liveTipClaimPid` (`src/git.ts`), and the two git-common-dir wait
 * locks hand `acquireWaitLock` (`src/waitLock.ts`) theirs.
 *
 * The refuse-and-reclaim *stake* the two exclusive guards take sits here too
 * ({@link stakePidClaim}), for the reason the read does: one `wx` create, one
 * `EEXIST` probe, one dead-holder reclaim and one drop, so the tip claim and
 * the entry claim cannot come to disagree about what a stale file is or about
 * whose file a release removes. The wait locks keep their own loop, which
 * parts from it at exactly one decision (`acquireWaitLock`,
 * `src/waitLock.ts`).
 *
 * Nothing beyond the statement, that read and that stake here: what to do
 * about a live claim — refuse, wait, leave the entry to its holder — belongs
 * to the guard that read it.
 */

import { unlinkSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { loopLockPath, namespacedJoin } from "./paths.js";

/** A guard file's holder, as the holder itself stated it. */
export interface PidClaim {
  /** The pid on the first line. Positive and finite, or there is no claim. */
  readonly pid: number;
  /**
   * When the holder took the guard, from the second line, in epoch
   * milliseconds. Absent when the file states no parsable instant — a claim
   * written by a flume before 0.17, or one a hand rolled. A reader that needs
   * the instant refuses or withholds rather than substituting one
   * (`.claude/rules/engineering.md`, "Loud or nothing"); a reader that needs
   * only the pid is unaffected.
   */
  readonly atMs?: number;
}

/**
 * The statement a guard writes when it takes the guard: `pid`, a newline, the
 * ISO-8601 instant, a trailing newline. `at` is passed rather than read from
 * the clock here, so the caller that takes the guard is the one that says
 * when.
 */
export function renderPidClaim(pid: number, at: Date): string {
  return `${pid}\n${at.toISOString()}\n`;
}

/**
 * Decode a guard file's contents. `null` when the first line names no usable
 * pid — an empty file, a truncated write, a hand-edited one — which every
 * caller reads as "no live holder" and reclaims over, the same reading a
 * dead pid gets.
 *
 * The second line is decoded independently: a claim whose instant is missing
 * or unparsable still names its holder, because refusing the pid there would
 * turn a cosmetic difference into a reclaim over a live supervisor.
 */
export function parsePidClaim(raw: string): PidClaim | null {
  const [pidLine = "", atLine = ""] = raw.split("\n");
  const pid = Number(pidLine.trim());
  if (!Number.isFinite(pid) || pid <= 0) return null;
  const atMs = Date.parse(atLine.trim());
  return Number.isFinite(atMs) ? { pid, atMs } : { pid };
}

/**
 * What the guard file at `path` states about its holder, when that holder is
 * a live process — `null` for no file, an unparsable one, or a dead/not-ours
 * pid (stale; callers reclaim over it).
 *
 * The statement is {@link parsePidClaim}'s: the pid off the first line, the
 * claim instant off the second where the holder stated one. The whole claim,
 * not the pid alone, because `flume status` reports the loop lock's holder
 * *and* bounds the run's spend by its instant — one read answers both rather
 * than a liveness probe beside a second read of the same file. A caller that
 * needs only liveness drops the instant on the floor.
 *
 * Absent (`ENOENT`) is the only no-holder reading; any other read failure
 * (permission denied, a symlink loop, a path too long for the platform, …)
 * throws (`.claude/rules/engineering.md`, *Loud or nothing*). A `null` from
 * an unreadable guard file would report a live holder as dead, which is
 * exactly the reading every caller's reclaim branch must not take.
 */
export async function livePidClaimAt(path: string): Promise<PidClaim | null> {
  // win32 MAX_PATH: a guard file can sit under a state root or a git common
  // dir that nests deep; namespacedJoin (src/paths.ts) is the shared idiom.
  let raw: string;
  try {
    raw = await readFile(namespacedJoin(path), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const claim = parsePidClaim(raw);
  if (claim === null) return null;
  try {
    process.kill(claim.pid, 0);
    return claim;
  } catch {
    return null;
  }
}

/**
 * {@link livePidClaimAt} at the one path the runtime addresses by accessor
 * rather than by a caller-held one: `<dir>/loop.pid` (`loopLockPath`,
 * `src/paths.ts`). Everything the read means is that function's doc.
 */
export async function liveLoopClaim(dir: string): Promise<PidClaim | null> {
  return livePidClaimAt(loopLockPath(dir));
}

/**
 * The live holder's pid alone — {@link liveLoopClaim} for a caller that needs
 * only liveness. Exported for reuse (`flume loop`'s lock claim) rather than a
 * second implementation of the same pid-liveness check.
 */
export async function liveLoopPid(dir: string): Promise<number | null> {
  return (await liveLoopClaim(dir))?.pid ?? null;
}

/** A guard file this process created, and the one way to give it up. */
export interface StakedPidClaim {
  /** The file on disk this holder created. */
  readonly path: string;
  /**
   * Remove the claim file **this stake created**, and only that one. Drops at
   * most once: a second call unlinks nothing, so a holder released twice — an
   * exit handler after a `finally`, a rollback after a signal — cannot delete
   * the claim a later holder has since staked at the same path. Synchronous,
   * so an exit handler can call it.
   */
  release: () => void;
}

/**
 * What {@link stakePidClaim} found at the path: the guard, or the live holder
 * that already had it.
 *
 * A union rather than a throw, because the two guards built on it answer a
 * live holder differently — the tip claim refuses by name
 * (`TipClaimHeldError`, `src/git.ts`), the entry claim leaves the entry to
 * its holder (`EntryClaimStore`, `src/entryClaims.ts`) — and neither reading
 * is this module's (see the module doc above).
 */
export type PidClaimStake =
  | { readonly kind: "staked"; readonly claim: StakedPidClaim }
  | { readonly kind: "held"; readonly by: PidClaim };

/**
 * Take the guard file at `path`: exclusive-create (`wx`) it carrying this
 * process's statement ({@link renderPidClaim}), reclaiming over a holder that
 * is no longer alive.
 *
 * Exclusive-create is the whole arbitration: the loser of a race gets
 * `EEXIST` and reads the winner's statement rather than deciding anything
 * from timing. On `EEXIST` the recorded holder is probed with
 * {@link livePidClaimAt}:
 *
 * - **live** — `held`, naming the holder. What that means is the caller's.
 * - **dead, or a statement naming no usable pid** — reclaim: unlink and retry
 *   the create. A concurrent reclaimer may win the unlink race, so the
 *   retry's own `EEXIST` re-probes rather than assuming this call won.
 *
 * Loud or nothing (`.claude/rules/engineering.md`, *Loud or nothing*): only
 * `ENOENT` on the reclaim unlink — another reclaimer won the race — is
 * swallowed, so an `EACCES` throws here instead of spinning this loop
 * forever, and a claim file that is present but unreadable throws out of the
 * probe rather than reading as an unclaimed guard.
 *
 * The wait-and-reclaim guards do not build on this: their `EEXIST` leg sleeps
 * and re-probes rather than answering, which is a different loop over the
 * same two primitives (`acquireWaitLock`, `src/waitLock.ts`).
 */
export async function stakePidClaim(path: string): Promise<PidClaimStake> {
  const target = namespacedJoin(path);
  await mkdir(namespacedJoin(dirname(path)), { recursive: true });
  for (;;) {
    try {
      await writeFile(target, renderPidClaim(process.pid, new Date()), {
        flag: "wx",
      });
      // The release drops at most once, at the stake that took the file. A
      // guard file is a shared address, not this process's private one: the
      // holder that gives it up may be released again — an exit handler after
      // a `finally`, a rollback after a signal — and by then a later holder
      // may have staked the same path. An unlink on that second call deletes a
      // claim this process does not hold. The guard rides the stake rather
      // than each caller's own `held` flag beside it
      // (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
      let released = false;
      return {
        kind: "staked",
        claim: {
          path,
          release: () => {
            if (released) return;
            released = true;
            try {
              unlinkSync(target);
            } catch {
              // already gone
            }
          },
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = await livePidClaimAt(path);
      if (holder !== null) return { kind: "held", by: holder };
      try {
        await unlink(target);
      } catch (unlinkErr) {
        if ((unlinkErr as NodeJS.ErrnoException).code !== "ENOENT") {
          throw unlinkErr;
        }
      }
    }
  }
}
