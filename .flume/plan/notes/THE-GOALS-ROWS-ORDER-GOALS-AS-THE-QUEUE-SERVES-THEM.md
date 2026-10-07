# The Goals rows landed; two observations

**A queue span now has one home.** `formatSpan` and `spanFrom` were private to
`src/queueFlow.ts`; the Goals rows measure the same kind of value, so both
moved to `src/queueSpan.ts` and the flow fold imports them. Any third row that
measures a span reads that door rather than re-spelling the floor arithmetic.

**`gateReadyEntries` runs twice per `flume status`.** Once directly, for the
flow row's waiting figure, and once inside `servedReadyEntries`
(`src/selection.ts`), which sorts it and applies `Chain.order`. One pure filter
over an in-memory array, so there is no second stored copy and no stale read —
but the flow row deliberately keeps the unordered set, so a hook that refuses
the queue withholds the Goals order alone and leaves the flow figures standing.
A door answering both the set and its served order would collapse the two
reads; it would also tie the flow row's fate to the chain's policy, which is
why this tick did not build it. Debt, not a defect.

**A product gap I did not fill.** `spec/cli.md` line 9 says a Goals row gives
"the goal's remaining `work` entries", and the row names every one of them, so
a goal with twenty work entries prints a twenty-tag line. No cap is specced and
I did not invent one — a cap is a choice between truncating (`... +15 more`),
counting (`20 work entries`), and naming them all. If an operator reading a
decomposed goal finds the line unusable, the fork belongs in `questions/`
rather than in a build tick's judgment.
