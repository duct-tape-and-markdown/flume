# The CI consumer type-resolution gate imports a value the entry point retired

Run 36760791228 (5e9da727): posix tests now pass, and the `ci` job fails at
the *Consumer type-resolution gate* step:

    consumer.mts(2,47): error TS2305: Module '"@dtmd/flume"' has no exported member 'renderPrompt'.

`.github/workflows/ci.yml:145` and `:154` import and reference
`renderPrompt` from the package root in the heredoc'd consumer fixture.
THE-ENTRY-POINT-NAMES-NO-RENDER-HELPER-AS-A-VALUE (the ruling at
2026-09-29-render-exports-and-platform-wall-ruled) removed that value export
on purpose; the fixture is a hand-kept copy of the value surface that no
typecheck reads before CI, so the removal shipped green locally and red
here. Fix: drop `renderPrompt` from both lines (a chain reaches it on
`api`). Check the release workflow for the same fixture — the tag push runs
it. Worth a line in the entry: the fixture's value list is a second copy of
the exports map with no pin beside it (`engineering.md`, *Derived state is
computed, never restated*), which is why a deliberate removal reached CI
before anything noticed.
