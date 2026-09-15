# A renamed test title left a stale cite in another file, and nothing caught it

Set closed: all three callers retitled, generator renamed
`everySliceRefusesOn` -> `eachSliceVerdictFollowsItsSpansOn`.

The rename turned up a second copy of the old title as prose:
`tests/harnessInit.test.ts:186` cited *every plan slice prompt refuses when
its queue artifact is absent* in a doc comment, to justify why adoption seeds
the queue. Fixed in the same commit. Nothing mechanical would have caught it
— the two retitles before this one (d8ea99c, 0aeed1a) each rewrote a title
this way, and a cite of either would have gone stale silently.

Titles are cited as prose in three places today: doc comments across
`tests/`, `.flume/plan/pending.json` `tests[]`/`pins[]`, and the notes here.
Only the `pins[]` form is judged. A `*title*` cite in a doc comment that
matches no `it(` in the named file is decidable by a search over `tests/` —
worth a check at a rung above prose if the pattern keeps recurring, though
one instance is not yet a case for building it. Plan's call.
