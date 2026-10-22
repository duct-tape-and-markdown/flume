/**
 * The stop flag's one read, for every CLI surface that reports on it: whether
 * the flag stands under a state root — proven, never guessed from an errno —
 * and the sentence a surface names when the read itself refused.
 *
 * Its own file because three verbs ask the same question and answer it
 * differently: `flume loop` refuses to start over a standing flag, `flume
 * status` prints it, and `flume wake` names it in the clause it already
 * speaks. The probe and the refusal's wording are what they share, so they
 * share one spelling of both (`.claude/rules/engineering.md`, *The fix lands
 * at the mechanism*); what each outcome *means* stays each verb's own — the
 * exit code it takes and the stream it says so on.
 *
 * The mid-run read is deliberately not a caller: a wave's refill asks the
 * same path and wants the throw (`src/waveTick.ts`), because a state root it
 * cannot stat mid-run must end the run rather than read as no stop requested.
 * This face is for a surface whose answer is a *line*, which is why the
 * refusal arrives as a value with its sentence attached.
 */

import { operatorLog } from "./cliLog.js";
import { existsLoudUnder } from "./fsProbe.js";
import { stopFlagPath } from "./paths.js";
import { thrownMessage } from "./thrown.js";

/**
 * What a surface learns about the stop flag: that it stands, that it is
 * proven absent, or that the read refused — carrying, in that last case, the
 * sentence every caller spells about it, so the three refusals cannot drift
 * into three descriptions of one failure.
 *
 * `path` rides every arm because every arm is printed: the state root is
 * relocatable (`FLUME_DIR`), so a line about "the stop flag" that does not
 * name the file sends an operator to a path this run never read.
 */
type StopFlagRead =
  | { readonly kind: "present"; readonly path: string }
  | { readonly kind: "absent"; readonly path: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly detail: string };

/**
 * Read the stop flag under `flumeDir`.
 *
 * Absent is the only silent answer and it is **proven**: the descent
 * `existsLoudUnder` (`src/fsProbe.ts`) spends from the state root is what
 * separates a flag that is not there from one under an ancestor a plain file
 * stands at, which a single stat spells `ENOENT` on win32
 * (`.claude/rules/platform-facts.md`, *win32 reports a path through a
 * non-directory as not found*). A surface that read the obstructed tree as
 * "no stop pending" would state the one thing `spec/loop.md`, *Graceful stop
 * — the stop flag* promises can never happen
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export function readStopFlag(flumeDir: string): StopFlagRead {
  const path = stopFlagPath(flumeDir);
  try {
    return existsLoudUnder("stop flag", flumeDir, path)
      ? { kind: "present", path }
      : { kind: "absent", path };
  } catch (err) {
    return {
      kind: "unreadable",
      path,
      detail: `stop flag at ${path} failed to stat: ${thrownMessage(err)}`,
    };
  }
}

/**
 * The clause a verb whose own effect is a baton marker adds when the flag
 * stands, and `undefined` when it is proven absent.
 *
 * The flag's consequence is fixed rather than conditioned on whether a
 * supervisor happens to be live — that phrasing is `flume status`'s, beside
 * the liveness line it already prints, and `stopVerb` (`src/cliBaton.ts`)
 * states the same fixed consequence for the same reason.
 *
 * The unreadable arm is the **declared** degradation: the marker this verb
 * wrote already landed and the verb's own work is not in doubt, so the read's
 * failure is said on stderr and the exit stays the write's. It is not
 * silence, and the refusal that bounds it is the one the sentence names: a
 * run is what must not start over an unresolved flag, and the next `loop`
 * refuses on this same read rather than starting one
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export function standingStopClause(
  surface: string,
  flumeDir: string,
): string | undefined {
  const read = readStopFlag(flumeDir);
  if (read.kind === "absent") return undefined;
  if (read.kind === "unreadable") {
    operatorLog.error(
      `[flume] ${surface}: ${read.detail} — the marker this verb wrote ` +
        "stands; whether a stop is pending went unread, and the next " +
        "`loop` refuses on the same read until it resolves",
    );
    return undefined;
  }
  return (
    `stop flag present at ${read.path}: the next \`loop\` refuses to ` +
    "start until it is removed"
  );
}
