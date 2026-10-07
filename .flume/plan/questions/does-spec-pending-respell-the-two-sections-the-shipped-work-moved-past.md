# Does `spec/pending.md` respell the two sections the shipped work moved past, or state the behavior instead?

Two build notes, 2026-10-07 (`A-MAXPARALLEL-BELOW-ONE-REFUSES-THE-CHAIN-LOAD`,
`AN-ENTRY-INHERITS-ITS-ANCESTORS-GATES`), each found the section it shipped
against now stating something the tree does not do. Both are human edits — no
phase may touch `spec/` — and both sections are read by the next derive tick as
current truth, so they come here rather than to the queue.

## Site 1 — *Fanout partition — disjoint touched paths*, the `maxParallel` paragraph

On disk it reads: "`maxParallel` comes from `DispatcherOptions.maxParallel` and
**defaults to 4**. The CLI forwards no override, so a CLI-driven wave runs at
most four agents concurrently; only a programmatic embedder changes it. The
value is unvalidated: a non-positive one satisfies no batch's capacity test, so
every entry opens its own batch and the wave runs a single entry rather than
refusing."

Measured on this tip, four claims in it:

- *"only a programmatic embedder changes it"* — a chain's
  `supervisorPolicy.maxParallel` overrides it and is preferred where declared.
- *"The value is unvalidated"* — the declared half refuses at chain load
  (0aea199f): zero, negative and fractional each throw.
- *"the wave runs a single entry rather than refusing"* — the wave is
  slot-driven, and a width of zero opens **no** slot, so it runs nothing. The
  sentence was true of the batch-driven wave.
- The embedder's half really is still unvalidated, and a queue entry is filed
  for it this tick — so the paragraph's last sentence is the only statement of
  that gap, and it describes the wrong symptom.

The same section's earlier paragraph says "The dispatcher runs `batch[0]`, then
re-derives pending and partitions again". The initial fill is still `batches[0]`;
after it, each freed slot pulls one disjoint entry rather than re-partitioning.

## Site 2 — *Pickability*, the two leading bullets

They still spell **two** implementations —
`isPickableNow(entry, shippedTags, isForkResolved?, capabilities?)` resolving
`blockedBy` "against a **shipped-tags set**", and
`isPickable(entry, pending, …)` as selection's internal one — under the lead
"Two implementations, one rule set". On this tip there is one: `isPickable` and
its `settledBlockers` composer are gone, `isPickableNow` takes the queue, and
selection calls it directly. The example the first bullet cites for "tooling
that holds its own shipped-tags set" holds none either — the same ship deleted
its `readShippedTags`, so it hands its backlog listing in. The section's own
later paragraphs
("`isPickableNow` therefore takes the queue the entry sits in", "A blocker no
queue entry carries counts as landed") already describe the tree, so the
section contradicts itself as well as the code — and the first of those,
landed at `ce4840d8`, opens "**Both implementations** read the entry's
ancestors", so the respelling has one more site than the two bullets.

## The fork

1. **Respell both to the tree.** Cheapest, and leaves the shape as it is: a
   spec paragraph carrying an exported function's parameter list and the
   engine's refusal behavior, which goes stale again at the next signature or
   posture change — twice now in this section.
2. **State the behavior and drop the restatement**
   (`spec-writing.md`, *The spec does not restate a sibling*; *A claim names
   behavior, never location*). *Pickability* would name one rule set and the
   facts it reads, not a signature; the fanout paragraph would say that a width
   below one refuses and where the engine refuses it, not what the capacity
   test does with a zero. Costs one editing pass over material that reads fine
   today.

The lean is (2) for *Pickability* — a signature in prose is exactly the copy
that section has now gone stale on — and (1) plus the fourth bullet above for
the fanout paragraph, whose subject genuinely is a value and a default.
