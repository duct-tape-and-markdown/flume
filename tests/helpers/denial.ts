/**
 * Structural denial — the suite's refusal fixture for a loud-or-nothing case,
 * and not a permission bit.
 *
 * A POSIX mode is the obvious way to make a read fail, and it is the wrong
 * one twice over. On win32 it toggles the read-only attribute and denies no
 * read at all (`.claude/rules/platform-facts.md`, *chmod denies nothing on
 * win32*), so the lane runs the case, resolves every call the refusal was
 * supposed to reject, and reports green over a path it never exercised; under
 * a root-run it denies nothing on either host. Denying by **shape** instead —
 * a plain file where the code path reads a directory, a directory where it
 * reads or writes a file — fails the same call with the same non-ENOENT
 * disposition on every host and for every uid.
 *
 * **Which path to deny is the platform page's rule, not this helper's**
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*): deny the read path, never a parent — and its
 * one converse, that a reader proving absence by descending is exercised by
 * nothing *but* an obstructed ancestor, so a case pinning that reader denies
 * the parent on purpose and says so at the site (`tests/Dispatcher.test.ts`
 * seals the state root above the directory `readMergingMarkers` lists).
 * Denied at the read path, the stat stays truthful (the entry really is
 * there) and the failure lands on the read; sealed at a parent instead, an
 * existence gate above the denial takes its absent arm and the case reads
 * green over a read it never reached — `tests/denial.test.ts` holds that
 * shape as a case of its own.
 *
 * What a denied path raises is therefore the **split**, not an errno: every
 * consumer here is a gate that folds `ENOENT` into absence and must refuse on
 * anything else, so that is what the cover asserts and what a site should
 * assert. The errnos this host produces — `ENOTDIR` for the directory arm,
 * `EISDIR` for the file arm — are incidental to the property.
 *
 * Both calls replace whatever stands at the path, so a case that wants its
 * subject read once before it is sealed — the non-vacuity pin
 * (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*)
 * most of these carry — reads first and denies second, exactly as it did
 * with a mode. Neither call creates a missing parent: a mistyped path throws
 * here rather than arming a refusal over a location the code never visits.
 *
 * Nothing to undo afterwards. A mode had to be restored before `rm` could
 * take the tree down; a file and a directory are ordinary entries a
 * recursive remove already handles, so the `finally` that restored it goes
 * away with it.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own;
 * `tests/denial.test.ts` is its cover, and runs in the default lane.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";

/**
 * What a plain file left standing in a directory's place holds, for whoever
 * finds one in a fixture tree that outlived its test.
 */
export const DENIAL_NOTE = "structurally denied by tests/helpers/denial.ts\n";

/**
 * Deny `path` to a code path that expects a **directory** there: a plain file
 * takes its place, so a `readdir` of it refuses and a `mkdir` of it refuses,
 * neither as `ENOENT` — the reading a loud-or-nothing gate must not fold into
 * absence. (`ENOTDIR` and `EEXIST` on this host.)
 */
export function denyDirectory(path: string): void {
  rmSync(path, { recursive: true, force: true });
  writeFileSync(path, DENIAL_NOTE);
}

/**
 * Deny `path` to a code path that expects a **file** there: a directory takes
 * its place, so a write of it and a read of it both refuse, neither as
 * `ENOENT` (`EISDIR` on this host), while a stat still reports the entry
 * present — the split a gate that probes for existence before reading has to
 * survive.
 */
export function denyFile(path: string): void {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path);
}
