/**
 * pidClaim — the statement both of flume's process guards write, held in one
 * place so the two spell it once (`.claude/rules/engineering.md`, "The fix
 * lands at the mechanism").
 *
 * The loop lock (`<flumeDir>/loop.pid`) and the tip claim
 * (`<git-common-dir>/flume/tip-claims/<ref path>`) guard different resources
 * under different keying, and each records the same two facts about its
 * holder: the pid on the first line, the instant it took the guard on the
 * second (spec/loop.md, "The loop lock and the tip claim").
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
 * Nothing beyond the statement and that read here: what to do about a live
 * claim — refuse, wait, total a window — belongs to the guard that read it.
 */

import { readFile } from "node:fs/promises";

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
