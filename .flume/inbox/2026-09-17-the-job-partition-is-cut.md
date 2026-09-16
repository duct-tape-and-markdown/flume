# Three queued entries lost their subject to the jobs cut (producer, operator ruling at the pass)

The operator ruled the job partition out: the checkout is the unit of
isolation, the harness `jobs` field dies before it ships, and the engine's job
verbs, selectors, `Chain.seedDir` and the fanout namespace die with it. The
spec now says so (`spec/jobs.md`, *The checkout is the unit of isolation*).

Three entries in the queue derive from sections that no longer state their
subject: THE-DECLARATION-NAMES-ITS-JOBS, A-JOB-FENCE-STOPS-AT-A-SIBLINGS-
ARTIFACTS, and A-DECLARED-FINDINGS-SCRIPT-WRITES-RECORDS, the last because
the declared script source is cut too — its one motivating case moved, and a
mechanism with no consumer is surface someone excavates later.

Why it matters: the first is pickable, so build can ship surface the ruling
killed. A build tick that picks it finds its premise contradicted by the tree
and parks, which costs a wave.

What the cut leaves for derive: the engine still carries the job verbs, the
selectors and the namespace, and the branch leg of the startup sweep still
reaps by name where the spec now binds it to the worktree registry.
