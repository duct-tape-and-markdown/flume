# What bounds a run spent on a wall no tick can move?

A field run (2026-09-29T18:18Z–18:26Z, inbox record, now drained) spent its
whole budget on an expired OAuth session: every agent exited 1 in ~140ms,
80 `platform-preempt` no-commits, ending only at `--max 50`. Two halves, one
root, and they interact — hence one file.

**Already answered, not part of the fork.** The exit 0 is specced:
`spec/loop.md`, *Exit codes* — "Partial success — ships landed despite some
tick errors — stays 0, with the errors named in the completion summary". The
run named "40 tick(s) errored" and shipped before the wall, so its green exit
is the stated behaviour. Nothing to decide there.

## Half 1 — does a repeated platform failure reach the backstop?

`spec/loop.md`, *Repeated identical failures — quarantine, then abort* keys
the accounting by stage-tagged signature over exactly four stages —
provision, render, merge, gate. `platform-preempt` is not among them and the
verdict carries no list for it, so the section's own preamble ("every
per-entry failure fact the verdict records") stays literally true and there
is no defect to file against the text as written. Meanwhile the section's
opening names precisely this burn shape, and the backstop's stated job is
"the non-entry-scoped class quarantine cannot isolate" — which a dead
platform is.

The precedent is already written down, in the package: `harness/standingRefusal.ts`
rules that a wall no agent can move is **not the package's to declare** —
"Walling it here is the package minting a fourth member of a set the spec
states; if that wall is wanted, it is stated where the enumeration is." So
the answer, whatever it is, belongs in the spec's enumeration, not in
`harness/` and not derived by a plan tick.

- **(a) Fifth stage, backstop leg only.** Signature = the reported failure
  class, opaque equality as the section already rules. Aborts at 3
  consecutive, exit 1. *Cost:* the quarantine leg must be excluded
  explicitly — today `superviseLoop`'s `failures` list feeds both legs, so a
  fifth member would also quarantine the entry, contradicting the taxonomy's
  "explicitly **not** a defect in the work" (`spec/loop.md`, *The no-commit
  taxonomy*).
- **(b) Its own abort, beside the accounting.** Keeps the four-stage roster
  and the quarantine leg untouched; costs a second counter and a second
  threshold knob.
- **(c) Leave it.** Cost is bounded by `--max` and, at ~$0/tick here, was
  cheap — but a rate limit or cap that trips after real spend burns the same
  budget for money.

Recommendation: **(a)**, backstop-only, if the quarantine exclusion can be
spelled cleanly; else (b). Note the signature is coarse — the class string is
one sentence covering crash, kill, auth and rate-limit alike, so three
consecutive *different* platform failures abort too. That reads acceptable:
three non-zero agent exits in a row is a dead host whatever the cause. But it
does mean a transient rate limit aborts a run that backoff would have
carried, and flume has no backoff.

## Half 2 — the no-self-rewake exception is one tick deep

`spec/harness.md`, *The default `handoff`*: "the one exception is the slice
that just ran and committed nothing, which is not re-woken into the same
wall." `harness/handoff.ts`'s `wakeSet` excludes exactly one name —
`walled = result.committed ? undefined : result.phaseName` — and its own doc
claims "Excluded, it costs one tick."

With two live slices that claim is false: plan-derive walls, excludes itself,
wakes plan-sweep; plan-sweep walls, excludes itself, wakes plan-derive. Each
*is* re-woken into the same wall, one tick later, for the rest of the run.
That is the ping-pong the field run shows.

The fork is where the bound lives. The handoff is stateless per tick — it
reads one `TickResult` and cannot know a sibling walled two ticks ago — so:

- **(d) Half 1 is the whole answer.** A platform wall bounded at 3 bounds
  this too, and a render wall already accrues. What stays unbounded is the
  **clean-exit** slice wall — an unroutable record, the case the doc comment
  itself names — which the spec rules is "not evidence anything went wrong"
  and so never accrues. Accept that, and shrink the two over-claiming
  sentences to what one tick of exclusion actually buys.
- **(e) Bound it properly.** Needs run-scoped phase state the handoff does
  not have: either the engine reports the phase keyspace's standing
  prior-attempts to `handoff` (a new field), or the supervisor grows a
  phase-level analogue of the entry quarantine. Both are engine capabilities,
  and the second-implementation test is open on each.

Recommendation: **(d)** — fix the claims, let the backstop be the bound. (e)
is a real capability but the burn it closes is the clean-exit slice wall
alone, and nothing has measured that one yet.
