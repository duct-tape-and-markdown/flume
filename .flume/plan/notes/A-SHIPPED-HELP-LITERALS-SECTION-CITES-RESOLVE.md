# The shipped-help section arm, and three cite classes still unread

Landed: `scanRenderedSections` (`tests/helpers/commentCitations.ts`) runs the
one section-cite reader over rendered surfaces, driven by the real writer —
`shippedHelpPages()` (`tests/helpers/shippedHelp.ts`) renders `HELP_TOP` plus
one page per verb the top-level listing advertises. `topLevelCommandNames`
moved out of `tests/cliHelp.test.ts` into that helper, one home for the
verb-set read.

Three classes the arm still does not reach, in descending value:

1. **The comma-less spelling: 433 sites, measured.** `spec/loop.md "Crash
   equals stop"` — no comma, often no parens — draws no cite at all, so the
   section half is unjudged at 78 sites in `tests/Dispatcher.test.ts`, 29 in
   `src/waveMerge.ts`, 24 in `src/tickAttempt.ts`, 23 in `src/cli.ts`, and on
   down. The drawn grammar is `(page.md, *S*)`/`(page.md, "S")` alone, so the
   repo's 600-odd drawn cites are the minority spelling. Either the grammar
   widens (page name, optional comma, emphasized phrase, parens optional) or
   433 sites are respelled — the first is one regex and judges the class, and
   a widened grammar will red a batch of stale halves on the first run.
2. **No arm draws a cite off a `docs/` page or the README.** `docs/CLI.md:59`
   states (`spec/loop.md`, "Graceful stop") — the same abbreviation this entry
   fixed in the help literal, still standing. `engineering.md` already admits
   a docs page that states what a shipped interface does, and the new reader
   is page-agnostic (a name plus text), so the arm is a walk feeding the same
   scan.
3. **`harness/cli.ts`'s `HELP`.** A shipped help page (`flume-harness
   --help`) the arm cannot read: the module runs `main` at top level, so
   nothing may import it. It states no cite today, so the gap is latent.
