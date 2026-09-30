# Ordered assertions over set-valued verdict fields

The walled-wave case now reads `verdict.tags` sorted plus a length pin
(`tests/Dispatcher.test.ts`, "a wave whose merge stage throws outside its
ledger rewrite reports a tick verdict naming the spans it already shipped").
`provisioned` in `src/waveTick.ts` pushes as slots fill and refill, and that
case arms two slots wide (`maxParallel: 4`), so the two pushes race: the
posix red was the race, not a defect in the engine.

One sibling left standing on purpose: the mid-wave-queue case asserts
`verdict.tags` as `["QR-A", "QR-B"]` in sequence
(`tests/Dispatcher.test.ts`, "a wave walled by a mid-wave queue re-read the
phase cannot rewrite reports a verdict naming the spans it shipped"). Its
chain declares `maxParallel: 1`, so QR-B is provisioned only as the refill
of the slot QR-A's merge freed — the order is a fact of the arming, and the
case asserts the invocation sequence deliberately beside it. Every other
`verdict.tags` assertion in the file is already sorted, `arrayContaining`,
or single-element.

The family worth a lens, if plan wants one: an ordered assertion over a
verdict field the spec words as a set — `tags`, and `shippedTags` wherever a
wave can ship more than one span. It reds at random, so it surfaces as a
flaky host lane rather than a finding, which is how this one reached the
queue only after a red on posix.

Unrelated debt observed while formatting: `tests/Dispatcher.test.ts` is not
prettier-clean on the base — import lists and several `expect(...)` calls
differ from `npx prettier` output at sites this entry never touched. Nothing
gates it today (no format gate in the chain), so it drifts silently and
every future diff in that file carries the noise.
