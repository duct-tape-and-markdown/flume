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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { existsLoud, isDirectoryOrAbsentUnder } from "./fsProbe.js";
import { awakeDir, namespacedJoin } from "./paths.js";
import {
  mkdirUnderStateRoot,
  readUnderStateRoot,
  removeUnderStateRoot,
  writeFileUnderStateRoot,
} from "./stateRootAccess.js";

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
 * What a refusal names when the directory is the subject, and when one flag
 * in it is — spelled once, because the operator reads them beside each other
 * and the two writes {@link Baton.wake} makes are one sentence apart.
 */
const AWAKE_DIR_SUBJECT = "awake-flag directory";
const AWAKE_FLAG_SUBJECT = "awake flag";

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
  /**
   * flume's mutable-state root — the root every write this class makes lands
   * under, and so the root a failed one names. Held rather than recovered from
   * {@link dir}, which is the derivation and not the source.
   */
  private readonly stateRoot: string;

  /**
   * Absolute path of the awake-flag directory, e.g. `<flumeDir>/awake`.
   *
   * Computed from {@link stateRoot} on each read rather than stored beside it:
   * one truth, one home (`.claude/rules/engineering.md`, *Derived state is
   * computed, never restated beside its source*).
   */
  get dir(): string {
    return awakeDir(this.stateRoot);
  }

  /**
   * Holds the root and touches nothing: constructing the baton is not
   * reading it, and reading it creates nothing (`spec/loop.md`, *Baton —
   * presence wakes, absence hibernates*). {@link wake} makes the directory
   * when the first flag needs one.
   *
   * @param flumeDir flume's mutable-state root (default `<repoRoot>/.flume`).
   */
  constructor(flumeDir: string) {
    this.stateRoot = flumeDir;
  }

  /**
   * Whether the awake-flag directory stands: `true` when a directory is
   * there, `false` when it — or a directory between the state root and it —
   * is absent, and a throw for everything else.
   *
   * `false` is the **empty baton**, and it has to be a proven absence rather
   * than an errno: a plain file at `<flumeDir>/awake` answers a single stat
   * beneath it `ENOENT` on win32 (`.claude/rules/platform-facts.md`, *win32
   * reports a path through a non-directory as not found*), so a reader keyed
   * off that errno would hibernate over an obstructed baton on one host and
   * refuse on the other. The descent answers alike on both.
   */
  private dirStands(): boolean {
    return isDirectoryOrAbsentUnder(
      AWAKE_DIR_SUBJECT,
      this.stateRoot,
      this.dir,
    );
  }

  /**
   * Phases currently awake, sorted by name for stable iteration. An absent
   * directory is the empty baton — nothing has woken yet, and reading that
   * creates nothing. A directory that is present and will not read refuses
   * as `StateRootAccessError` (`src/stateRootAccess.ts`), the same sentence and the same
   * `EX_IOERR` an unwritable flag refuses with.
   */
  awake(): string[] {
    return readUnderStateRoot(this.stateRoot, AWAKE_DIR_SUBJECT, () => {
      if (!this.dirStands()) return [];
      return readdirSync(namespacedJoin(this.dir))
        .filter((name) => !name.startsWith("."))
        .sort();
    });
  }

  /**
   * True iff the named phase has an awake flag. Absent is the only silent
   * reading — the flag's, and the directory's, each proven by
   * {@link dirStands} rather than read off an errno; every other stat failure
   * refuses, the same disposition {@link awake} takes. Pinned by "Baton — an
   * unstattable awake flag is loud" (`tests/Baton.test.ts`).
   *
   * Presence alone, never the token: what a flag carries scopes a sleep, and
   * decides nothing about whether the phase is awake.
   */
  isAwake(name: string): boolean {
    return readUnderStateRoot(this.stateRoot, AWAKE_FLAG_SUBJECT, () => {
      if (!this.dirStands()) return false;
      return existsLoud(namespacedJoin(this.dir, name));
    });
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
    return readUnderStateRoot(this.stateRoot, AWAKE_FLAG_SUBJECT, () => {
      if (!this.dirStands()) return undefined;
      try {
        return readFileSync(namespacedJoin(this.dir, name), "utf8");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return undefined;
        throw err;
      }
    });
  }

  /**
   * Idempotent: stand the flag up carrying a fresh token, whether or not one
   * already stood. Repeated calls are one flag and one queued run — the depth
   * of the queue is one, and the newest token is what stands.
   *
   * **The directory is made here**, by the first wake and by no read: a root
   * nothing can be made under is found by this `mkdir`, where a plain file
   * standing at `<flumeDir>/awake` stats clean above and fails with `EEXIST`
   * on every host and for every uid. The flag write past it fails for the
   * kindred reasons — a directory standing at `<flumeDir>/awake/<name>`
   * passes the `mkdir` and fails here — and both are the one refusal naming
   * the root, because a phase silently not woken is a tick that never runs
   * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
   */
  wake(name: string): void {
    mkdirUnderStateRoot(this.stateRoot, AWAKE_DIR_SUBJECT, this.dir);
    writeFileUnderStateRoot(
      this.stateRoot,
      AWAKE_FLAG_SUBJECT,
      join(this.dir, name),
      randomUUID(),
    );
  }

  /**
   * Idempotent, unconditional: remove the flag if present, whatever it
   * carries. This is the human end of the baton (`flume sleep <phase>`,
   * `spec/cli.md`) — an operator putting a phase down means the phase, not one
   * wake of it. A tick sleeping the phase it just ran wants
   * {@link sleepIfUnchanged} instead.
   *
   * A removal is a write of the directory holding the flag, so a flag that is
   * there and will not go refuses in the write's own direction
   * (`removeUnderStateRoot`, `src/stateRootAccess.ts`) — a phase left awake by
   * a `sleep` that reported success is the loop running it again forever.
   */
  sleep(name: string): void {
    removeUnderStateRoot(
      this.stateRoot,
      AWAKE_FLAG_SUBJECT,
      join(this.dir, name),
    );
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
