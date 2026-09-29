# The signature-from-a-bare-message pairing is spelled 12 times

Shipped as scoped: `unrevertableMergeFailure` (`src/tickVerdict.ts`) now owns
the refused-afterMerge-revert words and their key; both catches construct
through it. `refuseRevert` (`src/waveMerge.ts`) takes the composed failure
rather than a message, so its foreignTip caller now spells its own key at its
own call site — the same shape the singleton leg already had.

Observed while folding: `bound(<msg>.trim(), MAX_FAILURE_SIGNATURE)` is
spelled 12 times outside `src/tickVerdict.ts` — 5 in `src/singletonTick.ts`,
3 in `src/waveTick.ts`, 2 each in `src/waveMerge.ts` and
`src/tickAttempt.ts`. That is the generic "a stage failure whose whole
identity is its own message" key, the sibling of `gateFailureSignature`
(`src/tickVerdict.ts`), which does have a home. So the provision, render and
merge legs each re-derive by hand the rule the gate leg imports. A helper
spelled in five modules (`engineering.md`, *A module is one job*); pure shape
today, because every spelling is byte-identical and the constant is shared —
what it can hide is one site dropping the `.trim()` or reaching for a
different bound, which changes quarantine's comparison key silently.

I left it standing: the entry's acceptance fences this refusal's pairing and
says folding the neighbouring rows is out of scope, and converting 12 sites
would have widened a no-property filing into a cross-module refactor. If it
files, the target shape is one exported constructor beside
`gateFailureSignature` returning `{ signature, message }` from a message, with
all five modules calling it — mechanical, and the typecheck plus the existing
suite hold the move.

No test names the refusal message before or after; suite green with no test
changed (74 files, 2134 passed).
