/**
 * `flume log` — the tick verdict history, read back oldest-first
 * (spec/cli.md, *Subcommand surface*).
 *
 * Named for the read and not the verb, because `src/cliLog.ts` beside it is
 * the CLI's stamped narration: two files named for one word is how a reader
 * opens the wrong one (`.claude/rules/engineering.md`, *A module is one job*).
 */

import { takeCountValue } from "./cliArgs.js";
import { operatorLog } from "./cliLog.js";
import { formatTickVerdictLine } from "./cliVerdict.js";
import { EX_IOERR } from "./exitCodes.js";
import type { FlumePaths } from "./flumeApi.js";
import { STATE_ROOT_NAMES } from "./paths.js";
import { thrownMessage } from "./thrown.js";
import {
  DEFAULT_LOG_VERDICTS,
  readTickVerdicts,
  type TickVerdict,
} from "./tickVerdict.js";

export async function logVerb(
  paths: FlumePaths,
  rest: string[],
): Promise<number> {
  const { flumeDir } = paths;
  const words = [...rest];
  let jsonMode = false;
  const jsonIdx = words.indexOf("--json");
  if (jsonIdx >= 0) {
    jsonMode = true;
    words.splice(jsonIdx, 1);
  }
  const requested = takeCountValue(words, "-n");
  // `log` consumes no positionals either, and a `-n` carrying no count is
  // left standing by the take — so one refusal answers both.
  if (requested === null || words.length > 0) {
    operatorLog.error("usage: flume log [-n N] [--json]");
    return 2;
  }
  // How many verdicts to read back, and this verb's own default when the
  // operator named no count.
  const n = requested ?? DEFAULT_LOG_VERDICTS;

  // spec/cli.md "Subcommand surface", `log`: the exit-0/prints-nothing arm
  // is **no verdicts file**, so a log that is present and unreadable takes
  // the same EX_IOERR every other present-but-unreadable read this CLI
  // makes takes. Printing nothing over it would state the opposite of what was
  // observed — an operator reading silence as "this repo has not ticked".
  let verdicts: TickVerdict[];
  try {
    verdicts = await readTickVerdicts(flumeDir, n);
  } catch (err) {
    operatorLog.error(
      `[flume] log: ${STATE_ROOT_NAMES.tickVerdictsLog} failed to read: ${thrownMessage(err)}`,
    );
    return EX_IOERR;
  }
  for (const v of verdicts) {
    console.log(jsonMode ? JSON.stringify(v) : formatTickVerdictLine(v));
  }
  return 0;
}
