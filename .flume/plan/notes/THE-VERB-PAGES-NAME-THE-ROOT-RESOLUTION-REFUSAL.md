# docs/CLI.md's `flume render` section hides 65 and 69 from every range reader

Same family as this entry, found while widening the exit-2 rows.

`namedExitCodes` (`tests/helpers/docSections.ts`) keys on the page's own
stated convention — one introducing verb per code, in the same clause
(`docs/CLI.md`, *Reading the exit codes*). Read that way, the ten verb
sections name:

    status [0,2,74]  tick [0,1,2,69,74,78]  loop [0,1,2,69,74,78]
    wake/sleep/stop/log [0,2,74]  check [0,2,65,69,74]
    render [0,2,74]  friction [0,2,69,74]

`render` returns 65 and 69 — its own `--help` block lists both, and
`src/cli.ts` reaches both — but the section states each trailing a sibling
under one leading "Exits", separated by semicolons, so no reader on this
page sees them. Before this commit `2` was
hidden there the same way; the sentence this entry added gave it its own
verb, which is why `render` now reads [0,2,74] rather than [0,74].

That is a page stating a narrower range than its own process returns — the
defect this entry's `per` cite is about — for two more codes, on one verb.
The fix is prose-only (give each code its own introducing verb) plus the
pin that would have caught it: `render` has no driven range pin, while
`tick`, `loop`, `status` and `log` each have one
(CLI-DOC-TICK-EXIT-CODES-PINNED, CLI-DOC-LOOP-EXIT-CODES-PINNED,
CLI-DOC-STATUS-LOG-EXIT-CODES-PINNED). A `render` pin is cheap: every arm
of its range is reachable without an agent (a bad `--entry`, a chain that
will not load, an inline-exec span that exits non-zero).

`check` and `friction` are worth the same read — both list several codes in
one semicolon run, and both happen to carry their own verbs today with
nothing holding them there.

Also: this entry's `notes` named `SHARED_ROOT_CAUSES` at `src/cliHelp.ts:43`;
the tree spells it `SHARED_ROOT_RESOLUTION_CAUSES`, with `ROOT_WRITE_REFUSAL`
beside it.
