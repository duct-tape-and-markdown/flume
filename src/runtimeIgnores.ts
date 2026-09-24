/**
 * runtimeIgnores — the runtime-owned `.gitignore` set and the merge that
 * applies it: which entries the engine ensures under every state root, how a
 * declared friction dir is spelled as one of them, and the one create-or-
 * append that writes any of it to disk.
 *
 * spec/jobs.md "Runtime ignores" is the contract. Two adopters merge through
 * here — the engine's own state-root sweep at `loop` start (`src/cli.ts`) and
 * `flume-harness init` (`harness/init.ts`) over a repository's root file — so
 * the detection is spelled once (`.claude/rules/engineering.md`, *The fix
 * lands at the mechanism*).
 *
 * The set alone, and the write that applies it. What a state root holds
 * beyond its ignore file — a pidfile's claim, a queue read, a friction count
 * — belongs to the module each of those names (`src/pidClaim.ts`,
 * `src/pendingLedger.ts`, `src/friction.ts`).
 */

import { readFile, writeFile } from "node:fs/promises";
import { toNamespacedPath } from "node:path";

import { gitPath, namespacedJoin, STATE_ROOT_NAMES } from "./paths.js";

/**
 * Runtime-owned entries ensured in every state root's `.gitignore`. The
 * runtime owns its layout, and only that; a chain-convention directory under
 * the state root is its chain's to ignore.
 *
 * Derived from `STATE_ROOT_NAMES` (`src/paths.ts`) wherever an accessor owns
 * the name, so renaming a runtime path cannot leave the ignore behind
 * pointing at the old one. `node_modules/` is not the runtime's to name, so
 * it stays spelled here.
 *
 * An entry's trailing slash states the artifact's shape: git reads a bare
 * name as matching a file or a directory alike, so the slash is what says
 * which one this is, and every directory above carries it. The shape moves
 * with the name — an artifact that becomes a directory whose entry keeps its
 * old filename goes on matching the file it used to be, which is nothing.
 *
 * `worktrees/` is the default base alone (`worktreesBase`, `src/paths.ts`):
 * a base relocated by the operator (`FLUME_WORKTREES_DIR`) or by the chain
 * (`Chain.worktreesBase`) has already moved outside the state root, so there
 * is nothing under this `.gitignore` to ignore.
 */
export const RUNTIME_IGNORES = [
  `${STATE_ROOT_NAMES.awake}/`,
  `${STATE_ROOT_NAMES.priorAttempts}/`,
  `${STATE_ROOT_NAMES.renderedPrompts}/`,
  `${STATE_ROOT_NAMES.worktrees}/`,
  `${STATE_ROOT_NAMES.merging}/`,
  `${STATE_ROOT_NAMES.tickVerdict}/`,
  "node_modules/",
  STATE_ROOT_NAMES.loopLock,
  STATE_ROOT_NAMES.tickVerdictsLog,
  STATE_ROOT_NAMES.stopFlag,
] as const;

/**
 * Merge `lines` into the `.gitignore` at `path`: create the file if absent,
 * append only the entries it does not already carry otherwise. Returns the
 * lines appended, empty when the file already held every one. Idempotent;
 * hand-authored lines (and their order) are preserved verbatim.
 *
 * **One home, two adopters.** {@link ensureRuntimeIgnores} merges the runtime
 * set into a state root, and `flume-harness init` (`harness/init.ts`)
 * merges the consumer-prefixed set into a repository's root `.gitignore`.
 * The merge is the same detection either way, and a second spelling is how
 * one caller comes to duplicate a line the other deduped
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * `path` is folded here rather than by its callers: both adopters hand over a
 * root the consumer chose and this function is the only thing that touches
 * disk under it, so the fold has one home
 * (`.claude/rules/platform-facts.md`, *Windows MAX_PATH (~260 chars) breaks
 * fs calls with no long component*).
 */
export async function mergeIgnoreLines(
  path: string,
  lines: readonly string[],
): Promise<string[]> {
  const file = toNamespacedPath(path);
  // Absent (`ENOENT`) is the empty file: nothing authored, nothing to merge
  // into. Any other read failure rethrows rather than reading as empty — an
  // unreadable `.gitignore` treated as "" would be rewritten with the merged
  // set alone, dropping the hand-authored lines this function exists to
  // preserve (`.claude/rules/engineering.md`, "Loud or nothing").
  let existing: string;
  try {
    existing = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    existing = "";
  }
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = lines.filter((entry) => !have.has(entry));
  if (missing.length === 0) return [];
  const base =
    existing.length === 0 || existing.endsWith("\n") ? existing : existing + "\n";
  await writeFile(file, base + missing.join("\n") + "\n", "utf8");
  return missing;
}

/**
 * Merge {@link RUNTIME_IGNORES} — plus any caller-supplied `extra` entries (a
 * declared `Chain.friction` dir) — into `<stateRoot>/.gitignore`.
 */
export async function ensureRuntimeIgnores(
  stateRoot: string,
  extra: readonly string[] = [],
): Promise<void> {
  // win32 MAX_PATH (`.claude/rules/platform-facts.md`): a state root can be
  // relocated anywhere, so `.gitignore` under it can cross the total-path
  // limit even though no single component is long. namespacedJoin
  // (src/paths.ts) is the shared idiom.
  await mergeIgnoreLines(namespacedJoin(stateRoot, ".gitignore"), [
    ...RUNTIME_IGNORES,
    ...extra,
  ]);
}

/**
 * `<friction>/` as it belongs in `.gitignore` — forward-slashed and
 * single-trailing-slashed regardless of how the chain wrote the declaration
 * (`Chain.friction` is validated relative at load time; this only shapes it
 * for the ignore line).
 *
 * Exported so the friction entry is spelled once for every state root the
 * runtime set is merged into — the `loop` start in `src/cli.ts` today. A
 * second adopter re-spelling the normalization would be re-derived detection
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 */
export function frictionIgnoreEntry(friction: string): string {
  return `${gitPath(friction).replace(/\/+$/, "")}/`;
}
