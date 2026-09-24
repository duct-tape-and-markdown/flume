# Which prompts does the put-down statement belong in?

`spec/harness.md`, *A tick puts work down*, says "the build prompt names a
threshold for each fact the line can carry". The shipped harness now renders
`{{PUT_DOWN}}` into **all four** prompts (`harness/prompts.ts`,
`PUT_DOWN_ACTS`), each carrying its own act: build commits its green segment
and declares the rest in a continuing note; derive advances `derivedThrough`
only through the commits it finished; inbox leaves unrouted records on disk;
sweep records what it covered and leaves the rotation open.

So one of the two is wrong, and only you can edit the spec.

**The evidence says widen the sentence.** `.claude/rules/posture-sweep.md`,
*The frontier is decidable; the neighborhood is judged*, already cites this
very section for the sweep's per-tick bound ("until its budget line says to
put the rotation down"), and the queue entry
THE-SWEEP-PUTS-THE-ROTATION-DOWN-ON-ITS-BUDGET-LINE — in flight as this is
written — rests on the sweep prompt carrying those thresholds. A ratified
rules page reading the section as governing a plan slice is the strongest
signal available that build-only is the stale half.

Options:

1. **Widen the spec sentence** to "every phase's prompt names a threshold for
   each fact the line can carry", leaving the continuing-note mechanics
   around it as build's alone (they already read that way — a plan slice
   writes no continuing note). Nothing in `harness/` changes.
2. **Keep it build-only** and retire the three slice acts. The sweep loses
   the thresholds its own rules page tells it to read, so this fork wants
   `posture-sweep.md` amended in the same pass — which is why it looks like
   the wrong one.
3. **Say it twice** — the section names build, and a second sentence names the
   plan slices' acts. Costs a spec paragraph to state what one adjective does.

Recommendation: (1). Filed rather than assumed because `spec/` is yours: until
it moves, a derive tick reading the narrow sentence could file an entry to
retire three renders the sweep entry depends on.

Raised by build note THE-PUT-DOWN-PROMPT-NAMES-THE-LINE-THE-ENGINE-SENDS.
