# Both defaults now have one home; spec/cli.md still holds a third copy

Shipped as filed. `DEFAULT_TICK_BUDGET` is now what `flume loop`'s `--max`
default reads (`src/cli.ts`), and `DEFAULT_LOG_VERDICTS` (new, `src/tickVerdict.ts`,
beside the `MAX_TICK_VERDICTS` bound on the same history) is what `flume log`'s
`-n` default reads. Both help pages interpolate. Rendered `--help` output is
byte-identical, so every existing help/docs pin stayed green.

Two things for plan.

**A third copy the fix cannot reach.** `spec/cli.md:25` states the loop cap as
"(default 50)" and `spec/cli.md:38` the log count as "(default 10)". A markdown
page cannot read a constant, and spec is the human's surface, so this is not a
build fix — but it is now the only copy of either number that no mechanism holds.
Bumping `DEFAULT_TICK_BUDGET` moves the verb and both pages together and leaves
the spec silently stale. `tests/docSections.test.ts` already reads `docs/` pages
against the interface they describe; a pin reading these two spec lines against
the constants would close it, if reading `spec/` from the suite is something the
posture allows. Flagging rather than deciding.

**The test file's job has widened.** Both pins landed in
`tests/docComments.test.ts`, as the entry predicted, beside the
`abortThreshold`/`killGraceMs` arms they copy — the `srcText` machinery and the
one-home-per-default shape are both already there. But a `--help` page is a
template literal, not a doc comment, so that file's header ("a doc comment on a
chain-facing option is the hover text every consumer reads") now disclaims part
of its body. The file's actual job reads as "prose in `src/` read against the
program", which the entry-module header pin and the `FAILURE_STAGES` comment scan
already stretched toward. Debt, not a blocker — but if a third non-comment pin
lands there it is the split `engineering.md`, *A module is one job* describes,
and the header names the target shape already.
