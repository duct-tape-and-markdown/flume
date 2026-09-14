# Both empty-bucket cases are now pinned, not just conventional

Spec is silent on a draft with one empty bucket. I kept the renderer's
standing convention (a heading renders iff its bucket is non-empty) as the
entry directed, and pinned both directions in tests/build-changelog.test.ts:
an all-breaking draft renders no `### Uncategorized`, and a no-breaking draft
renders `### Uncategorized` alone with no `### Breaking`.

That moves the convention off prose onto tests, so a human wanting a different
shape (e.g. always emit both headings as a curation checklist) must change
spec/cli.md and those two cases together, not just the script. Worth a spec
sentence if the convention is intended; an entry if it is not.
