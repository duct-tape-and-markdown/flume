/**
 * Baton — the filesystem-flag mechanism that decides which phase wakes next.
 *
 * The baton is the *only* mutable harness state outside committed files.
 * Presence of `.flume/awake/<name>` wakes the corresponding phase on the
 * next tick. Absence hibernates. No daemon, no database, no in-memory state.
 *
 * Disk is truth, including the baton.
 */

import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { existsLoud } from "./fsProbe.js";
import { awakeDir, namespacedJoin } from "./paths.js";

/**
 * What a flag carries: the opaque mark {@link Baton.wake} wrote into it, read
 * back by {@link Baton.token} and handed to {@link Baton.sleepIfUnchanged} to
 * scope a sleep to the wake that caused it.
 *
 * Opaque by contract — nothing outside this module parses it, compares it for
 * order, or derives a time from it. The only operation is equality against a
 * token read earlier from the same flag.
 *
 * The empty string is a token like any other: a flag written before flags
 * carried tokens is empty on disk, and presence is what wakes a phase
 * (spec/loop.md, *Baton — presence wakes, absence hibernates*), so it must
 * read as a flag standing with an empty token rather than as no flag at all.
 * Absence is `undefined`, which is why this type does not spell it.
 */
export type BatonToken = string;

/**
 * Filesystem-flag mechanism for which phases wake next. Presence of
 * `<flumeDir>/awake/<name>` wakes the named phase on the next tick; absence
 * sleeps it. Idempotent — wake/sleep tolerate repeated calls and missing
 * flags so concurrent ticks and partial crashes don't corrupt state.
 *
 * A flag is a **queue of depth one**, not a level: each {@link wake} writes a
 * fresh {@link BatonToken}, and a tick that read a token at its start sleeps
 * through {@link sleepIfUnchanged}, which declines once a newer token stands.
 * So a wake landing while that tick runs survives the tick's own sleep and
 * the phase runs again, instead of being cleared by a writer that never saw
 * it (spec/loop.md, *Baton — presence wakes, absence hibernates*).
 *
 * Construct from the flume state dir (the `.flume` default lives one layer up,
 * in the Dispatcher/CLI, so a relocated `flumeDir` carries the baton with it).
 */
export class Baton {
  /** Absolute path of the awake-flag directory, e.g. `<flumeDir>/awake`. */
  readonly dir: string;

  /** @param flumeDir flume's mutable-state root (default `<repoRoot>/.flume`). */
  constructor(flumeDir: string) {
    this.dir = awakeDir(flumeDir);
    mkdirSync(namespacedJoin(this.dir), { recursive: true });
  }

  /** Phases currently awake, sorted by name for stable iteration. */
  awake(): string[] {
    return readdirSync(namespacedJoin(this.dir))
      .filter((name) => !name.startsWith("."))
      .sort();
  }

  /**
   * True iff the named phase has an awake flag. Absent is the only silent
   * reading; every other stat failure throws, the same disposition `awake()`
   * takes. Pinned by "Baton — an unstattable awake flag is loud"
   * (`tests/Baton.test.ts`).
   *
   * Presence alone, never the token: what a flag carries scopes a sleep, and
   * decides nothing about whether the phase is awake.
   */
  isAwake(name: string): boolean {
    return existsLoud(namespacedJoin(this.dir, name));
  }

  /**
   * The token the named phase's flag carries right now, or `undefined` when no
   * flag stands. Absent (`ENOENT`) is the only silent reading — every other
   * read failure throws, the disposition {@link isAwake} and {@link awake}
   * take.
   *
   * A tick reads this at its start and hands it back to
   * {@link sleepIfUnchanged} after its work.
   */
  token(name: string): BatonToken | undefined {
    try {
      return readFileSync(namespacedJoin(this.dir, name), "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      throw err;
    }
  }

  /**
   * Idempotent: stand the flag up carrying a fresh token, whether or not one
   * already stood. Repeated calls are one flag and one queued run — the depth
   * of the queue is one, and the newest token is what stands.
   */
  wake(name: string): void {
    writeFileSync(namespacedJoin(this.dir, name), randomUUID());
  }

  /**
   * Idempotent, unconditional: remove the flag if present, whatever it
   * carries. This is the human end of the baton (`flume sleep <phase>`,
   * `spec/cli.md`) — an operator putting a phase down means the phase, not one
   * wake of it. A tick sleeping the phase it just ran wants
   * {@link sleepIfUnchanged} instead.
   */
  sleep(name: string): void {
    try {
      rmSync(namespacedJoin(this.dir, name));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }

  /**
   * Token-scoped sleep: remove the flag only while it still carries `token` —
   * the value {@link token} answered for this name when the caller's work
   * began, or `undefined` if no flag stood then. Returns `false` exactly when
   * a different token stands and the flag was therefore kept; `true` when the
   * phase is asleep after this call, including the no-op where nothing stood.
   *
   * A wake landing between the caller's read and this call leaves a token the
   * caller never saw, so this declines and the queued run survives. That is
   * what makes the flag a queue of depth one rather than a level a concurrent
   * writer clears by accident.
   *
   * **Two windows this cannot close, declared rather than left looking like an
   * accident** (`.claude/rules/engineering.md`, *Loud or nothing*). Posix
   * offers no compare-and-unlink, so the read below and the removal that
   * follows it are two syscalls: a wake landing between them is lost, as it
   * was for the whole tick before. The window is microseconds against a tick's
   * minutes, and nothing in the loop depends on it being zero — a lost wake is
   * a phase that does not re-run, recoverable by waking it again, never state
   * on disk that disagrees with itself. The second window is {@link wake}'s
   * truncate-then-write: a read caught mid-write sees an empty flag, which
   * matches only a caller whose own start token was the empty one a
   * pre-token flag carries. Every other caller reads a mismatch and declines,
   * which is the safe direction.
   */
  sleepIfUnchanged(name: string, token: BatonToken | undefined): boolean {
    const standing = this.token(name);
    if (standing === undefined) return true;
    if (standing !== token) return false;
    this.sleep(name);
    return true;
  }

  /** True iff no flags exist. The dispatcher exits when this returns true. */
  hibernating(): boolean {
    return this.awake().length === 0;
  }
}
