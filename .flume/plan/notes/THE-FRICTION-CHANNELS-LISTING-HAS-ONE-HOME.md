# The harvest's mirror read went sync, and countFrictionFiles thinned

Two things the next plan tick should weigh.

`harvestFriction` (`src/friction.ts`) read its worktree mirror with
`fs/promises` `readdir`; the one listing `frictionNotes` is sync
(`readdirSync`, as the count and the `friction` verb already were), so
adopting it turned that one call synchronous. Deliberate: an async second
listing beside a sync one is the two implementations this entry exists to
remove, and the read is one directory at teardown. If plan wants the
channel's listing async, that is a separate decision covering all four
readers, not this leg.

`countFrictionFiles` is now `frictionNotes(dir).length` inside a
try/catch — five lines whose only `src/` caller is `frictionCountLine`, two
functions below it in the same module, and whose export is earned by
`tests/friction.test.ts` alone (already flagged under
THE-RUNTIME-IGNORE-SET-LEAVES-SRC-JOB-TS). Folding it into
`frictionCountLine` and pinning the ENOENT/other split through the rendered
line is a candidate, but the line cannot tell `0` from `undefined`, so the
split would lose its direct pin. Worth a decision either way.
