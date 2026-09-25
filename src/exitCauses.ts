/**
 * How a documented exit cause is labelled — the one home the phrase every
 * surface states that cause under has.
 *
 * A cause reaches an operator on two surfaces with two registers: a
 * `--help` exit-code block (`src/cliHelp.ts`), which lays each cause out as
 * a standalone clause of its own, and `docs/CLI.md`, which spends one
 * flowing sentence per verb on the whole range. Neither can quote the
 * other's clause whole, so a clause carries one span designated as its
 * **phrase**: the words a surface documenting this cause states it under,
 * short enough for a sentence to carry verbatim and particular enough that
 * no sibling cause reads as it. A code re-routed between two arms then
 * cannot leave a page describing the arm it used to be, because the phrase
 * moved with the arm.
 *
 * The phrase is a span of the clause rather than a second string beside it:
 * {@link clauseOf} composes the clause around it, so the label and the
 * clause cannot drift (`.claude/rules/engineering.md`, *Derived state is
 * computed, never restated beside its source*).
 */
export interface ExitCauseLabel {
  /**
   * What the clause says ahead of its phrase, verbatim and with its own
   * trailing space. Absent where the phrase opens the clause.
   */
  readonly opening?: string;
  /** The phrase every surface documenting this cause states it under. */
  readonly phrase: string;
  /**
   * The clause from the phrase's end — its own opening punctuation or space
   * included, since where a clause resumes is the clause's business.
   */
  readonly rest: string;
}

/** The whole clause a `--help` exit-code block spends on one cause. */
export function clauseOf(label: ExitCauseLabel): string {
  return `${label.opening ?? ""}${label.phrase}${label.rest}`;
}
