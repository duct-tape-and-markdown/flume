# A job is a fence wearing a declaration; the declaration names its jobs (a consumer bay's full chain audit, 947 lines measured, relayed by the operator)

Measured across the bay: eleven branches carry job declarations, ten carry
one; the seven-job worktree ran its jobs one at a time (445 ticks, 12
switches) under near-identical declarations, and the only field that varied
inside one checkout was `writablePaths`. Their 167-line per-job schema,
reader and `--job` threading is the price of one field. What varies per
effort (gates, agents, setup) varies per checkout, where a fresh declaration
resolves for free.

Ruled at `spec/harness.md` *What a consumer declares*, replacing this
morning's "hand the factory a computed declaration per job", which was the
consumer's own loader re-prescribed: the declaration names its `jobs`,
each a spec locus and a fence over the shared declaration, applied by the
factory under that job's state root; `flume job new` seeds from the
package's skeleton, the factory declaring `seedDir`. The engine's job
partition is the mechanism; the harness is its opinion. `flume job`
stays the parallel-efforts partition the bay never needed.
