/**
 * The flag readings more than one verb parses with.
 *
 * `src/cli.ts` splits argv into a verb and the words behind it, and what
 * those words mean is each verb's own to read. These are the two readings
 * more than one verb reaches for, so they have one home rather than a
 * spelling per verb (`.claude/rules/engineering.md`, *A module is one job*).
 */

/**
 * `loop`'s `--max` and `log`'s `-n` numeric parse: a value that is missing,
 * non-numeric or negative is `null`, and the caller refuses on it before the
 * run starts.
 */
export function parseMaxValue(value: string | undefined): number | null {
  const parsed = value !== undefined ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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
