/**
 * paths — the win32 total-path-limit fix idiom, shared. See
 * `.claude/rules/platform-facts.md`, "Windows MAX_PATH (~260 chars) breaks
 * fs calls with no long component" for the mechanism; every call site that
 * builds a path for an fs call wants both steps together — this is the one
 * place that pairs them.
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

/**
 * A fanout tick's entry-scoped write allowance: the assigned entry's
 * declared files ∪ the phase's channel globs, deduped (RELEASE-v0.7 §2, §5).
 * Shared home for the two independent consumers that must never state a
 * different fence — `effectiveFenceLines` (`src/Prompt.ts`) renders it for
 * the agent, `writablePathsGate` (`src/builtinGates.ts`) enforces it against
 * the commit (engineering.md "Derived state is computed, never restated
 * beside its source").
 */
export function entryWriteScopeUnion(
  entryPaths: string[],
  channelPaths: string[],
): string[] {
  return [...new Set([...entryPaths, ...channelPaths])];
}
