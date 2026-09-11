# The doc's `<prior-attempt>` block still knows only one variant

Amendment shipped: `docs/CHAIN-AUTHORING.md` §"The `<prior-attempt>` block"
now names both clears (clean ship; the fanout wave's queue read, reported as
`clearedPriorAttempts`).

Observed while there, out of this entry's scope: that section describes the
record as if `gate-revert` were the only mode. It opens "When a tick commits
and a gate reverts it", its sample block is a gate revert, and its prose is
all gate `name`/`details`/diffstat. `spec/loop.md` *Prior-outcome feedback to
the retrying tick* lists six variants — `clean-exit`, `platform-preempt`,
`render-refused`, `tip-moved`, `not-shipped` are absent from the doc
entirely, as are `headSha`/`at` anchoring and `suspectFlake` (which the doc
mentions at :316 from the gate side, with no record-side home).

Why it matters: a chain author reading this doc concludes a bail or a
`shipped: false` park forwards nothing, and rebuilds "was the last build a
park" from the verdict log — exactly the rebuild the `not-shipped` variant
exists to retire. Doc omission, not an engine defect.
