# The missing-arg refusal had no test of its own

Shipped as written: `substitutePlaceholders` now scans `raw` for unresolved
keys, throws if any, and only then composes. The discarded `result` and the
"leave as-is so the failure surfaces" comment are gone; message and resolving
output are byte-identical (full suite green before and after).

Worth plan's notice: the refusal this entry is about had **no test anywhere**
— `tests/Prompt.test.ts` pinned the inline-exec refusals and the FLUME_DIR
reservation, nothing pinned `prompt references missing args`. A behavior-free
restructure of an unpinned throw is a refactor over nothing, so I added two
pins in `tests/Prompt.test.ts`, describe "renderPrompt — an unresolved
{{KEY}} refuses the render":

- "names every missing key, sorted, in one refusal"
- "refuses rather than returning a prompt whose resolvable keys were
  substituted"

Both are green on the pre-fix tree by construction — they pin what already
held, which is why they are pins and not `tests[]`. The entry claimed no
property, so neither line appears in it; plan may want them recorded, or may
want the standing shape to be that a shape-family entry touching a refusal
carries its `pins[]` so the judge sees them.

Nothing else in the tree asserted the old behavior: a search across
`src/`, `harness/`, `tests/`, `docs/`, `spec/`, `README.md` and
`.flume/PROTOCOL.md` for "leave as-is" / "unresolved placeholder" /
"missing args" turned up only the throw's own message.
