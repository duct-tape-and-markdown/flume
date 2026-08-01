/**
 * paths — the win32 total-path-limit fix idiom (~260 chars, v0.4 §6), shared.
 *
 * `join(...).length` can exceed MAX_PATH even where no single component
 * does (a worktree path nested under a friction dir, a job dir nested under
 * a state root). `toNamespacedPath` prepends the `\\?\` extended-length
 * prefix on win32 (no-op elsewhere), which lets fs calls survive that. Every
 * call site that builds a path for an fs call wants both steps together —
 * this is the one place that pairs them.
 */

import { join, toNamespacedPath } from "node:path";

/** `join(...paths)`, then `toNamespacedPath` — the win32 MAX_PATH fix idiom. */
export function namespacedJoin(...paths: string[]): string {
  return toNamespacedPath(join(...paths));
}
