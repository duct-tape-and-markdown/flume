# Two mechanisms were shared, not one

The entry named the roster. Two sibling spellings sat behind it in
`src/tickVerdict.ts`, and both went the same way:

- The optional-key conditional (`Record<string, never> extends Pick<T, K>`)
  was written out once for `ConditionalTickVerdictFact`; a second copy would
  have been needed for the invocation row's required half. It is now
  `OptionalKey<T>`, and both required-field types exclude through it.
- `isTickVerdict` and `isInvocationRow` each walked their own "object, and
  every rostered field holds". That walk is now `matchesRoster`, and both
  guards are one line over their own roster.

New exported type `RequiredInvocationRowField` — same shape and same reason
as `RequiredTickVerdictField`, consumed by the pin. No decode behavior
moved: the roster resolves to exactly `promptPath` / `uncommittedTracked`,
which the mapped type proves (an excess or missing key reds the typecheck).

Observation for the next rotation, not filed: `ALWAYS_WRITTEN`'s doc comment
explains why element types are not walked — arrays are checked with
`Array.isArray` and nothing descends. `ROW_ALWAYS_WRITTEN` inherits that
reasoning by being the same shape but does not restate it, on purpose
(*Narration is the ladder's bottom rung* — one home). If a third roster ever
joins, the reasoning wants a home above all three rather than beside the
first.
