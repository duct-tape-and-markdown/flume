# What bounds an entry whose render refuses identically every wave?

`harness/standingRefusal.ts` shipped at f266b877 with `RESOLVED_BY_A_PRODUCER`
answering `false` for `render-refused`, and said so out loud: the enumeration
in `spec/harness.md`, *The default `handoff`* names three refusals — "a clean
exit, a park, a merge the queue must answer" — and walling a fourth there
would be the package minting a member of a set the spec states. That read is
right. But the plan-side table it replaced was walling `render-refused`, and
the argument it walled on has not been answered by anything else.

## The livelock, verified on this tree

- `persistRenderRefused` / `persistHookRefusal` (`src/tickAttempt.ts:845`,
  `:870`) write the record **per attempt ref** — per entry in a wave.
- `defaultRefusesEntry` (`harness/handoff.ts:210`) now returns `false` for it,
  so the next wave picks the entry again.
- The consecutive-identical-failure backstop does not reach it:
  `FAILURE_STAGES` (`src/loopSupervisor.ts:238`) is `provision | merge | gate`,
  and the streak fold (`:795`) reads only those three.
- So an entry whose prompt refuses deterministically — an inline-exec span
  against a missing binary, a `promptArgs` hook throwing on the entry's own
  shape — is re-picked every wave to `--max` with nothing that stops it.

**One correction to the note that raised this:** the cost is not "full agent
price". No agent is invoked (`spec/loop.md`, *Prior-outcome feedback*: "either
way the agent was never invoked"). The lap costs a worktree create plus the
declared `setupWorktree` restore, per entry, per wave — real, but an order
under an agent span. It also costs a slot the wave could have given a pickable
sibling.

## Three forks

**(a) State the wall where the enumeration is** — a sentence in *The default
`handoff`* adding `render-refused` to the refusals a producer resolves.
Cheapest; restores the old behavior with an owner. Against it: often there is
nothing a producer can do. A span failing because the host lacks a binary is
not the entry's defect, and holding the entry for the drain parks it on a
phase that can only drop or re-scope it — the drain would be answering a host,
not a declaration. It also inverts the mode's own reading: `render-refused`
is the one mode where *no agent read the entry*, so "re-dispatching buys the
same decision" is not the argument that holds for `clean-exit`.

**(b) The engine stops re-rendering a span that failed identically at the same
declaration.** A new engine memo, keyed the way the quarantine already keys
(slug + declared hash). Against it: a second accounting beside the one
`spec/loop.md`, *Repeated identical failures — quarantine, then abort*
already specifies, for the same shape.

**(c) Render joins the existing accounting as a fourth stage.** My
recommendation, with one real cost named below. The cited section's own
premise sentence already reaches it — "The accounting therefore covers **every
per-entry failure fact the verdict records**, keyed by stage-tagged signature"
— and only its bulleted enumeration stops at three. The exclusion the section
does spell is narrow and does not cover this: "A clean exit or park never
joins the accounting — an agent that committed nothing is not evidence
anything went wrong." A render that refused *is* evidence something went
wrong; the section even ranks it that way one page up (`spec/loop.md`, *The
no-commit taxonomy*: "a render refusal is a real defect in the prompt/config").
Under (c) an environmental refusal quarantines the entry for the run and
aborts at `abortThreshold`, with `quarantineScope` and `abortThreshold`
already the chain-overridable knobs — and no new member in the handoff's
enumeration, which is what f266b877 was right to decline.

**The cost (c) carries, measured here:** the premise sentence is not true of
render today. `TickVerdict` carries `provisionFailures`, `mergeFailures` and
`mergeOutcomes` per entry, and `noCommit` **tick-level only**
(`src/tickVerdict.ts:624`-`:659`) — there is no per-entry render fact on the
verdict for the supervisor to fold. So (c) is two changes: the verdict gains a
per-entry render-refusal fact, then the stage roster gains its fourth member.
That second half is `contractTouching` — `FLUME_QUARANTINED_SLUGS` crosses to
every child, and `FailureStage` is a shape the resident supervisor and a fresh
tick child share.

## What I need

A ruling on the fork, and — if (c) — whether *Repeated identical failures —
quarantine, then abort* should lift its stage enumeration to match its own
premise sentence, or whether the premise sentence is the one that should
narrow to the three stages it lists. The two read opposite ways today, and
that disagreement is what let this hole open without anyone deciding it.
