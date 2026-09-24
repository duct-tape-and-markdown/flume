# The furniture strip was eating a page cite, and the count was 26 not 25

Shipped: `pageParagraphs` + `scanPageSections` (`tests/helpers/pageAnchors.ts`)
feeding the one reader, now exported as `sectionCitesIn` /
`resolveSectionCites` (`tests/helpers/commentCitations.ts`).
`scanRenderedSections` is a composition of the two, so the help arm and the
page arm share grammar, rendering and resolution.

Two things the entry did not name.

1. `renderRun` stripped `CONTINUATION_MARGIN` from every line. A page line may
   *open* with the `*` of an emphasis the wrapping broke onto it, and the
   margin pattern ate that `*`: `docs/CHAIN-AUTHORING.md:229` (`spec/jobs.md`,
   the checkout section) drew no cite at all. The per-line render is now the
   caller's — `renderComment` for comments, `renderPlain` for a help page and a
   markdown page. That is why the drawn count is 26, not the 25 a
   furniture-stripping walk sees. The help surfaces changed renderer too; their
   pin stayed green, so no shipped help line opened with furniture.

2. `CommentLine` was a third spelling of `{line, text}` beside `ProseLine` and
   the page walk's inline literal. Folded to `ProseLine`
   (`tests/helpers/docSections.ts`), which all three readers now take.

Also: a doc comment illustrating the grammar as `` (`page.md`, *Section*) ``
is drawn by the comment arm as a real cite into a page that does not exist.
The established placeholder is `<page>.md`; the suite caught it, but it is a
sharp edge every future author of these helpers will hit once.

The one red the entry predicted was `docs/CLI.md:59`, fixed to
*Graceful stop — the stop flag*. Sibling
THE-SECTION-CITE-READER-TAKES-THE-PAREN-LESS-SPELLING widens `SECTION_CITE`
alone and needs no change here — the walk feeds whatever that reader accepts.
