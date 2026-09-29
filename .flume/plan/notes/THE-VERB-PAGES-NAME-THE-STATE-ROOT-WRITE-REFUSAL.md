# A default-lane hold with a 10s ceiling reds on load a sibling suite adds

Shipped as written: the write refusal labelled beside the three resolution
causes and rendered into the `74` row of the seven verbs that reach a write
under the root, `log`/`check`/`friction` on the narrower clause, `docs/CLI.md`
per verb, scope driven.

The finding is the revert that preceded it. The prior attempt (7be3408d) was
reverted at `afterMerge` by `tests/Dispatcher.test.ts` × "the merge stage
writes a merging marker naming the branch, the base sha and the entry before
the pick" — a test the attempt touched nothing in. That case holds MARK-C's
agent on `waitFor` for MARK-B's merge window, ceiling `WAIT_TIMEOUT_MS` =
10_000 (`tests/helpers/waitFor.ts`), while the default lane runs four workers.
The attempt's seam `beforeAll` spent ~9s in 20 CLI spawns, two of them
(`tick`, `loop --max 1` over an undenied fixture) starting further node+tsx
processes. The reported failure was the three-entry
`committed`/`noCommit` deep-equal — what a blown hold looks like: an agent
threw out of its wait instead of committing. Nothing cliHelp renders reaches
that assertion.

So a green in that file depends on an event arriving inside 10s under whatever
else the lane is running — and the lane is the one every merge pays
(`vitest.config.ts`). The seam here was rebuilt to one denied pass (10 spawns,
~4.5s, no agent, no child process), which is cheaper than the claim's previous
shape and no weaker: the denial stands before the first verb runs, so ordering
cannot matter, and the verbs answering `0` under it are the liveness witness
the second pass used to be.

That trims the load; it does not fix the sensitivity. Whoever owns
`tests/Dispatcher.test.ts` decides whether that hold belongs in a lane a wave
multiplies, or whether the ceiling should key on progress rather than wall
clock. Worth filing: the next suite to add spawns reds it again, and the
entry that pays is whichever is in the wave.
