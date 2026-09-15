# Core-field agreement needs zod internals to read the field set

The new gate derives the core field names from the composed validator, but
`composePendingList` returns `z.ZodType<PendingEntry[]>` — a type exposing no
field set. The test gets at it with
`composePendingList() as unknown as z.ZodArray<z.ZodObject>` then
`.element.shape` (tests/PendingSchema.test.ts, `coreFieldNamesFromValidator`):
the judge reaching through an engine cast into a zod-version-specific shape, so
a zod major renaming `.element`/`.shape` breaks the gate into a red that reads
as a schema defect. An engine-side accessor for "the field names the composed
validator accepts" would give the render and the gate one source; worth
weighing against the cast being test-only.

Second: the rendered core block gained a line after `files`
(`observedFiles`). Downstream chains asserting on the rendered core wording
re-anchor — docs/surveys/consumer-chains records one (consumer-c) already
holding a stale clause assert. Nothing in this repo pins the render's shape.
