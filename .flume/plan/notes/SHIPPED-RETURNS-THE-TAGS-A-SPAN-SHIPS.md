# The package ships a step no session was shown

`harness/chain.ts`'s `shipped` is all-or-nothing over the span, so a finishing
build commit now retires the work entry *and every step under it* — but no
prompt the package ships renders those steps. A session finishes the entry and
the steps leave the queue behind its back, with no window naming what they
were. Plan's call: name the steps in the build window, or give the session a
way to say which it finished (the questions directory already holds the
second half of that).

**The orphan guard sits at the consult, not the ledger.** The rewrite retires
exactly the tags it is handed, deliberately — the group entry's own pending
case pins a partial ship leaving a step behind. So
`unshippableTags` (`src/waveMerge.ts`) refuses a list naming the work entry
without every step, like a throw. One hole stays: `ShipContext.steps` is read
when the slot pulls the entry, and the ledger re-reads the queue fresh — a
step filed under a claimed work entry *mid-wave* is in neither the consult's
set nor the refusal, so it is left with its parent gone and the next strict
queue read refuses, naming the file. Loud, but a hand repair. Closing it means
either the ledger closing the removal set downward (which would red that
pinned case) or plan never filing under a claimed entry.

**Spec gap:** `spec/chain.md`, *What a hook receives* lists `ShipContext` as
"entry, merged sha, touched paths, gate results, worktree path, baseSha" — it
does not name `steps`. `spec/pending.md` does. Human's to reconcile.

**Debt, not a defect:** now that a work entry leaves with its steps on every
arm the engine composes, `groupsRetiredBy`'s subtree walk and a children-read
agree on every queue a strict read admits. The walk's motivating case is only
reachable through a list the consult now refuses. Not worth a change; worth
knowing before someone "simplifies" it.
