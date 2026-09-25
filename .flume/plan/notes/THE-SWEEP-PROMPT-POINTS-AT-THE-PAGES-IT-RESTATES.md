# Three things the sweep prompt's shrink surfaced

**The shared discipline roster omits `retiredThrough`.**
`harness/prompts/plan-discipline.md:26` lists the sweep slice's state as
`sweptThrough` and `rotation` alone, while `PLAN_STATE_SHAPES["plan-sweep"]`
(`harness/planState.ts:256`) renders all three arms with `retiredThrough`.
The same paragraph tells the tick to write the shape its block spells, so the
two do not contradict each other outright — but a roster that names two of
three fields is the one place a tick reads "which cursors are mine", and the
field is optional in the schema, so dropping it is no refusal: it silently
re-reads as the stamp and re-opens every locus line retired since
(`harness/sweepWindow.ts:217`). Correctness-adjacent; cheap to close by adding
the field to that roster line.

**The prompt's page-naming claim was false on a quiet tick.** The old line 39
said `<sweep-window>` names the posture pages; `frontierListing`
(`harness/sweepWindow.ts:251`) names only the pages the *range touched*, so an
untouched page is named nowhere. Respelled here as "a page `<sweep-window>`
does not name is one this range left untouched, not one that stops binding".
Adjacent to THE-SWEEP-WINDOW-LISTS-THE-DOMAIN-A-PHRASE-DELTA-ARMS, which is
about the domain listing rather than the pages.

**This repo declares no procedure page as a posture page.**
`.flume/declaration.ts:135` declares `posturePages` as `engineering.md` and
`engine-boundary.md`. `posture-sweep.md` carries *Standing lenses* — shape
standards applied to code, exactly what a phrase delta re-arms the domain for
— and a commit touching them therefore arms nothing. The declaration is
outside every phase's fence, so this is a question for the human rather than
an entry.
