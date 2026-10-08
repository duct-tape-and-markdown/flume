# The cycle arm now drops containment edges; the step-scope arm still double-files

Shipped: `queueForestErrors` (`src/PendingSchema.ts`) folds each entry's own
`blockedBy` with every ancestor's — `ancestorsOf`, the same fold
`isPickableNow` takes — and searches that graph from every entry, not only
those whose own gate is `blockedBy`. The refusal lands in the *declarer's*
file at the index it wrote, so an inherited hop is filed where it can be cut.

Two things the next plan tick may want:

1. **The containment arm and the cycle arm are now coupled by a set.** The
   containment loop records each edge it refuses (`containmentRefused`) and
   the cycle arm withholds those from the graph, because a containment edge
   closes a cycle in the effective graph by construction — the descendant
   inherits the gate naming it. Without the withholding, every existing
   containment case grew a second refusal. That coupling lives in one
   function today; if either arm moves, the set moves with it.

2. **The step-scope arm does *not* withhold, so it still double-files.** Two
   steps of different work entries blocked on each other draw two
   step-scope refusals *and* two cycle refusals — four findings for two
   edges. Pre-existing for declared edges, unchanged here, and outside this
   entry's acceptance ("a closing edge that reaches into its own declarer's
   containment"). Filing it as its own entry would make the withholding
   general rather than containment-specific; I did not widen it unasked.

Minor: `ancestorsOf` rebuilds a tag index per call, so the fold is O(n²) over
the listing. Invisible at queue sizes this repo sees (11 pending); noted so
a later reader does not read it as measured.
