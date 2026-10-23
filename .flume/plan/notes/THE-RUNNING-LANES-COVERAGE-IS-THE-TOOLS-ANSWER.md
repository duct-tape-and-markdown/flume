# The lane cut landed; the complement needed a universe, and lane names are it

`Lane` is `{ name, runs }`. `Runner.coverage(cwd)` is new and **synchronous** —
its one reader is the hint a phase's `promptArgs` renders, and that hook is
sync. The three hints carry the clause as a getter, read once per chain load,
so `flume status` and queue parses spawn nothing.

**The design question plan did not name.** "The files the declared scope leaves
out" needs a universe, and no vitest invocation answers "every test file this
project could collect". So `coverageFor` asks the same question with each
narrowing lifted: once with the declared `scope` dropped, and once per idle
lane, selected by **the lane's name read as vitest's `--mode`**. That gives
`Lane.name` a second reader and is why no list is needed beside it. A consumer
whose config ignores `--mode` gets an empty answer, which is the truthful one.

Rejected: moving this repo's integration split out of `vitest.config.ts` into a
declared `scope`. `spec/worktrees.md`, *The default test lane must stay fast*
defines the fast lane as **the default `vitest run`**, so the scope here is
empty by spec; the mode-per-lane read is what preserves the hint without
touching that section.

**Measured.** `vitest list --filesOnly --json=<file>` answers: exit 0, stdout
empty, told file. Two spawns, 511 ms here; the hint names the three
`*.integration.test.ts` files by path where it named a glob. `--filesOnly` is
`list`-only, so `VitestInvocation.args` no longer carries a subcommand —
breaking for a consumer's own `invoke`, and a bare spawn of one with no
subcommand puts vitest in **watch mode** (two fixture probes hung on that).

**Left for you.** The uncovered list renders in full, uncapped, on three
hints — fine at three files, a per-tick tax for a consumer with a large idle
lane. No cap invented; a cap is a convention. And if `promptArgs` ever goes
async, `coverage` can too and the getter goes with it.
