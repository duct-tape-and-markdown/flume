# The duplicate decode rode a duplicate parse

The entry named one defect (two decodes of one `result` event) and the fix
found a second beside it: `emitLine` called `parseNdjsonLine`, and then
`renderStreamJsonLine` parsed the same line again. So every NDJSON line was
JSON-parsed twice for the whole run, not just the result line. Folding the
decode folded that too — `readStreamJsonLine` (`src/Agent.ts`) now parses
once, decodes once, and hands back both the rendered string and the
`AgentUsage` the render was printed from. The comment at the old `:549`
claimed the walk was already shared; it was not, and now is.

One divergence is deliberate and declared at the site: the line still spells
an absent turn count as `? turns`, while an absent token count, cost, or
duration drops its segment entirely. `? turns` is honest about absence and
the head of the line reads as a count; a bare `result · 2.5s` would read as a
truncation. Absence is absent on both surfaces either way — no figure is
coerced to `0` anymore.

The pin (`a rendered result line reports the same turn, token and cost
figures the invocation's usage reports`) drives the real renderer over a real
transcript and reads both sides off it, per `engineering.md`, *A seam gate
reads what the real writer wrote*. Beside it, an unnamed regression case
asserts the whole line for an event carrying no `input_tokens` — red on the
pre-fix tree (`0 in`), green now. `entry.tests[]` was empty, so nothing
judged names it; plan may want it named if the property should be pinned as
introduced rather than carried.
