# The registry's mangle was never quoting, and `-z` now needs a git floor

Measured on git 2.43: `worktree list --porcelain` prints a worktree path
raw — no C-quoting even for a newline, unlike `status --porcelain` v1,
which quotes (CLEAN-TREE-GATE-READS-QUOTED-PORCELAIN). So the two sibling
fixes share a remedy (`-z`) but not a cause, and the porcelain-quoting
platform fact does not generalize across subcommands. Candidate for
`.claude/rules/platform-facts.md` — build cannot write it.

`-z` for `worktree list` is git >= 2.36 (`status -z` is ancient). The
package declares `engines.node` only, no git floor anywhere, so the engine
now silently requires a git newer than it says. Either state the floor or
decide it does not matter — an entry or an open question, not mine.

Also fixed in passing: `registeredWorktrees` in tests/worktrees.test.ts —
the helper vacuity pins read git through — carried the identical
line-split mangle, so it would have agreed with the broken probe on
exactly the paths these cases exist to carry.

No other path-parsing porcelain reader left: `src/job.ts:290` reads
`status --porcelain` for emptiness only.
