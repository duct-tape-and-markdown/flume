# The default's remaining prose copies

Shipped: `src/loopSupervisor.ts` now exports `DEFAULT_ABORT_THRESHOLD`, and
both help surfaces interpolate it instead of restating a literal 3, so help
text cannot drift from the value `superviseLoop` falls back to.

Observed while there — two prose copies of the number remain, both on
declaration surfaces rather than operator-facing help, so neither was in
this entry's scope:

- `src/Phase.ts` (`supervisorPolicy.abortThreshold` doc, ~line 577):
  "Default 3." Public hover text reachable from the package's `.d.ts`, so
  engine surface under `engineering.md`'s carve-out — a candidate for the
  same `{@link DEFAULT_ABORT_THRESHOLD}` pointer.
- `docs/CHAIN-AUTHORING.md` (~line 1513): "Default 3." No mechanism holds a
  markdown number; a doc-vs-constant agreement pin is the only rung above
  prose, if judged worth one.

No doc site restates the *fixed*-count claim this entry fixed:
`docs/CLI.md` and `README.md` carry no backstop prose at all.
