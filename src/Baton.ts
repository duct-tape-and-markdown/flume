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

/**
 * Filesystem-flag mechanism for which phases wake next. Presence of
 * `.flume/awake/<name>` wakes the named phase on the next tick; absence
 * sleeps it. Idempotent — wake/sleep tolerate repeated calls and missing
 * flags so concurrent ticks and partial crashes don't corrupt state.
 */
export class Baton {
  /** Absolute path of the awake-flag directory, e.g. `<repo>/.flume/awake`. */
  readonly dir: string;

  constructor(repoRoot: string) {
    this.dir = join(repoRoot, ".flume", "awake");
    mkdirSync(this.dir, { recursive: true });
  }

  /** Phases currently awake, sorted by name for stable iteration. */
  awake(): string[] {
    return readdirSync(this.dir)
      .filter((name) => !name.startsWith("."))
      .sort();
  }

  /** True iff the named phase has an awake flag. */
  isAwake(name: string): boolean {
    return existsSync(join(this.dir, name));
  }

  /** Idempotent: create the flag if missing. */
  wake(name: string): void {
    writeFileSync(join(this.dir, name), "", { flag: "a" });
  }

  /** Idempotent: remove the flag if present. */
  sleep(name: string): void {
    try {
      rmSync(join(this.dir, name));
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
