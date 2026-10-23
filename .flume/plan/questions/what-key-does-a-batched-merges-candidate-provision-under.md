# What key does a batched merge's candidate provision under?

`spec/worktrees.md`, *`setupWorktree` and `teardownWorktree` — the chain's
provisioning hooks* now carries the candidate as the third tree the hooks run
over, "under the key the span's own worktree carried". A batch has no one span:
its N spans share one candidate (*Batched merges*), so there is no single key to
carry, and the section's own definition of `worktreeKey` — "the entry tag under
fanout and the phase name for a singleton" — has no row for this tree.

The engine decided it already: a batch's candidate provisions under the **phase
name**, because no one entry of it names that tree any more than the gate
context over it does (`batchGateContext`). `docs/CHAIN-AUTHORING.md` states that
for chain authors. So the corpus is the only surface that does not say it, and
the new bullet read literally says something else — a chain whose hook keys a
per-entry resource off `worktreeKey` is told it will get a tag and gets a phase
name, which under the same section's definition reads as a singleton's key.

- **Option A — state the engine's choice.** The bullet names the span's key for
  a serial carry and the phase name for a batch, pointing at *Batched merges*.
  One sentence; nothing in `src/` moves.
- **Option B — the key is wrong for a batch.** If a fanout phase's hook must be
  able to tell "a batch candidate" from "my own singleton tick", the key wants a
  spelling of its own, and that is an engine change (the keyspace is already
  split for claims — `spec/chain.md` has `phase:<phase name>` for singletons).

**Recommendation: A.** The engine's reasoning holds — a tree holding N entries
is none of them — and a hook that needs per-entry work has the build worktree,
which is keyed. B buys a distinction no observed hook asks for, and prices it in
a keyspace change.

Source: plan-derive, deriving ad5687da.
