/**
 * Baton — the filesystem-flag mechanism that decides which phase wakes next.
 *
 * The baton is the *only* mutable harness state outside committed files.
 * Presence of `.flume/awake/<name>` wakes the corresponding phase on the
 * next tick. Absence hibernates. No daemon, no database, no in-memory state.
 *
 * Disk is truth, including the baton.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { namespacedJoin } from "./paths.js";

/**
 * Filesystem-flag mechanism for which phases wake next. Presence of
 * `<flumeDir>/awake/<name>` wakes the named phase on the next tick; absence
 * sleeps it. Idempotent — wake/sleep tolerate repeated calls and missing
 * flags so concurrent ticks and partial crashes don't corrupt state.
 *
 * Construct from the flume state dir (the `.flume` default lives one layer up,
 * in the Dispatcher/CLI, so a relocated `flumeDir` carries the baton with it).
 */
export class Baton {
  /** Absolute path of the awake-flag directory, e.g. `<flumeDir>/awake`. */
  readonly dir: string;

  /** @param flumeDir flume's mutable-state root (default `<repoRoot>/.flume`). */
  constructor(flumeDir: string) {
    this.dir = join(flumeDir, "awake");
    mkdirSync(namespacedJoin(this.dir), { recursive: true });
  }

  /** Phases currently awake, sorted by name for stable iteration. */
  awake(): string[] {
    return readdirSync(namespacedJoin(this.dir))
      .filter((name) => !name.startsWith("."))
      .sort();
  }

  /** True iff the named phase has an awake flag. */
  isAwake(name: string): boolean {
    return existsSync(namespacedJoin(this.dir, name));
  }

  /** Idempotent: create the flag if missing. */
  wake(name: string): void {
    writeFileSync(namespacedJoin(this.dir, name), "", { flag: "a" });
  }

  /** Idempotent: remove the flag if present. */
  sleep(name: string): void {
    try {
      rmSync(namespacedJoin(this.dir, name));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }

  /** True iff no flags exist. The dispatcher exits when this returns true. */
  hibernating(): boolean {
    return this.awake().length === 0;
  }
}
