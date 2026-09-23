# The forty-character number lived in one comment, not two

The entry named `renderFindings`/`expectNoFindings` jointly, but the number
was stated only in `renderFindings`' doc comment
(`tests/helpers/repoProgram.ts`). `expectNoFindings` already narrated the
doubling without the figure, so it needed no edit; the shrink is one
paragraph.

A repo-wide search for the fact (`forty`, `40 char`, `truncat` across `src/`,
`harness/`, `tests/`, `docs/`) turned up no other copy, so the number is now
stated once, on `.claude/rules/platform-facts.md`. The `renderFindings`
paragraph above the shrunk one cites chai's *array item* elision
(`expected [ ...(3) ] to deeply equal []`) — a different mechanism from the
40-character value truncation, carrying no figure of its own, so it was left
standing rather than folded into the same cite.

The citation pin resolves the new page/section pair;
`tests/commentCitations.test.ts` is green (38 tests).
