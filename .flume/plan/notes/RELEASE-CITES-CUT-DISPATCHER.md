# Dead cites remain in tests/ and docs/, outside this entry's fence

The cut went past the declared 81 `v0.N §M` sites: 110 further lines carried a
bare `§N` into the same deleted corpus, each anchored by a cite this entry
removed, so they went with their anchor (cf1bf11's precedent). Acceptance is
unchanged; the module now carries no `§` but two live pointers.

Three version mentions stay — `field report 0.12.0`, `flume 0.10.1 field
trace`, and the `pre-0.10 shape` error string. Those name releases an incident
happened in, not sections of a file that no longer exists.

Still dead, and unreachable from here:

- `tests/**` — `tests/Dispatcher.test.ts` alone carries ~40, several in
  `describe` titles. RELEASE-CITES-PINNED's needle covers `src/` + `examples/`,
  so nothing will catch these.
- `docs/CHAIN-AUTHORING.md:1321` — "a chain declaring neither gets the v0.7 §16
  defaults".

One test title changed — `tests/Dispatcher.test.ts`'s "...gets the v0.7 §16
defaults, byte-identical" → "...supervisor-policy defaults, byte-identical" —
because Dispatcher.ts quotes it, and the quote would have re-armed the pin.
