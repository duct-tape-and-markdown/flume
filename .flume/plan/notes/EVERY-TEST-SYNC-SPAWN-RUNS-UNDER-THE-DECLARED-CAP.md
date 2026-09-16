# The cap scan's `stdio` read now covers all five capturing APIs

The entry's capture-free exemption (harnessCi's `gh --version` probe, an
`execFileSync` with `stdio: "ignore"`) could not be spelled as a sync-only
special case: node hands every capturing API the same `stdio`, and an
unpiped stream is one no `maxBuffer` bounds. So `pipesNothing` moved from
`spawnSync` alone to every call in `scanSpawnCaps`, and the `Family` type
("always" vs "stdio") is gone — one rule, no special case.

That is a behavior change to a landed scanner beyond this entry's tests/
domain: a shipped-tree `exec`/`execFileSync` with a non-piping `stdio`
literal is no longer owed a cap. Nothing in src/, harness/, bin/, examples/
or scripts/ spells one today, so the repo verdict is unchanged; the fixture
in tests/spawnCaps.test.ts carries a case for it either way.

Also: this repo's suite is not prettier-clean at base — every file I touched
differs from prettier's output on HEAD — so there is no format gate to lean
on, and added lines were hand-wrapped to 80.
