# The paren-less drain was larger than measured, and two sites named no heading at all

Measured on this tree, not estimated: widening `SECTION_CITE` drew **561**
spans the narrow arm passed over (1406 -> 1959 in `src/`, `harness/`,
`tests/`), of which **72 sites / 20 distinct claims** were stale. The entry's
354/50 is a narrower read; nothing changed between, so plan's re-measure
likely missed the comma-less arm.

The entry's "page-arm readers add nothing: measured red-free" did not hold:
`scripts/build-changelog.mjs:27` cited `CLAUDE.md` with an **elided** quote
("Build phase commits per pending entry ... after green validation"), which
is not a heading and never was — respelled to the section that holds the
bullet, *Non-Negotiables*. `spec/pending.md` "Selection is the sole site; a
singleton phase does not pick from pending" (`src/cli.ts`,
`tests/cli.test.ts`) is the same shape: a *sentence inside a bullet* of *The
fork-resolution seam*, cited as though it were a title. Two of twenty stale
claims were therefore never abbreviations — they were prose quoted as
headings, and no prefix arm would have caught them either.

The other eighteen are one family: a heading spelled `Lead — gloss`, cited
by its lead alone (*Tip verify*, *Placement*, *Graceful stop*, *Routing
rule*, *Windows MAX_PATH*). Authors reach for the lead; the page rules that
a rewrite. The family will keep recurring as comments are written, and the
arm now reds it at the next tick rather than at the next widening.

Respelling reflowed the tail of each comment paragraph it touched, so the
diff is larger than 72 lines; no prose was rewritten beyond the cited half.
