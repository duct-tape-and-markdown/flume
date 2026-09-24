# Three spec sentences trail behavior that has shipped or been ruled

Same shape as `operator-pages-still-describe-the-yield-...` before it: stale
statements of shipped behavior, not decisions. `spec/` is the human's
surface, so no phase can make these edits. Verified on disk this tick.

## 1. `spec/pending.md`, *`pendingGate` — validation and fence pre-check as an opt-in builtin*

Opens "`pendingGate(opts)` is an `afterCommit` gate", then numbers the claim
check third. `THE-PENDING-GATE-CARRIES-THE-CLAIM-CHECK` shipped
`PendingGateOptions.when` (default `afterCommit`) because the claim check
wants the *merged* tree, and `harnessGates` now attaches two instances on
each plan slice. **The sentence is now the default rather than the whole
truth.**

*Recommendation:* name the default and the knob — "an `afterCommit` gate by
default; `opts.when` moves it, which is how the claim check reaches the
merged tree". The section's own paragraph on `opts.fenceWhen`/`opts.hint` is
the place the knob belongs beside.

The build note flags a consequence worth a sentence either way: the
merged-tree instance re-runs checks 1 and 2 over the merged queue, so it is
not a claim-check-only gate and costs a queue parse per plan merge. A
claim-check-only gate would have been cheaper and would have wired
uniformly; it was declined because this section numbers the check *inside*
`pendingGate`. If the cheaper shape was meant, that is a real fork and this
sentence is where it gets said.

## 2. `spec/jobs.md`, the runtime-ignore listing

The block lists `tick-verdict.json`. The tick-verdict ruling (2026-09-24)
made the artifact a directory, `<flumeDir>/tick-verdict/<phase>.json`
(`spec/loop.md`, *The tick verdict — one facts artifact*), and a bare
`tick-verdict.json` line ignores no directory — a consumer would commit its
tick verdicts.

*Recommendation:* `tick-verdict/`, with the trailing slash its directory
siblings carry. Lands with `THE-TICK-VERDICT-IS-ONE-FILE-PER-PHASE`, which
changes `RUNTIME_IGNORES` on the code side; until both move the two
disagree, and `spec/jobs.md` is the contract `src/runtimeIgnores.ts` is
written against.

## 3. `spec/chain.md`'s `TickResult` field list

Does not name `priorAttempts`, which
`THE-HANDOFF-READS-THE-RECORD-SET-THE-ENGINE-HOLDS` shipped as a required
field. The list already omits `refusedTags` and `queueParseFailure`, so it is
not exhaustive-by-claim and this is the weakest of the three — raised because
the field is what the package's own refusal leg now reads, not an internal.

*Recommendation:* either add the line or say once in the section that the
list is illustrative, so the next reader does not file this again.
