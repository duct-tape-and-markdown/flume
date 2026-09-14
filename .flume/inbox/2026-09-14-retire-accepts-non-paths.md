# `files.retire[]` still accepts non-paths on 0.15.0 (consumer-chain survey, re-date)

`src/PendingSchema.ts:136` types `retire` as `z.array(z.string().min(1))` — a
bare non-empty string with no path refinement. `touchedPaths`
(`src/PendingSchema.ts:582`) then feeds those values to the fence.

So a symbol name or a prose fragment authored into `retire[]` is accepted at
write time and fails later at the fence pre-check as "declares files outside
the fence" — an error naming the fence, not the malformed value that caused it.

Field precedent: two entries in a downstream job carried prose in `retire[]`
for weeks; under stricter checks they became latent wake-blockers, found only
when the pin moved.

Why it matters: `new` and `edit` carry a path plus free text, so their path
half is structurally separated. `retire` is path-only (`src/PendingSchema.ts:30`
says so in prose) and nothing enforces it — the one member of the three where
the rule lives only in a comment.

Originally filed 2026-08-06 against 0.11.x; verified unchanged on 0.15.0
today, so re-dated rather than re-derived.
