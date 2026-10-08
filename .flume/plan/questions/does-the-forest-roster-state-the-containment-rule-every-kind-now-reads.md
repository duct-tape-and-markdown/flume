# Does *The queue is a forest* state the containment rule, now that it reads every kind?

Build note from `THE-CONTAINMENT-REFUSAL-READS-EVERY-KIND` (2026-10-07). The
note raised it itself and declined to act — `spec/` is the human's — so it comes
here rather than to the queue. Nothing is unprotected: the rule is held by the
parse and pinned per kind, so this is about what the corpus states, not about a
missing check.

## What the two surfaces say, measured on this tip

`spec/pending.md`, *The queue is a forest* carries a seven-bullet roster closed
by "A queue breaking any of these is refused like any malformed queue". One
bullet is the blocker rule it states: "A step's `blockedBy` names only steps of
the same `work` entry; a dependency reaching outside it is declared on the
`work` entry."

The containment rule — no entry's `blockedBy` reaches into its own containment —
has **no sentence anywhere in the spec corpus**. Its whole statement is
`CONTAINMENT_BLOCKED_BY_SCOPE` / `_WHY` and the doc comment above them
(`src/PendingSchema.ts`), which derive the rule from two spec facts that are
each stated elsewhere: a descendant inherits the gates above it
(*Pickability*) and a `group` leaves the queue in the ledger commit that ships
its last descendant (*The queue is a forest*, last bullet). The engine renders
the sentence into every producer prompt beside the step scope, and
`tests/PendingSchema.test.ts` pins both the per-kind refusals and the rendered
schema's wording.

Until `a16d8860` the refusal was guarded on `kind === "work"`, so it read as a
work-entry rule and the roster's silence was defensible. It now reads every
kind, which makes it a forest rule of the same standing as the bullet above —
and the roster that ends "breaking any of these" is the surface a derive tick
reads as the forest's complete refusal set.

## The fork

1. **The roster gains the bullet.** Matches how the step scope is already
   carried — a spec bullet plus `STEP_BLOCKED_BY_SCOPE` for the prompt — so the
   shape is the one already on disk, and the two blocker rules read side by
   side where an author looks for them. Costs a second home for a sentence the
   engine already owns, with no gate reading one against the other.
2. **The roster points at the rendered schema for both scopes**, keeping one
   statement of each blocker rule and letting the section say only that the
   queue read refuses a blocker that can never resolve. One home, and
   `spec-writing.md`, *The spec does not restate a sibling* leans this way —
   though it is scoped to *values* an artifact owns, and this is behavior,
   which is the spec's own subject (*A claim names behavior, never location*).
   Costs an edit to the step-scope bullet, which reads fine today.
3. **Leave it.** The rule is derivable from *Pickability* plus the group bullet,
   and both are on the page. Costs the roster's own claim: a reader who takes
   "breaking any of these" as the set has the wrong set, and derive reads that
   roster as current truth.

The lean is (1): the asymmetry is the thing that misleads, and the page already
pays this exact cost for the step scope, so (2) is a shape change to one rule's
neighbour rather than to the corpus's habit.

## One thing a bullet would have to settle

Where the two scopes overlap — a `step` blocked on its own `work` entry, which
is inside its containment *and* outside its blocker scope — the refusal names
containment first, and the site states why: the step scope's escape ("declared
on the `work` entry") is wrong advice for an edge that can be declared nowhere.
A bullet under option (1) or (2) wants that precedence in it, or the page states
two rules a queue can break at once and says nothing about which it is told.
