# The zero-judged span now refuses; the partial span still passes

Shipped as filed: `declaredFilesGate` refuses when the commit touched none of a
non-empty `files` declaration, and spells the empty-declaration case (all three
arrays empty — `src/PendingSchema.ts:133` permits it) as its own explicit green.

Two things for the next derive:

1. **The partial span is still a green.** A commit meeting 1 of N declared
   paths passes on the 1. That is now declared and cited at the site
   (`engineering.md`, *Loud or nothing*) with the zero-floor named as its
   bound, so it is deliberate rather than residue — but it is the remaining
   hole if plan wants the whole declaration judged.

2. **This repo's own `.flume/chain.ts` has no equivalent gate.** The finding
   was filed against the example; flume-on-flume ships entries with no check
   that the span met the declaration at all. Whether that wants an entry is
   plan's call — a chain-config question, not an engine one.
