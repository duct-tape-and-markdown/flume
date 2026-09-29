/**
 * The class the count flags refuse — `flume loop`'s `--max` and `flume log`'s
 * `-n`, both decided by `parseMaxValue` (`src/cliArgs.ts`).
 *
 * One home rather than one per suite: two suites drive this class — one
 * through each verb's own process for the exit code an operator sees, one
 * against the prose rows that enumerate it — and a second copy is a class
 * that can drift from the parse deciding it (`.claude/rules/engineering.md`,
 * *A module is one job*).
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

/** One value of the class, under the span the shipped rows name its arm by. */
export interface CountFlagRefusal {
  /** What this value is, for a failing assertion to name. */
  readonly label: string;
  /**
   * The span every surface stating the class names this arm under — what
   * crosses from the two `--help` rows to `docs/CLI.md`'s two copies of the
   * same enumeration. Arms carrying more than one value share a span.
   */
  readonly phrase: string;
  /** The value handed to `parseMaxValue`, which answers `null` for it. */
  readonly value: string;
}

/**
 * The values, in the order the rows enumerate their arms. `parseMaxValue`
 * refuses every one; `Number` alone takes most of them, which is the reading
 * the flags had (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export const NOT_A_DECIMAL_INTEGER: readonly CountFlagRefusal[] = [
  { label: "the empty string", phrase: "the empty string", value: "" },
  { label: "a space", phrase: "whitespace", value: " " },
  { label: "a tab", phrase: "whitespace", value: "\t" },
  { label: "a signed zero", phrase: "a signed", value: "-0" },
  { label: "a fraction", phrase: "fractional", value: "2.5" },
  { label: "a hex literal", phrase: "hex", value: "0x10" },
  { label: "an exponent literal", phrase: "exponent literal", value: "1e3" },
  // Digits alone, past what a finite number holds: `Number` reads it as
  // Infinity, which as a budget is a run with no bound.
  {
    label: "an overlong digit run",
    phrase: "a digit run past what a finite number holds",
    value: "9".repeat(400),
  },
];

/**
 * The arms the rows enumerate, each named once. The class is stated as a
 * seven-arm list on every surface that states it at all, so a table that lost
 * an arm is a row read over six.
 */
export const COUNT_FLAG_REFUSAL_PHRASES: readonly string[] = [
  ...new Set(NOT_A_DECIMAL_INTEGER.map((refusal) => refusal.phrase)),
];

/**
 * The lead every row opens the class with — what scopes the rows that state
 * it, read off the shipped pages rather than from a list of verbs here.
 */
export const COUNT_FLAG_CLASS_LEAD = "not a decimal integer";
