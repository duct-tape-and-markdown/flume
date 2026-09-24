/**
 * waitLock — the wait-and-reclaim guard: the second of flume's two ways to
 * take a lock file, beside the tip claim's refuse-and-reclaim
 * (`acquireTipClaim`, `src/git.ts`).
 *
 * The two differ in exactly one decision and share everything else. Both
 * exclusive-create a file carrying the holder's pid and instant
 * (`renderPidClaim`, `src/pidClaim.ts`), both reclaim a file whose recorded
 * pid names no live process, and both give the file up through the one drop
 * that removes only what the holder calling it created (`atMostOnceDrop`,
 * `src/pidClaim.ts`). What a live holder means is where they
 * part: the tip claim says "another engine run owns this tip" and refuses,
 * while the guards here say "a sibling tick of *this* run is at git right
 * now" and wait for its turn to end (spec/loop.md, *The ship lock and the
 * worktree lock — sibling ticks take turns at git*).
 *
 * Nothing here knows which resource it is guarding: the caller names the
 * file and the phrase the wait announces itself with. Composing the two
 * git-common-dir guards on top — `acquireShipLock` and the worktree lock —
 * is `src/git.ts`'s, which is where the common dir is resolved.
 */

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { Logger } from "./log.js";
import { namespacedJoin } from "./paths.js";
import {
  atMostOnceDrop,
  livePidClaimAt,
  renderPidClaim,
} from "./pidClaim.js";

/**
 * How long an acquirer sleeps between two liveness probes of a live holder.
 *
 * Engine-internal and deliberately not a chain knob: no verb takes or drops
 * either lock and `flume status` prints nothing about them (spec/loop.md,
 * *The ship lock and the worktree lock — sibling ticks take turns at git*),
 * so a chain has nothing to key a policy off. The value trades a wait's
 * tail latency against the probe's cost, and at one merge span per tick the
 * lock is uncontended anyway.
 */
const DEFAULT_POLL_MS = 250;

/** A held wait-lock, and the one way to give it up. */
export interface WaitLock {
  /** The file on disk this holder created. */
  readonly path: string;
  /**
   * Remove the lock file **this acquire created**, and only that one. The tip
   * claim's release and this one are the same drop, not the same shape twice
   * (`atMostOnceDrop`, `src/pidClaim.ts`): a second call unlinks nothing, so
   * a lock released twice cannot take a waiting sibling's turn from under it.
   * Synchronous, so an exit handler can call it.
   */
  release: () => void;
}

/**
 * Take `path` as a wait-and-reclaim lock, returning once this process holds
 * it.
 *
 * Exclusive-create (`wx`) is the whole arbitration: the loser of a race gets
 * `EEXIST` and reads the winner's statement rather than deciding anything
 * from timing. On `EEXIST` the recorded holder is probed with the same
 * signal-0 liveness check every other guard in the engine uses
 * (`livePidClaimAt`, `src/pidClaim.ts`):
 *
 * - **live** — wait. Sleep `pollMs` and try again, re-probing each round so
 *   a holder that dies mid-wait is reclaimed by the next pass rather than
 *   waited on forever.
 * - **dead, or a statement naming no usable pid** — reclaim: unlink and
 *   retry the create. A concurrent reclaimer may win the unlink race, so the
 *   retry's own `EEXIST` re-probes rather than assuming this call won.
 *
 * The wait is unbounded by design. A holder is a sibling tick of this same
 * run, bounded by that tick's own timeout, and its death is what the
 * liveness probe reads — so there is no deadline here that would not be
 * either a duplicate of the tick timeout or a reclaim over a live writer.
 *
 * The wait is announced once per holder rather than once per poll: a spin of
 * identical lines is how a log stops being read. A holder that changes
 * because the first one finished and a third tick got in ahead of this one
 * announces again, because that is a different fact.
 */
export async function acquireWaitLock(opts: {
  /** The lock file to create. Its parent is created if absent. */
  path: string;
  /** What the wait line calls this lock, e.g. `the ship lock`. */
  label: string;
  /** Where the wait announces itself. */
  log: Logger;
  /** Override for {@link DEFAULT_POLL_MS} — the suites' short poll. */
  pollMs?: number;
}): Promise<WaitLock> {
  const { path, label, log } = opts;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const target = namespacedJoin(path);
  await mkdir(namespacedJoin(dirname(path)), { recursive: true });
  let announced: number | undefined;
  for (;;) {
    try {
      await writeFile(target, renderPidClaim(process.pid, new Date()), {
        flag: "wx",
      });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = await livePidClaimAt(path);
      if (holder !== null) {
        if (announced !== holder.pid) {
          announced = holder.pid;
          log.info(
            `[flume] waiting for ${label} held by pid ${holder.pid} (${path})`,
          );
        }
        await sleep(pollMs);
        continue;
      }
      // Reclaim. Loud or nothing (`.claude/rules/engineering.md`): only
      // ENOENT — another reclaimer won the race — is swallowed, so an
      // EACCES becomes an error here instead of spinning this loop forever.
      try {
        await unlink(target);
      } catch (unlinkErr) {
        if ((unlinkErr as NodeJS.ErrnoException).code !== "ENOENT") {
          throw unlinkErr;
        }
      }
    }
  }
  return { path, release: atMostOnceDrop(target) };
}
