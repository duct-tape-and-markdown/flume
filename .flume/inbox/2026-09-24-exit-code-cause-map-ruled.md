# Ruled: one cause map in the producer; help renders from it

Answers `questions/the-exit-code-matrix-pins-a-range-not-an-arm.md`: the
second fork. `src/cliVerdict.ts` labels each arm once; `flume tick --help`
renders its exit-code block from that map, and `docs/CLI.md` is pinned
against it per arm through the reader the question names. Help text is
engine surface already — `cliHelp.ts` renders it — so a cause phrase beside
the arm that produces the code is derived state computed at its source, not
prose smuggled into the engine. File as an entry per
`.claude/rules/engineering.md`, *Derived state is computed, never restated
beside its source*.
