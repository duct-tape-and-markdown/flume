# The ten arms landed; the cuts have a shared home, and one title still outruns its body

Shipped: `tests/helpers/renderedPrompt.ts` — `harnessLeads`, `taskBody`,
`listingUnder` — beside `tests/helpers/priorAttemptBlock.ts`, which keeps the
prior-attempt cut. `listingUnder` moved out of `tests/cliRender.test.ts`
verbatim, now with the indent as a parameter (the `not-shipped` record's path
listing is indented without a bullet), and that file imports it.

Mutation-checked on the tree, both directions: rewording `Writable paths`,
`Outer ceiling` or `Paths it touched:` in `src/Prompt.ts`, and renaming the
`<prior-attempt>` open tag, each reds the arm that used to pass over it.

Two observations for the next tick:

1. **Title outruns body**, `tests/Prompt.test.ts`: "scoped tick (no
   assignedEntry): byte-identical to a singleton tick's rendering" asserts no
   byte-identity against any singleton rendering — before this entry it was
   `toContain` + two negatives, now it is a `harnessLeads` total. The claim
   the title makes is unpinned either way (`engineering.md`, *A green verdict
   is proven non-vacuous*: a title is a claim its body asserts). Either the
   body renders a singleton phase and compares, or the title says what it
   pins. I did not restate it — retitling a case inside a lens entry hides
   the finding.

2. **The family's remaining half is unmeasured.** Raw negative counts, not
   findings — subject not read: `tests/cli.test.ts` 97, `tests/Dispatcher.test.ts`
   64, `tests/cliHelp.test.ts` 8, `tests/cliVerdict.test.ts` 7,
   `tests/cliStateDirs.test.ts` 5. Most are over a verdict line or an error
   message, which the lens does not reach. `tests/Dispatcher.test.ts` already
   reads prior-attempt claims through the shared cut, so its renders are
   likely clean; the CLI files assert over whole `stdout`, which is where the
   lens would bite next.
