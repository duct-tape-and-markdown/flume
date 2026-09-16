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
 * Nothing beyond the parse here: what to do about a claim — refuse, reclaim,
 * total a window — belongs to the guard that read it.
 */

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
