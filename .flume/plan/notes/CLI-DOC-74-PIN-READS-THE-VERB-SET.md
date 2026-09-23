# The page's exit-code phrasing is what makes the verb-wide read decidable

The entry's premise held of the prose and not of the reader. `flume friction`
is the one `docs/CLI.md` section that stated its later codes under a single
leading "Exits" — "Exits `0` ...; `2` if ...; `69` ...; `74` (`EX_IOERR`) if
..." — and `namedExitCodes` (`tests/cliHelp.test.ts`) keys on a code carrying
its own introducing verb with no backtick between, so it read that section's
range as {0} alone. Generalizing the docs case off `topLevelCommandNames()`
went red on friction until the section repeated the verb per clause, which is
how the page's nine other sections already read. I took the prose alignment
over teaching the reader list continuation: the enumeration form is exactly
where a value (`--max`'s default 50) becomes indistinguishable from a code,
the hazard the reader's own doc comment names.

What that leaves unowned: the phrasing is now load-bearing for a pin looping
every advertised verb, and it lives nowhere but that reader's doc comment (I
pointed it there, at `NAMED_EXIT_CODE`). A future section written in
enumeration form reds the new case with "expected [ +0, 2 ] to include 74" and
nothing tells the author the fix is the verb, not the row. Two forks: teach the
reader the semicolon list under one leading verb (with the value-vs-code
discrimination that costs), or state the convention on the page that owes it.
The second is prose about a `docs/` page's house style, which the ladder
leaves with its authors — so it may be a human call rather than an entry.

Also folded: CLI-DOC-CHECK's standalone `check` docs case is subsumed by the
every-verb read, so its describe holds `status`'s cause list alone now and I
retitled it to say so. The tag stays for traceability.
