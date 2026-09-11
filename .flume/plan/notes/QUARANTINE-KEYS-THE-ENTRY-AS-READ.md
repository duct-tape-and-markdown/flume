# The entry-bytes key collides with observedFiles accretion

**Spec sentence needs a human edit.** spec/loop.md (*Repeated identical
failures*) says the key is "a hash of its bytes in `pending.json`". Measured:
`commitPendingUpdate` merges a failed attempt's footprint into
`entry.observedFiles` in the **same wave that blames the entry**. A
whole-bytes hash therefore mints a new key on the next read and every merge-
and gate-stage quarantine lifts its own hold one tick later — the full-price
re-attempt the section exists to prevent. Provision-stage failures are
unaffected (no mergeOutcome, no write-back).

Shipped with `observedFiles` excluded from the hash, declared and cited at
`quarantineKey`. Every other write-back (`blockedBy` → `open`) is a real state
change and re-keys deliberately. Pinned by the "hash of its bytes" test, which
asserts the key survives the accretion. The spec sentence should gain the
exclusion.

**`QuarantinedTag` is unreachable from the package.**
`TickResult.quarantinedTags` is now `readonly QuarantinedTag[]`
(src/Phase.ts), but `src/index.ts` was outside this entry's fence, so a chain
author cannot name the type. Wants a one-line barrel entry.
