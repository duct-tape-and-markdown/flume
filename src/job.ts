/**
 * State-root primitives with no module of their own yet: the runtime-owned
 * ignore set and the merge that applies it, the friction channel's ignore
 * spelling, the loop pidfile's claim read, the friction-file count, and the
 * chain-less pending read.
 *
 * The file keeps the name the `flume job` verbs left it with, deliberately:
 * `spec/jobs.md` governs the runtime ignore set, and that page keeps its own
 * name while any citation still resolves it — the commit that re-homes these
 * primitives is the one that renames both.
 */

import { readdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { toNamespacedPath } from "node:path";

import {
  gitPath,
  isDotName,
  loopLockPath,
  namespacedJoin,
  STATE_ROOT_NAMES,
} from "./paths.js";
import { parsePendingLoose } from "./PendingSchema.js";
import { parsePidClaim, type PidClaim } from "./pidClaim.js";
import type { ParseResult } from "./PendingSchema.js";

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
  "node_modules/",
  STATE_ROOT_NAMES.loopLock,
  STATE_ROOT_NAMES.tickVerdict,
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

/**
 * What `<dir>/loop.pid` states about its holder, when that holder is a live
 * process — `null` for no pidfile, an unparsable one, or a dead/not-ours pid
 * (stale; callers reclaim silently). Same liveness probe as the loop lock.
 *
 * The statement is `parsePidClaim`'s (`src/pidClaim.ts`): the pid off the
 * first line, the claim instant off the second where the holder stated one.
 * `flume status` reads the whole claim — it reports the holder *and* bounds
 * the run's spend by the instant — so one read answers both rather than a
 * liveness probe beside a second read of the same file.
 *
 * Absent (`ENOENT`) is the only no-pidfile reading; any other read failure
 * (permission denied, a path too long for the platform, …) throws
 * (`.claude/rules/engineering.md`, "Loud or nothing"). A `null` from an
 * unreadable pidfile would report a live loop as dead, which is exactly the
 * reading the `flume loop` lock claim exists to prevent.
 */
export async function liveLoopClaim(dir: string): Promise<PidClaim | null> {
  // win32 MAX_PATH: dir is a state root that can nest deep; namespacedJoin
  // (src/paths.ts) is the shared idiom.
  const pidPath = namespacedJoin(loopLockPath(dir));
  let raw: string;
  try {
    raw = await readFile(pidPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const claim = parsePidClaim(raw);
  if (claim === null) return null;
  try {
    process.kill(claim.pid, 0);
    return claim;
  } catch {
    return null;
  }
}

/**
 * The live holder's pid alone — {@link liveLoopClaim} for a caller that needs
 * only liveness. Exported for reuse (`flume loop`'s lock claim) rather than a
 * second implementation of the same pid-liveness check.
 */
export async function liveLoopPid(dir: string): Promise<number | null> {
  return (await liveLoopClaim(dir))?.pid ?? null;
}

/**
 * Files (not subdirs) directly under `dir`, dot-prefixed names skipped — a
 * `.gitkeep` git forced the consumer to create is not a note (spec/chain.md,
 * "`Chain.friction` — the declared friction channel"), and the skip is
 * `isDotName` (`src/paths.ts`), the same test the `friction` verb's listing
 * and read-by-name apply. `0` when `dir` is absent
 * (`ENOENT` — nothing filed is nothing to count, the same reading
 * `readPendingLoose` gives an absent `pending.json`); `null` when `dir`
 * exists but `readdir` fails for any other reason — that failure is a
 * real unresolved input, not a legitimate zero, so it must not read the
 * same as an empty dir (`.claude/rules/engineering.md`, "Loud or nothing").
 *
 * Exported so `frictionCountLine` (`src/friction.ts`) shares this
 * ENOENT-vs-other split instead of re-deriving it
 * (`.claude/rules/engineering.md`, "the fix lands at the mechanism").
 */
export function countFrictionFiles(dir: string): number | null {
  try {
    // win32 MAX_PATH (`.claude/rules/platform-facts.md`): dir joins a state
    // root onto chain.friction, the same construction `harvestFriction`
    // (`src/friction.ts`) and `writeRevertNote` (`src/tickAttempt.ts`)
    // guard. `namespacedJoin` (`src/paths.ts`) is the shared idiom.
    return readdirSync(namespacedJoin(dir), { withFileTypes: true }).filter(
      (e) => e.isFile() && !isDotName(e.name),
    ).length;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    return null;
  }
}

/**
 * Chain-less informational read of a pending.json at `pendingPath`: absent
 * (`ENOENT`) reads as the empty, valid list (nothing planned is nothing
 * pending); present reads through `parsePendingLoose` (core fields
 * validated, no extension composed — never a write path). Any other read
 * failure (permission denied, a path too long for the platform, …) is
 * rethrown rather than folded into the absent case
 * (`.claude/rules/engineering.md`, "Loud or nothing") — rethrowing leaves the
 * caller to decide how to surface it: `flume status` (`src/cli.ts`) catches
 * it, reports the failure, and exits non-zero rather than printing
 * "pending: 0" over a queue it could not read.
 */
export function readPendingLoose(pendingPath: string): ParseResult {
  let raw: string;
  try {
    raw = readFileSync(namespacedJoin(pendingPath), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, entries: [], errors: [] };
    }
    throw err;
  }
  return parsePendingLoose(raw);
}
