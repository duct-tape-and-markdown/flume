# Should a fresh-context review gate judge an entry's design before it merges?

From an interactive design review (2026-10-05, observed at `7538fb31`).
Nothing between build and trunk reads an entry's design. The checks before
merge are this repo's `tsc` (`.flume/declaration.ts`, `gates`) and the
harness judge, which proves `tests[]` red on base and green on the merged
tree. Design is read only after merge, by `plan-sweep`, and anything below
the correctness-adjacency bar becomes a debt line
(`.claude/rules/posture-sweep.md`, *Routing*). `docs/INTENT.md`, *Beyond
v0.1 — dependency-aware fanout*, already names "a reviewer phase that
bounces entries back to Pending"; no `spec/` section covers one, so plan
cannot cite it and this is a question rather than an entry.

**The proposal:** a gate in `harness/` (opinion, not engine:
`engine-boundary.md`) that spawns a fresh `claude -p`, never the build
session, to read the entry's diff against the posture pages the declaration
names. A finding reverts the commit. The existing `gate-revert` prior-attempt
record carries the gate's `message` and `details` to the next build tick
(`spec/loop.md`, *Prior-outcome feedback to the retrying tick*), so the
send-back needs no new mechanism. Red flags the posture pages lack (shallow
module, pass-through layer, temporal decomposition, overexposure) become new
sections on `.claude/rules/engineering.md`, never a second list.

**Verified on the tree, and it shapes the forks:**

- Quarantine will not bound this gate. It counts only byte-identical gate
  failures (`spec/loop.md`, *Repeated identical failures — quarantine, then
  abort*). An LLM reviewer rewords its findings every pass, so the streak
  never builds and an entry can bounce until the run ends.
- Only the latest attempt is kept: the prior-attempt store keeps one record
  per entry (`<flumeDir>/prior-attempts/<keyspace>/<slug>.json`). A cap on
  send-backs needs a count that nothing holds today.
- The engine counts tool calls (`src/budgetLine.ts`) and renders them
  (`src/terminalRender.ts`) but reports no list of files read on
  `AgentResult`. The proposal's guard against an empty review ("the reviewer
  read the diff's files") would have to parse the stream itself, which
  `engineering.md`, *A fact the engine holds is reported*, files against the
  engine.

## Forks

1. **`afterCommit` or `afterMerge`.** `afterCommit` reviews the entry's own
   diff in its worktree, and a revert never touches trunk. `afterMerge` is
   what INTENT wrote, and it sees the merged tree, but a revert there undoes
   a cherry-pick on trunk. `spec/chain.md`, *Gate placement is the chain's decision*, puts expensive
   gates at `afterMerge` to save host CPU; a reviewer's cost is tokens, not
   CPU, so that reasoning does not carry over.
2. **The send-back cap, and what happens when it is hit.** Where the count
   lives: a counter in the prior-attempt record (engine), or harness-owned
   state. At the cap, either the entry ships and the remaining findings
   become a debt note at `.flume/plan/notes/<TAG>.md`, or it parks for plan
   to re-scope.
3. **Every entry, or only surface-changing ones.** Every entry costs one
   review per entry, and that may change whether cheap-tier routing for
   build still pays. Surface-changing only needs a decidable "changed a
   surface" test; the export map the suite already resolves
   (`engineering.md`, *An export earns its consumer*) is the candidate.
4. **The read-coverage fact.** Either the engine reports the files an agent
   read on `AgentResult`, or the gate drops the coverage guard and trusts
   the reviewer's own report, which it should not.

**Proposed by the reviewing session:** (1) `afterCommit`; (2) cap at two
send-backs, then ship and file a debt note; (3) surface-changing entries
only, judged by the export map. (4) is new from triage, and the
reviewing session did not weigh in on it. My read: (4) goes to the engine,
because without it the gate's green can be vacuous (`engineering.md`, *A
green verdict is proven non-vacuous*).

Once the forks are ruled, the answer becomes a new section of
`spec/harness.md`, which plan can then cite. The sibling question
`should-entries-that-change-an-exported-surface-state-their-interface.md`
shares fork 3's surface test.
