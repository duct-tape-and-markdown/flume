/**
 * The rendered-prompts directory — `<flumeDir>/rendered-prompts/`, one file
 * per invocation, written before that agent runs (spec/prompt.md, *The
 * rendered prompt is persisted before the agent runs*).
 *
 * One job: what the directory holds, and for how long. The write is the
 * dispatcher's (`recordRenderedPrompt`, `src/tickAttempt.ts`); the listing,
 * the run window a filename is read against, and the trim that bounds the
 * directory live here because two callers share one edge — `flume status`
 * counts the run's outstanding agents by it (`src/runSpend.ts`) and the
 * verdict-history append trims by it (`src/tickVerdict.ts`) — and a second
 * spelling of "at or after the stamp" is how the two drift apart
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * The window is one predicate over one alphabet: every prompt file is named
 * with {@link fsStamp}, which is fixed-width and ISO-derived and so sorts
 * chronologically as plain text, and the window's own edge is rendered
 * through that same writer and compared as a string. Nothing parses a stamp
 * back out of a filename, and nothing reads an mtime — no writer contracts
 * one, and a restore, a backup tool or a stray `touch` moves it under a live
 * run.
 */

import { readdir, rm } from "node:fs/promises";

import { isDirectoryOrAbsentUnder } from "./fsProbe.js";
import {
  fsStamp,
  namespacedJoin,
  renderedPromptsDir,
  STATE_ROOT_NAMES,
} from "./paths.js";
import { liveLoopClaim } from "./pidClaim.js";

/**
 * The prefix on every verdict row's `promptPath` — state-root-relative,
 * forward slashes, git's alphabet rather than the host's. Composed here and
 * taken by both sides of that row: `recordRenderedPrompt`
 * (`src/tickAttempt.ts`) writes it, and every reader below resolves a row
 * through it, so neither side can respell it alone.
 */
export const RENDERED_PROMPT_PREFIX = `${STATE_ROOT_NAMES.renderedPrompts}/`;

/**
 * The window's edge, as a filename of this directory would spell it — what a
 * caller holding a run's start instant compares names against.
 */
export function runWindowStamp(startedAtMs: number): string {
  return fsStamp(new Date(startedAtMs));
}

/**
 * The filename a verdict row's `promptPath` names in this directory, or
 * `undefined` when the path is not one this engine spelled — a row carrying a
 * path from elsewhere is a statement about a file this directory's retention
 * does not govern, and each caller says what it does with that rather than
 * having a fallback chosen here.
 */
export function renderedPromptName(promptPath: string): string | undefined {
  return promptPath.startsWith(RENDERED_PROMPT_PREFIX)
    ? promptPath.slice(RENDERED_PROMPT_PREFIX.length)
    : undefined;
}

/**
 * Whether the invocation `name` was rendered for began at or after
 * `startStamp` — the string compare the stamp's format exists for, and the
 * one edge both callers above take.
 */
export function withinRunWindow(name: string, startStamp: string): boolean {
  return name >= startStamp;
}

/**
 * The rendered-prompt files on disk, one per invocation this state root
 * still holds. Absent reads as none and is **proven** from the state root
 * down, the same descent every other read of a state-root artifact takes
 * (`isDirectoryOrAbsentUnder`, `src/fsProbe.ts`): a plain file standing above
 * the dir answers the listing `ENOENT` on win32
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*), and an empty listing over an obstructed root
 * is a live wave read as a settled one.
 */
export async function renderedPromptNames(flumeDir: string): Promise<string[]> {
  const dir = renderedPromptsDir(flumeDir);
  if (!isDirectoryOrAbsentUnder("rendered prompts", flumeDir, dir)) return [];
  let names: string[];
  try {
    names = await readdir(namespacedJoin(dir));
  } catch (err) {
    // Named and pathed, the spelling every read of a state-root artifact
    // refuses in: the verb above states the subject it was reading for, and
    // the cause states which artifact and where, so an operator under a
    // relocatable state root is told the path to go fix.
    throw new Error(
      `[flume] rendered prompts are unreadable: ${dir} — ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
  return names.filter((name) => name.endsWith(".md"));
}

/**
 * Remove every rendered prompt no longer named by `retained` and not inside
 * a live run's window (spec/prompt.md, *The rendered prompt is persisted
 * before the agent runs*: "A prompt lives as long as something names it").
 * `retained` is the set of `promptPath` values the verdict history still
 * carries, so the directory is bounded by that history's own retention and
 * by no second setting.
 *
 * The window is the live loop lock's claim instant, the same fact `flume
 * status` bounds the run's spend by (spec/loop.md, *The loop lock and the tip
 * claim*). A prompt inside it is spend no row has reported yet, and deleting
 * it would take away the only evidence the agent it was handed to ever
 * started. Two claims withhold the trim entirely rather than guess an edge: a
 * lock stating no instant (written by a flume before 0.17, or rolled by hand)
 * bounds nothing, and no live lock at all leaves only the retained set —
 * which is correct, because the tip claim bounds a lockless tree to one bare
 * tick per ref and that tick's own verdict is the line just appended.
 *
 * **Never throws.** The trim follows a verdict whose tick has already
 * reported its outcome, and its failure mode is one-sided: every path out of
 * a failure leaves files standing, so a refused listing or a refused unlink
 * over-keeps and can never lose a prompt a reader still wants. What the
 * failure itself was is not swallowed — `flume status` reads this same
 * directory through {@link renderedPromptNames} and exits `EX_IOERR` on a dir
 * that is present and will not read (spec/cli.md, *`flume status` owes
 * exactly this*), which is the refusal that bounds this silence
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export async function trimRenderedPrompts(
  flumeDir: string,
  retained: ReadonlySet<string>,
): Promise<void> {
  try {
    const claim = await liveLoopClaim(flumeDir);
    let startStamp: string | undefined;
    if (claim !== null) {
      if (claim.atMs === undefined) return;
      startStamp = runWindowStamp(claim.atMs);
    }
    const dir = renderedPromptsDir(flumeDir);
    for (const name of await renderedPromptNames(flumeDir)) {
      if (startStamp !== undefined && withinRunWindow(name, startStamp)) {
        continue;
      }
      if (retained.has(RENDERED_PROMPT_PREFIX + name)) continue;
      // `force` so a sibling that removed the same file between the listing
      // and here is not a failure — the outcome asked for is already true.
      await rm(namespacedJoin(dir, name), { force: true });
    }
  } catch {
    return;
  }
}
