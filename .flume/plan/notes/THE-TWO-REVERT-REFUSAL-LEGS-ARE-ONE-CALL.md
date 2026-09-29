# The revert-refusal fold leaves a cross-module twin

Folded, as the entry named: `refuseRevert(message)` in `carrySpan`
(`src/waveMerge.ts`) holds warn / `revertRefused` / `mergeOutcomes` /
`gateFailures` / `return slug`, with the `foreignTip` arm and the
`ResetKeepRefusedError` catch as its two callers. Typecheck green, suite
green, no test changes.

One deliberate convergence, so plan sees it rather than a later sweep
re-deriving it: the two warn lines differed, and the fold keeps the
`foreignTip` spelling verbatim. The reset-refused leg's warning now quotes
its whole refusal message — which already names `mergedSha` and `preCherry`
in full — instead of the bare error plus a short-sha "back to" clause. No
fact dropped; the reported `gateFailures` rows are byte-identical on both
legs, which is what the standing cases read.

What the fold exposes: the same pair of legs lives in `src/singletonTick.ts`
(the `mergeFate` block), and the two modules now spell the *message* twice —
`` `${err.message} — afterMerge-failed commit ${mergedSha} stays on trunk,
unrevertable to ${preCherry}` `` appears in both, as does the warn template
and the `bound(..., MAX_FAILURE_SIGNATURE)` pairing. Folding across the two
modules is not behavior-free from here: the singleton's rows carry no
`entryTag` and no `blame`, and it pushes one `mergeOutcomes` row after the
branch rather than one per leg. A shared "a refused afterMerge revert reads
like this" helper — message text plus signature — is the shape that would
kill the last copy; it wants its own entry, not this one's scope.

Unrelated: `src/waveMerge.ts` is not prettier-clean at HEAD (three
hand-wrapped call sites the formatter rewraps). No formatter gate runs, so I
reverted prettier's collateral hunks to keep this diff scoped. If the repo
wants one spelling, that is a gate, not a build tick's judgement.
