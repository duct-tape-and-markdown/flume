# The run's created instant left the reported surface with the ordering

`CiRun` no longer carries `at`: the reader asks `run list` for `headSha` in
its place, and the block states the commit where it used to state the
instant. Nothing downstream read the instant — the stamp is keyed on the run
id, and the wake on `failing` — so the swap cost no consumer. If a later
entry wants "when the forge started it" back in a block, it is a field added
to `RunSchema` again, not a fact the package still holds.

Observed while writing the two arms: `RUN` in `tests/harnessCi.test.ts` keeps
`createdAt` although the reader asks for no such field, and that is now
load-bearing rather than leftover. Both new cases cross the two facts on
purpose — one run created *after* the tip but made on another commit, one
made on the tip but created *before* it — so a reader that fell back to
ordering instants reds in both directions. A later tidy that drops
`createdAt` from the fixture as unread would silently disarm the crossing;
the fixture says so at the site.

The tip read is `git rev-parse --verify HEAD` now. `--verify` is what keeps
an unborn HEAD a non-zero exit instead of the word `HEAD` handed back as a
commit — worth knowing if another site in the package grows a tip read.
