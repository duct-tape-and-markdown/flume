# The floor read has a third arm spec names no verdict for

`spec/chain.md`, *The package a chain loads through*, states two arms: below
the floor warn, at or above say nothing. A `git --version` that cannot be read
— no git on PATH, a wrapper answering in its own words — is neither.
`gitFloorWarning` (`src/cli.ts`) warns there too, calling the floor
*unconfirmed* rather than met: reading silence as "at or above" is the one
silent degrade this entry closes (`engineering.md`, *Loud or nothing*). Held
by "a git whose version cannot be read warns that the floor is unconfirmed".
If spec wants that arm quiet, it needs a sentence.

The CLI cases are POSIX-only (ledger reasons in
`tests/helpers/host-declarations.json`): they plant a `git` on PATH, and
`src/git.ts` spawns git through `execFile` with no shell, which on win32
cannot reach a `.cmd`. The decode itself is held on every host by
`tests/git.test.ts`.
