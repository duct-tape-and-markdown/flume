/**
 * The flag readings more than one verb parses with.
 *
 * `src/cli.ts` splits argv into a verb and the words behind it, and what
 * those words mean is each verb's own to read. These are the two readings
 * more than one verb reaches for, so they have one home rather than a
 * spelling per verb (`.claude/rules/engineering.md`, *A module is one job*).
 */

/**
 * `loop`'s `--max` and `log`'s `-n` numeric parse: the value is a decimal
 * integer or it is `null`, and the caller refuses on it before the run
 * starts.
 *
 * Exactly what an operator types for a count — digits, and a value too
 * large to land on a finite number is none. Not `Number` alone, which reads
 * the empty string and whitespace as 0 and admits `-0`, `2.5`, `0x10` and
 * `1e3`: a wrapper spelling `--max "$BUDGET"` over an unset variable would
 * start no child and exit 0 as a completed run, which is a silent degrade
 * wearing a number (`.claude/rules/engineering.md`, *Loud or nothing*). The
 * reading next door refuses the same class for a pid
 * (`decodeTipClaimHandoff`, `src/cliRunContext.ts`); this one admits 0,
 * which a pid never is.
 */
export function parseMaxValue(value: string | undefined): number | null {
  if (value === undefined || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Take a `--flag <value>` pair out of `words` in place, leaving the
 * positionals its caller then refuses on: `undefined` when the flag is
 * absent, `null` when it is present carrying nothing usable — the end of the
 * argv, or the next flag, which is an operator who typed the flag and then
 * forgot its value rather than one naming a value that starts with a dash.
 * Both `--phase <name>` (`src/cliTick.ts`) and `--entry <tag>`
 * (`src/cliRender.ts`) are this one sequence; the numeric flags (`--max`,
 * `-n`) keep {@link parseMaxValue}, which decides more than presence.
 */
export function takeFlagValue(
  words: string[],
  flag: string,
): string | null | undefined {
  const idx = words.indexOf(flag);
  if (idx < 0) return undefined;
  const value = words[idx + 1];
  if (!value || value.startsWith("-")) return null;
  words.splice(idx, 2);
  return value;
}
