# The questions directory ships; this repo's own page is plan's to migrate

`.flume/plan/open-questions.md` still holds one open question, and build's
fence reaches nothing under `.flume/plan/` but this note. **The next plan tick
migrates it**: one file per open question under `.flume/plan/questions/`, and
`git rm` the page in the same commit. The plan fence admits both paths, and
while the page is on disk the questions block names it instead of reporting
nothing open — so no slice can pass it over.

That fence line is a declared migration allowance (`harness/layout.ts`,
`docs/MIGRATING-0.17.md` § 3), retired in the release after 0.17 with
`legacyQuestionsPath` and the leg in `harness/questions.ts` naming the page.
Worth an entry once the drain has landed.

Two deviations from the entry's `files`: `harness/init.ts` is untouched —
adoption cannot seed an empty directory git will not carry, and absence reads
as nothing open — and the render moved into a new `harness/questions.ts`
rather than a shell span, which cannot tell an unreadable directory from an
empty one without swallowing the failure.

`.claude/rules/*.md` and `CLAUDE.md` still name the old page. Human surface.
