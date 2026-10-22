# The gate context's assignment leaves spec/chain.md stale

`GateContext.entry` and `GateContext.steps` are now one optional
`GateContext.assignment` (`{ entry, steps }`), same on every `GateBatchSpan`
row, withheld whole by `BatchGateContext`. `docs/CHAIN-AUTHORING.md`'s roster
moved with it and its doc-walk pin holds the equality.

**Owed to a human:** `spec/chain.md`, *What a gate receives* still walks
`entry` and `steps` as two bullets, and its `batch` bullet still lists both
per span. Nothing mechanical reads that page against the type — the walk pin
is on `docs/CHAIN-AUTHORING.md` alone — so the corpus and `src/` disagree
with nothing red. Two bullets collapse to one; the `batch` bullet drops
`entry, steps` for `assignment`.

Two consumers deleted copies rather than gaining them:

- `harness/gates.ts` recordsGate carried a loud refusal for a span that
  stated the entry without its steps — the bottom rung this entry promoted.
  Unconstructable now, so the refusal and the case driving it are gone.
- `harness/judgeGate.ts`'s `SpanFacts` reads one key where it read two.

Also worth knowing at the cut: this is a breaking chain-facing rename and
there is no `docs/MIGRATING-0.23.md` yet — 97 commits since v0.22.0 have
written none, so the page looks like release-cut work rather than per-entry
work. If that is right, the cut owes a section for this rename
(`ctx.entry` → `ctx.assignment?.entry`, `ctx.steps` → `.assignment.steps`).
