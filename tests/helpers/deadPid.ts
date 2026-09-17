/**
 * The one home for a pid no live process holds — the stale holder every
 * pidfile and tip-claim case plants before asserting that the engine reclaims
 * it.
 *
 * Harvesting one from a child that just exited looks exact and is a race: a
 * reaped pid goes straight back into the host's allocation pool, so between
 * the harvest and the reclaim under test the number can name a stranger. The
 * reclaim then reads it live, refuses, and the case reds with nothing wrong in
 * the engine — measured on the `windows` lane, which recycles soonest.
 *
 * So the pid is minted rather than harvested: a number far above anything a
 * host hands out, checked at the mint against the same signal-0 probe the
 * engine's own liveness readers use (`liveLoopClaim`, `src/pidClaim.ts`;
 * `liveTipClaimPid`, `src/git.ts`). The check is the guarantee — the number
 * below is only a good first guess at one, and a host that disagrees gets a
 * refusal by name rather than a case that reds somewhere downstream
 * (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own;
 * `tests/deadPidHelper.test.ts` is its cover, and runs in the default lane.
 */

/**
 * The candidate. Above every pid a host in either lane allocates: Linux caps
 * `pid_max` at 2^22, and win32's ids, though wider, are handed out from a
 * reused low pool. Probed at every mint regardless, so the bound is a guess
 * the helper checks rather than one it trusts.
 */
const CANDIDATE_PID = 999_999_999;

/**
 * Whether `pid` names a process this host currently holds.
 *
 * Signal 0 delivers nothing and reports reachability. `ESRCH` is the only
 * "no such process" — an `EPERM` says the process is there and not ours to
 * signal, which is still live — and any other failure is the caller's to see.
 */
function namesLiveProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const { code } = err as NodeJS.ErrnoException;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw err;
  }
}

/**
 * A pid no live process holds, as of this call.
 *
 * Re-probed per call rather than cached: the value a case writes to a pidfile
 * is the one this helper just checked, so nothing widens the gap the harvest
 * idiom opened.
 */
export function deadPid(): number {
  if (namesLiveProcess(CANDIDATE_PID)) {
    throw new Error(
      `flume test harness: pid ${CANDIDATE_PID} names a live process on ` +
        `this host, so it cannot stand in for a dead holder — the stale-pid ` +
        `cases need a candidate above this host's pid range ` +
        `(tests/helpers/deadPid.ts)`,
    );
  }
  return CANDIDATE_PID;
}
