# Does an empty span consult how the agent process ended?

`spec/loop.md`'s no-commit taxonomy says two things that no longer read alike,
and a build tick had to pick one (`ad457058`).

**The row** (*The no-commit taxonomy*, `clean-exit`) folds the empty span in:
"the agent exited cleanly without a usable commit — none at all, **or a span
whose diff against its base is empty**".

**The bullet under the same table** says: "How the agent process ended is
consulted only when **the ref did not move**." An empty span moved the ref.

The tick followed the row. `classifyNoCommit` (`src/tickAttempt.ts:791`) is
reached for the empty span too, so an agent killed mid-run whose span happens
to be empty records `platform-preempt`, not `clean-exit`.

I read the two as agreeing in spirit — the bullet's own next three sentences
are about a *usable* commit being honoured, which is the case it exists to
state — but the sentence says "ref", not "usable commit", and that is a human's
word to change.

## The options

1. **Reword the bullet to key on a usable commit.** "…consulted only when the
   tick produced no usable commit." One clause; matches the row, the shipped
   classifier, and the bullet's own following sentences. No code change.
2. **Keep the bullet literal and change the code.** An empty span classifies
   `clean-exit` whatever the termination was. Cost: an agent the platform
   killed reports as its own clean exit whenever its span happens to be empty
   — the masquerade the `platform-preempt` row exists to prevent — and a chain
   reading `clean-exit` retries as if the agent had refused.
3. **Declare the silence deliberate** and add a sentence naming the empty span
   as the one case where both the ref and the termination are consulted.

**I would take (1).** It makes the row, the bullet and the classifier one
statement, and it is the only option that keeps a platform failure from
wearing a clean exit. (3) says the same thing in more words; (2) buys
literalism with the defect the taxonomy was built against.

**The ask:** does the bullet get reworded, and is (1)'s clause the wording you
want? If instead the shipped classification is the thing you disagree with,
say so — that is a pending entry, not a spec edit.
