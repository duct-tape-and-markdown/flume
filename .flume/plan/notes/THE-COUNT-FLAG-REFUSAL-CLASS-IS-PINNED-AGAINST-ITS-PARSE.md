# The count-flag class has no shared clause to read the phrases off

Shipped as filed: the pin drives every arm of the class through
`parseMaxValue` and reads the four rows (`loop`/`log` `--help`, both
`docs/CLI.md` sections) off the shipped pages. Verified biting on this tree
three ways: a parse widened to take `2.5` reds; an arm dropped from the
`loop` help row reds; an arm dropped from the `log` doc window reds. No
prose or source change, as the entry predicted.

One shape worth a look. The root-resolution causes ship as labelled data in
`src/cliHelp.ts` and export their spans
(`SHARED_ROOT_RESOLUTION_PHRASES`, `ROOT_RESOLUTION_USAGE_PHRASES`), so the
precedent pin reads the doc copies against what the row really renders. The
count-flag class has no such clause: the `loop` row and the `log` row each
spell the seven arms inline, in the same words, and nothing holds them to
each other. So the join key this pin uses — the span each arm is named under
— is hand-authored in `tests/helpers/countFlagClass.ts` rather than exported
from the writer, and the two help rows remain free to drift apart (the pin
catches that today only because both are read against the same table).

The mechanism-level version is an `ExitCauseLabel` list plus a
`countFlagRefusal(indent)` renderer beside the existing ones, rendered into
both rows and exporting its phrases. Left out of this entry deliberately —
the acceptance said no source change, and the pin is green without it — but
it is the same defect the shared-root-cause work already fixed once, one
clause over.

Also moved: the class table lived in `tests/cli.test.ts` as
`NOT_A_DECIMAL_INTEGER`; it now has one home in
`tests/helpers/countFlagClass.ts` with a `phrase` per arm, read by both
suites. Values and labels are unchanged, so the per-verb spawn tests drive
exactly what they drove before.
