/**
 * The flag readings more than one verb parses with.
 *
 * `src/cli.ts` splits argv into a verb and the words behind it, and what
 * those words mean is each verb's own to read. These are the readings more
 * than one verb reaches for: one sequence that takes a `--flag <value>` pair
 * out of those words, the two decisions about the value behind the flag that
 * sequence runs, and the split at argv's own `--` separator that decides
 * which side of it a word is on — so a reading has one home rather than a
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
 * Locate `flag` in `words`, decide the word behind it, and take the pair out
 * in place when that decision holds: `undefined` when the flag is absent,
 * `null` when it is present carrying nothing `decide` accepts. The refused
 * pair is left standing, so a verb that answers `null` with its usage line
 * also meets it at the positional check behind that line.
 *
 * The one sequence behind {@link takeFlagValue} and {@link takeCountValue}:
 * the two differ in what they accept behind the flag and in what they hand
 * back, never in how they find it or how they leave `words`.
 */
function takeDecidedValue<T>(
  words: string[],
  flag: string,
  decide: (word: string | undefined) => T | null,
): T | null | undefined {
  const idx = words.indexOf(flag);
  if (idx < 0) return undefined;
  const decided = decide(words[idx + 1]);
  if (decided === null) return null;
  words.splice(idx, 2);
  return decided;
}

/**
 * Take a `--flag <value>` pair whose value is any word: `null` for the end of
 * the argv, or for the next flag, which is an operator who typed the flag and
 * then forgot its value rather than one naming a value that starts with a
 * dash. Both `--phase <name>` (`src/cliTick.ts`) and `--entry <tag>`
 * (`src/cliRender.ts`) are this reading.
 */
export function takeFlagValue(
  words: string[],
  flag: string,
): string | null | undefined {
  return takeDecidedValue(words, flag, (word) =>
    !word || word.startsWith("-") ? null : word,
  );
}

/**
 * Take a `--flag <count>` pair, answering the number it named. The same
 * sequence with {@link parseMaxValue} deciding, which decides more than
 * presence — so `loop`'s `--max` and `log`'s `-n` are one reading rather than
 * one each. What stays each verb's own is what the two copies of this
 * actually differed in: the default an absent flag falls back to, and the
 * usage line it refuses with.
 */
export function takeCountValue(
  words: string[],
  flag: string,
): number | null | undefined {
  return takeDecidedValue(words, flag, parseMaxValue);
}

/**
 * Split `words` at the first `--`: what stands ahead of the separator, and
 * what stands behind it — `undefined` behind when no separator appears at
 * all, `[]` when one appears last and names nothing.
 *
 * The separator is argv's own end-of-options marker, so one reading serves
 * both sides of it: `src/cli.ts` reads the words *ahead* when it decides
 * whether a `--help` on the command line is a request for a page (a `--help`
 * behind the separator belongs to the command being carried, never to
 * flume), and `exclusiveVerb` (`src/cliExclusive.ts`) reads the words behind
 * as the command it runs. A verb that spelled its own `indexOf("--")` beside
 * the dispatch's would be the second copy of one decision
 * (`.claude/rules/engineering.md`, *A module is one job*).
 */
export function splitAtSeparator(words: readonly string[]): {
  ahead: string[];
  behind: string[] | undefined;
} {
  const idx = words.indexOf("--");
  if (idx < 0) return { ahead: [...words], behind: undefined };
  return { ahead: words.slice(0, idx), behind: words.slice(idx + 1) };
}
