# The batch surface landed; two consumers of it did not

Shipped: `Gate` is now a union (`SingleSpanGate` | `BatchingGate`) keyed on
`batches`, `GateContext`/`BatchGateContext` split off a shared `GateSite`,
`supervisorPolicy.mergeBatch`, and `src/gateBatch.ts` holding
`mergeBatchWidth` + `batchGateContext`. `runGate` narrows on the discriminant
and refuses a batch handed to a gate that never declared it.

Deviation: the predicate is in a new `src/gateBatch.ts`, not `src/Phase.ts`.
Phase.ts is types-only; a function there would have been a second job in it.

Two things the entry's `files` named that I did **not** ship, both because
they need a spec decision no section makes:

1. **A declared gate's `batches` flag** (`harness/declaration.ts`,
   `harness/declaredGates.ts`). A consumer's declared gate is `registry`,
   `shell` or `script`. A shell/script gate reads its facts from the
   `FLUME_*` environment (`gateFacts`), and spec/harness.md's `gates` row
   enumerates those vars with no spelling for a batch — env carries no NUL
   and a batch is a list of records, so the encoding is a real design call.
   Adding the flag without the encoding would hand a command gate a batch it
   cannot read, which is exactly what the flag exists to prevent. So no
   consumer-declared `afterMerge` gate can batch yet, and every consumer
   phase is held to one span per merge.

2. **The judge.** spec/harness.md, *The judges* already states the judge
   accepts batches (one suite run, each entry's `tests[]` red at its own
   base, one base tree per distinct base). `harness/judgeGate.ts` does not
   declare `batches: true`, so this repo's build phase cannot batch however
   `mergeBatch` is set. That is its own entry.

Blocked sibling (the merge that carries a batch) now has: the width to ask
for, the context builder to call, and the refusal if it hands a batch to the
wrong gate.
