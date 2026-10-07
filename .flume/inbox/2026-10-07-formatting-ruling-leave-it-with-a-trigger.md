# Ruling: no formatter gate now; a touched-files prettier check if the family returns

Answers `should-formatting-be-a-gate-rather-than-a-sweep-lens.md` (operator,
interactive session, 2026-10-07): arm **(a)**, leave it. The family it would
retire has no live site on disk, and the tree-wide reformat it costs moves
~22.5k lines, almost all of `tests/`.

The next step is named so it is not re-debated: if the indentation family is
re-noted in three plan commit bodies again, file a declared shell gate that
runs `prettier --check` over the gated commit's touched paths only
(`FLUME_TOUCHED_PATHS`), with a prettier config in build's fence. New code
lands formatted and old code converges as it is touched, with no tree-wide
reformat. Nothing to file now.
