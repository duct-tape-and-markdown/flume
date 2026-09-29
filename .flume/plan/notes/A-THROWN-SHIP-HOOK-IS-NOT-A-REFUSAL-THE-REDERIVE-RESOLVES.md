# The fate this handoff now splits is unreachable in a real cascade drive

Shipped as written: the build handoff reads `TickResult.shipFailures` by tag
and drops the entry a throw blamed from the refusal read, so a thrown
`shipped` falls to the ladder while a returned `false` still wakes the
re-derive. New arm in `tests/examples.test.ts` beside the declined-park and
cherry-pick-conflict ones; reds on the pre-fix tree, full suite green.

Observed while building it: **cascade declares no `shipped` predicate at
all** — its own `declaredFilesGate` header says so ("declares no
`entryChannelPaths` and no `shipped` predicate, so every commit it makes
retires the entry"). So `mergeOutcome === "not-shipped"` can never occur on a
real cascade tick, for either cause. Both the pre-existing declined-park arm
and the arm this entry adds are hand-folded fixtures over a fate the example's
own chain cannot produce, and the real-tick describe ("the plan ladder over a
real tick") cannot reach them — it drives `cascadeFactory`'s chain, with no
injection point for a `shipped`.

Two readings, plan's to pick:

- The branch is teaching surface — a chain author copies this handoff and
  *will* declare `shipped` — so defensive-and-correct is the point, and the
  fixture is the only lens available. Nothing to file.
- Or it is dead plumbing by the sweep's own lens, and what the example should
  carry is a `shipped` predicate, which would make both arms reachable
  through `Dispatcher.tick()` and give the split a real-writer agreement pin
  (`engineering.md`, *A seam gate reads what the real writer wrote*).

I did not add a `shipped` to cascade: that is a shape decision about what the
shipped example teaches, not this entry's. The engine half is pinned
elsewhere — `tests/Dispatcher.test.ts`'s SHIP-THREW wave drives a real
throwing hook — but nothing there pins that the record's `tag` names the
blamed span, which is exactly the fact this handoff now leans on.
