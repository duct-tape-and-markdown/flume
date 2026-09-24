# The harness page joins the scan stating no cite yet

`HARNESS_HELP` (`harness/cliHelp.ts`) is now a surface in
`shippedHelpPages()`, so the rendered-section arm reads the page
`flume-harness --help` prints on the same terms as the engine's pages. The
page states no `(page.md, *Section*)` cite today, so the widened set reds
nothing on landing — as the entry predicted. What is bought is the next
cite anyone writes into that page.

Two things the next plan tick may want:

1. `harness/cliHelp.ts` is deliberately absent from `harness/index.ts`. Its
   consumers are `harness/cli.ts` and `tests/helpers/shippedHelp.ts`, which
   is what the export pin reads; the page is not chain-author API.
2. Only the section arm reaches a rendered surface, and
   `scanRenderedSections` (`tests/helpers/commentCitations.ts`) declares and
   cites why. The harness page names `PROTOCOL.md`, `chain.ts` and
   `package.json` in prose, none of them judged — correct under that
   declared scope, noted only so a later widening knows what is sitting
   there.

No debt observed in the split itself: the module header of `harness/cli.ts`
already claimed to be the argv half and nothing else, so this made the
header true rather than rewriting it.
