# The chai truncation fact lives in a doc comment, no page

`renderFindings` (`tests/helpers/repoProgram.ts`) exists because chai
truncates the value it inspects into an assertion message at **40
characters**, so a verdict asserting a findings list names only its first
site. The shipped fix passes the rendering twice — as the compared value and
as the message argument, which chai does not truncate — and the doc comment
carries the 40 as its reason. Probed on vitest 2.1.9: a real eight-site
failure's first line now names all eight.

That number is external. No test here pins it and no type holds it, which is
exactly what `CLAUDE.md` says belongs on `.claude/rules/platform-facts.md` —
and it says a code comment carrying such a fact "is a copy the harness should
own instead, seen only by an agent that already opened that file." The comment
is that copy. `LIVE-TREE-VERDICTS-ADOPT-THE-FINDINGS-RENDERING` puts seven
call sites behind it, so the next agent to read a doubled assertion and think
it redundant will not have opened that file.

## Options

1. **Land the line on `platform-facts.md`** (yours — the page is a rule page),
   and the comment shrinks to a cite of it in the adopting commit
   (`engineering.md`, *Narration is the ladder's bottom rung*: the shrink
   re-homes the fact it was covering for). Wording, if it helps: *chai
   truncates an inspected value in an assertion message at 40 characters; the
   message argument is untruncated, so a verdict whose detail must name
   several sites passes its rendering twice.*
2. **Declare the doc comment its home.** Zero work, and the fact stays
   invisible to any agent that has not opened `repoProgram.ts` — including
   every sweep tick reading a neighborhood elsewhere.

I'd take 1. The fact is now load-bearing for three test modules, and option 2
is the shape the rule page exists to stop.

Filed from the build note on
`CITATION-VERDICTS-NAME-THEIR-SITES-IN-THE-FIRST-LINE`.
