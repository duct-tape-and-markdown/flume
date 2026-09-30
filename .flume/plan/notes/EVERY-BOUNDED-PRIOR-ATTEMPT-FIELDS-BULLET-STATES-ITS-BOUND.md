# The same "full `details`" claim still stands in spec/loop.md, and a sibling bullet pin over-reads

Shipped: every bounded prior-attempt field states its bound and surviving end
on its own bullet in `docs/CHAIN-AUTHORING.md`, pinned in
`tests/priorAttempts.test.ts` against what the real builders emit over a
16 KiB capture and a 260-file commit — bound and end both derived from the
elision marker's position, never from the `MAX_PRIOR_*` constants, so a
constant that moves reds the page.

Scope taken past the entry: `touchedPaths` (200 entries, head) is stated and
pinned too. The acceptance enumerated six string fields, but it is a field the
writer bounds, and the same derivation reaches it via `omittedPaths`.

Two findings for the next tick:

1. `spec/loop.md:618` still reads "its one-line `message`, its full
   `details`" — the exact claim this entry retired from the authoring page.
   Build cannot touch `spec/`, so the two halves now disagree: the page says
   8 KiB head-and-tail, the spec says full. Human surface, needs direction.

2. `bulletOf` (`tests/helpers/docSections.ts`) stops a bullet at the next lead
   only, so over a list that is *not* the last thing in its section the final
   bullet swallows the rest of the section. That is live in
   `tests/Prompt.test.ts`'s "bullet for every prior-attempt mode names every
   field that variant carries": its `not-shipped` read spans the rendered
   sample and four bolded paragraphs, so a bullet that went silent on
   `mergedSha`/`touchedPaths`/`threw` would still pass on text further down.
   `bulletsOf` in the same helper already cuts at the blank line that closes a
   list and is now exported (this tick's pin uses it); pointing that case at
   it is a one-line fix with no behavior change. Correctness-adjacent: it
   hides a failure in a shipped pin.
