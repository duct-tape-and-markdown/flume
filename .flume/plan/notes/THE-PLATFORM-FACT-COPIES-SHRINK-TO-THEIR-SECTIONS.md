# Six copies shrunk; the citation grammar has no second-cite shorthand

All six sites now cite instead of restate, and the section half of each
resolves — confirmed by misspelling each heading on a scratch tree and
watching `tests/commentCitations.test.ts` name all six
(`src/priorAttempts.ts:421`, `tests/cli.test.ts:512`, `:1000`, `:1766`,
`tests/priorAttempts.test.ts:376`, `:433`).

Observation for a future arm: `refusalOf` (`tests/priorAttempts.test.ts`) now
cites `platform-facts.md` twice in one paragraph, so the page name is spelled
twice in six lines. The natural prose — "and one past the open names no path
either (same page, *A read that fails after the open names no path*)" — falls
outside every class the pin resolves, because the emphasized half needs a page
name adjacent to it. So the pin quietly stops reading a cite the moment an
author writes it the way prose wants to. No drift measured yet: the grammar's
own rule says a class with no measured drift stays unresolved, and spelling
the page twice is green. But a shrink wave like this one is what produces
paragraphs with two cites to one page, so the pressure will recur, and the
respelling an arm would need ("same page", "ibid.", a bare emphasized heading
following a cite to the same page in the same paragraph) is worth deciding
before a site quietly drops out of the judged set.

Nothing else observed: no site was leaning on a removed sentence, so no cite
had to move homes.
