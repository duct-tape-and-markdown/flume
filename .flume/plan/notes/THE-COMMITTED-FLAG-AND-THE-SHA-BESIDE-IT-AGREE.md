# The footprint that produced a ledger commit is on the verdict, not on TickResult

Writing the pin for this entry, the footprint a failed merge recorded could
not be read off `TickResult` at all. `FanoutEntryOutcome.mergeOutcome`
(`src/Phase.ts`) is the fate string alone (`"tip-moved"`, `"merge-conflict"`,
...); the paths live on the tick verdict's `mergeOutcomes[].footprint`
(`src/tickVerdict.ts`), which a `handoff` never receives. So the test had
to reach through `outcome.verdict` for the vacuity half of its claim, while
the pair it actually pins (`committed`, `commitSha`) is on the result.

Why it matters: the ledger commit `commitSha` now names on a footprint-only
wave exists *because of* that footprint, and a chain reading the result can see
the commit but not the paths that earned it. A `handoff` routing on "what did
the reverted span touch" — to decide a retry scope, to write a friction note —
re-derives it with a `git show` over `commitSha`, which is the engine's own
capture rebuilt by a second hand (`engineering.md`, *A fact the engine holds is
reported, never rediscovered*). Candidate entry: widen
`FanoutEntryOutcome.mergeOutcome` from the fate string to the verdict row the
engine already holds, or add a sibling `footprint?: readonly string[]` beside
it. Not filed here — out of this entry's scope, and which of the two shapes is
right is plan's call.

Also observed, no action taken: `docs/CHAIN-AUTHORING.md` names
`committed` in its `handoff` field list without stating what false means, so it
carries no copy of the claim this entry corrected. Nothing to re-home.
