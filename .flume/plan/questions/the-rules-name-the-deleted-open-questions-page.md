# The rule pages and CLAUDE.md still name `.flume/plan/open-questions.md`

The page is gone — de5b6bcb shipped `plan/questions/`, 4d8cc0da `git rm`'d the
page, and the directory is the only channel a slice reads. Six sites in the
human's own surface still name the page as the live artifact, so a session
reading them routes a question into a file no slice will ever see:

- `CLAUDE.md:24` — "prose at `.flume/plan/open-questions.md`"
- `.claude/rules/spec-plan-build.md:8` — the plan row's artifact list
- `.claude/rules/spec-plan-build.md:18,19` — "Cross-tick context belongs in
  …/open-questions.md"; "Open questions go in …/open-questions.md"
- `.claude/rules/collaboration.md:13,32,41` — where a park lands, and the
  dialogic register's example
- `.claude/rules/memory.md:24` — "`open-questions.md` is plan's alone"
- `.claude/rules/engineering.md:93` — "a question listing beside
  `open-questions.md`", as an example of a restated artifact

The citation pin (`tests/commentCitations.test.ts`) resolves page names only
in the sweep domain, which does not include `.claude/` or `CLAUDE.md`, so
nothing catches these.

Proposed, if you want it done mechanically: each site names
`.flume/plan/questions/` (a directory, one file per question), and
`engineering.md`'s example keeps its point — a listing beside the directory is
still the defect it illustrates. Plan cannot edit these; this file is the ask.

Raised by the build note on AN-OPEN-QUESTION-IS-ONE-FILE-PRESENT-WHILE-OPEN.
