# The seam directive sits at prose, and a decidable rung exists

Shipped as a bolded lead in `harness/prompts/plan-discipline.md`, the `files`
prediction section. Two observations for the next plan tick.

**The rung above prose is reachable.** "Two entries whose `per.path` and
`per.section` agree either intersect in `files` or one names the other in
`blockedBy`" is decidable over the queue alone — the shape `pendingGate`
already reads. Filing it would move this directive off the prompt, where it
only governs a slice that happens to read the page, onto the gate that
refuses the pair. It is harness policy, not engine mechanism (a chain that
wants siblings racing may want them racing), so it belongs in the harness
gate list, not `src/`. Not filed here: a gate that refuses a plan
commit carries a false-positive cost — a legitimately decoupled pair cut from
one long section — that wants a ruling first.

**`spec/pending.md`, *`files` is a prediction, not a permission*, prices
under-declaring low.** "Costs at most a cherry-pick conflict, which the
dispatcher aborts and leaves pending for a retry" is true of the ledger and
silent about the agent: the aborted commit's span is discarded and re-earned
at full agent price on the retry. Both measured cases on 2026-09-24 were
under-declarations, and the cost that made them worth an entry is the one the
sentence omits. The prompt paragraph now states it; the spec sentence still
reads as cheap, and it is the sentence a derive tick reasons from. A human
edit, not plan's.

No test or pin: no suite reads `harness/prompts/*.md` for what it says, so a
page name or section cite written into a prompt resolves against nothing. The
paragraph therefore states the partition's behavior plainly rather than citing
a spec page a consumer of the harness package would not have.
