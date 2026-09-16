# The trunk suite was red at this tick's base

`tests/commentCitations.test.ts` failed at afabd63d: two comments still cited
`.flume/plan/open-questions.md`, the page the questions drain (4d8cc0da)
`git rm`-ed. No build tick could ship until it was repaired, since the judge
reverts on a red suite — so this commit re-homes both cites
(`tests/Dispatcher.test.ts`, `tests/examples.test.ts`). A plan commit that
deletes a page owes the citations it strands, the way a code split does
(`.claude/rules/engineering.md`, *A module is one job*); the pin caught it,
but nothing judges a plan commit against the pin.

Also: the prior attempt of this entry was reverted for `tests[]` line "a note
under the parked directory parks its entry" passing at base. Cause was the
test, not the line — it addressed the park through a `notePath(root, tag,
kind)` whose third argument the base silently ignored, so at base it asserted
the old note path. Distinct accessors (`notePath` / `parkedNotePath`) leave
the base nothing to answer with. Worth watching wherever an entry widens an
existing signature.
