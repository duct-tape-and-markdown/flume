# One more shipped doc comment carries the chain's vocabulary

Shipped as written: both option docs now state only what the mechanics
consume, and the scan (tests/docComments.test.ts) names the class — an
open-questions artifact, a `.flume/` path, a phase name from this chain —
not a literal.

Left unfiled, one file past the entry: `src/priorAttempts.ts:336`
motivates the revert snapshot with "a gate-reverted plan tick otherwise
loses its state.md / open-questions.md prose". Weaker than the two fixed
here — it is rationale prose, and the paragraph below it already declares
"generic by construction" — but it is the same class, and whether a
motivating example may name one chain's artifacts is plan's call.

Tension worth a ruling: this scan reads src prose with a test, which
`engineering.md` (*Narration is the ladder's bottom rung*) reserves for
engine behavior. A shipped `.d.ts` is arguably behavior; if it is not,
the scan is the wrong rung and no rung is left.
