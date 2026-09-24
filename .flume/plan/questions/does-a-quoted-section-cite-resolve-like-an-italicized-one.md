# Does a quoted section cite resolve like an italicized one?

**Section:** `.claude/rules/engineering.md`, *Narration is the ladder's bottom rung* —
the citation-class paragraph, which admits "the italicized section half of a
`` (`page.md`, *Section*) `` pair, resolved against that page's headings, bolded
bullet leads, and a bolded lead opening a blockquote line".

## What the tree actually spells

Comments in the sweep domain write a page-plus-section parenthetical two ways:

- `` (`spec/loop.md`, *The loop lock and the tip claim*) `` — **1,074** openings.
  Resolved: `SECTION_CITE` (`tests/helpers/commentCitations.ts:683`) matches the
  italicized half alone, and a title the page no longer carries reds the default
  lane.
- `(spec/loop.md, "The loop lock and the tip claim")` — **280** openings across
  **73** files. Resolved by nothing. The page's predicate does not admit it, so
  this is not "a class this predicate admits and the suite does not yet resolve";
  it is a class the tree uses and the predicate excludes.

Both spellings sit side by side inside single modules — `src/pidClaim.ts:11` cites
`spec/loop.md` quoted and `:24` cites `engineering.md` italicized, four lines
apart.

## Three of the unheld cites are already wrong

Read against their pages this tick, by the same heading-and-bolded-lead rule the
italic arm uses:

- `src/cliHelp.ts:416` and `src/cli.ts:774` cite `(spec/chain.md, "Chain.friction")`.
  The page's heading is `` ## `Chain.friction` — the declared friction channel ``
  (`spec/chain.md:307`). An abbreviation, which the italic arm refuses by
  construction — "no prefix arm, so an abbreviation is a rewrite, not a match".
- `tests/Dispatcher.test.ts:1977` cites
  `` (`.claude/rules/engineering.md`, "A fact the engine holds is reported") ``.
  The section is *A fact the engine holds is reported, never rediscovered*
  (`.claude/rules/engineering.md:120`).

So the unheld spelling is not merely unchecked — it has already drifted, in the
exact shape the section arm was added to stop.

## The fork

**(a) One spelling: rewrite the 280 to italics, and refuse the quoted form.**
The existing pin then holds every section cite in the tree, and the three above
red until repointed. Cost: a 73-file prose commit, and a scanner arm that reports
a `(page.md, "…")` parenthetical in a comment. Risk: a parenthetical joining two
cites with a semicolon (`src/tickVerdict.ts:706`) has to be split, since the
italic regex closes the parenthetical on the italicized half.

**(b) Widen the predicate: the page admits the quoted half too.**
One regex alternation in `commentCitations.ts`, no prose rewrite, and the three
stale cites red on the next run. Cost: a page edit — the citation-class paragraph
is the human's, and this is the sentence that decides which spellings the suite
may resolve. Two spellings stay live, which is the thing *A module is one job*
files against for helpers and vocabularies.

**(c) Neither — declare the quoted form as deliberately-unresolved prose.**
Only coherent if the quoted form means something different from the italic one.
Nothing on the tree suggests it does; the two are used interchangeably in one
file.

## What I would do, and why I am not doing it

(b), then (a) as a later tidy. The predicate is what makes a citation checkable,
and 280 unchecked cites is a hole the size of a fifth of the corpus; closing it
costs one alternation and catches the three drifted cites immediately, where (a)
pays a 73-file commit first and catches the same three. But the widening is an
edit to the page that governs this slice's own filing bar, and the pipeline
(`.claude/rules/spec-plan-build.md`) puts `.claude/rules/*.md` in the human's
lane. So: ruling wanted on which spelling the predicate admits, after which the
mechanical half files as an entry.
