# docs/ classifies itself; two residues the cite grammar cannot see

Shipped. The partition is **on the page**, not in the test: each `docs/*.md`
declares `> **Current reference.**` or `> **Dated record.**` under its H1, and
the scan reads that. An inventory in the test would be a second copy of a fact
the page owns, and invisible to the reader who lands on CASCADE-DRY-RUN.md and
hits `v0.8 §4`. Five pages dated (CASCADE-DRY-RUN, PRD-dock-collapse, three
MIGRATING-*), three current; a new page carries neither and fails the split.

Two residues left, both unreachable by `RELEASE_CITE_RE`:

1. `src/Agent.ts` — the bare `§6` is cut, but nothing pins the cut. A bare
   `§N` with no version token is indistinguishable from a live `§` cite
   (`docs/MIGRATING-0.10.md § 5`, which the sensitivity pin protects), so
   widening the grammar would delete working pointers. Unpinnable as filed.
2. `docs/CHAIN-AUTHORING.md:845` — "v0.1 ships one adapter". Not a spec cite,
   so outside this entry, but era-scoped prose on a current-reference page at
   0.14 (`engineering.md`, *Prefer the condition to the era*).
