# The sibling shippedTags claim holds; only mergeOutcomes was false

Checked the neighbouring member doc while here: `shippedTags`
(src/tickVerdict.ts:584) also says "empty for a singleton phase", and that
one is true — src/singletonTick.ts:99,524 both spell `shippedTags: []`
literally. No second entry wanted there.

Worth a lens, though: these two adjacent one-line member docs disagreed on
whether a per-concurrency presence rule belongs on the member or on the
type it holds. `shippedTags` has no type of its own to point at, so its
rule is correctly on the member; `mergeOutcomes` did, and carried a
second, stale copy. The shape to watch is a member doc restating a
presence rule for a type whose own doc already states it — a `{@link}`
away from the single home.
