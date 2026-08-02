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

/**
 * Minimal glob matcher supporting `*`, `**`, and literal paths. We avoid a
 * dependency here so the harness has zero runtime deps beyond zod. Shared
 * home for every consumer that judges a real commit path against a declared
 * (possibly glob) path list — the write guard and ship detection both need
 * this, and a caller-local copy is how the two drift apart.
 */
export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegex(g).test(path));
}

function globToRegex(glob: string): RegExp {
  // Order matters: replace `**` before `*` to avoid overlap.
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials
    .replace(/\*\*/g, "::DOUBLESTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLESTAR::/g, ".*");
  return new RegExp(`^${re}$`);
}
