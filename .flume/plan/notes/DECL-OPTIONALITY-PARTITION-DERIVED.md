# The declaration test's last hand-kept count

The required/optional partition now reads off `DeclarationSchema.shape`
(a key is optional exactly when its entry parses `undefined`), and it
reproduced both hand lists verbatim while adding `handoff`.

One hand-kept number survives in the same file: the acceptance case's
`expect(Object.keys(declared)).toHaveLength(13)`
(`tests/harnessDeclaration.test.ts`). It is not redundant with the
`toEqual(Object.keys(shape))` beside it — it is the tripwire for the
schema *losing* a field while the fixture loses it too, which the
set-equality would pass over. But it reads as a restated count with no
stated reason, so a sweep will keep re-finding it. If plan wants it kept,
the reason belongs in a comment at the line; if not, it can go.

The required case also asserts `requiredFields` equals
`["specLocus","fence","runner","slices"]` — a deliberate pin on *which*
four are required, so a field quietly gaining `.optional()` fails here
rather than silently moving lists.
