# The page's back-pointer at the fixture is unpinned

The fixture comment now cites `.claude/rules/platform-facts.md`, *vitest's
JSON reporter can claim success over a non-zero exit*, and the citation pin
resolves it — verified by mutating the section text, which reds
`tests/commentCitations.test.ts`.

The other direction is not pinned. That section's expiry clause names its
retiring actor by symbol and path — "the fixture that produces the
contradiction (`UNHANDLED_TEST`, `tests/harnessRunner.test.ts`)". The pair
arm (`engineering.md`, *Narration is the ladder's bottom rung*) resolves an
identifier against the file its citation pairs it with, but that arm reads
comments in `src/`, `harness/`, `tests/`; a rule page is prose held by its
authors and no pin reaches it. So a rename or a move of `UNHANDLED_TEST`
leaves the page pointing at a door that no longer opens, silently, while the
fixture's own cite into the page stays green.

Whether that gap is worth closing is a harness-governance call, not mine: the
ladder section says prose about the harness itself is never promoted into the
suite, and the carve-outs admit `docs/` and the README, not `.claude/rules/`.
Filing it as an observation rather than a question.
