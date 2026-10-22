# The goal row's prose copies now read the driven writer

Both pins landed in `tests/cliHelp.test.ts`, beside the tick exit-code
precedent. `goalRows` is driven directly over a 12-work-entry goal (not
through `flume status`), so the pins cost no spawn; the row's skeleton — tags,
withheld count and span blanked, the named count surviving as the number of
`<TAG>` slots — is what each page's single sample row is compared against.
Verified both red with `NAMED_WORK` at 4 and green at 3.

Two things for the next derive:

1. **The count is spelled more than twice per page.** Beyond the sample row,
   `docs/CLI.md` says it three times in prose ("naming the first three", "which
   three of that work", "a goal with three or fewer"), and the help page twice.
   Each is pinned, but as a phrase fragment carrying the number word, so a
   human rewording the sentence reds the pin rather than the claim. The
   mechanical arm is the sample row alone. A tighter shape would be one
   exhaustive read — "every number word inside the goal-row passage is this
   one" — but the passage on the CLI page is one giant paragraph that also
   carries "two reads can leave the served order untakeable", so there is no
   decidable cut for it today. Left as targeted phrases on purpose.

2. **The CLI page's status section is a single ~5000-word paragraph.** Every
   page pin against it has to key on a phrase because nothing finer than the
   `##` heading cuts it. That is a page-shape finding, not a test one, and it
   is the human's surface — filing it only so a later entry wanting a
   sub-section cut knows the cut does not exist.

No other goal-row restatement found: `grep` over `docs/` and `src/` turns up
exactly one backticked sample on the CLI page and one quoted sample in
`src/cliHelp.ts`, and the pins assert that count rather than assuming it.
