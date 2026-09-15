# PROTOCOL still points the discipline page at `.flume/prompts/`

`.flume/PROTOCOL.md` (~line 70) ends its phase paragraph with "the shared
writer discipline in `.flume/prompts/plan-discipline.md`". That directory does
not exist — the page ships from `harness/prompts/`, and
`tests/harnessPrompts.test.ts` pins that every plan slice points at it by the
address `promptPath()` resolves rather than a spelled path. PROTOCOL carries a
dead pointer to the very page this entry amended: a slice following it opens
nothing and writes the queue without the overlap rule.

`.flume/PROTOCOL.md` is outside build's fence, so this is plan's. Cheapest
shape is the one the test already blesses — name the page, not a path.

Nothing else surfaced. The entry named no `tests[]`/`pins[]` line, correctly:
by its own new rule a prompt-only diff has nowhere to put a red-on-base test.
