# Chain-load batches; the narrowing arm has no builtin subject left

Shipped as written. `chainLoadGate` is a `BatchingGate`; its four reads are
`ctx.touchedPaths` (the batch's union) plus three `GateSite` roots, so nothing
per-span is read and `run` takes the context union.

Two follow-on facts for the next derive:

1. **No builtin a chain can place at `afterMerge` withholds the declaration
   any more.** `writablePathsGate` is the only one left that does not declare
   it, and it hardcodes `when: "afterCommit"` and is attached by the
   dispatcher, so it cannot narrow a batching phase in practice. The
   consequence for tests: `mergeBatchWidth`'s narrowing arm has no builtin
   subject, so the case keeping that arm is now a chain-authored fixture gate
   (retitled, `tests/gateBatch.test.ts`), and `runGate`'s refusal arm is
   likewise reachable only from a chain's own gate. Both are the right
   subjects — but the engine now ships nothing that trips either, so if a
   future builtin is written for one span, the only thing holding it to the
   declaration is the type.

2. **Small reporting-fact wording, not filed.** The gate's skip reason reads
   `<chain.ts> untouched by this commit`. Under a batch the subject is the
   union of N spans' paths, and under `afterCommit` it is already a
   `baseSha..commitSha` range that may hold several commits, so "this commit"
   under-states the subject at both widths. Nothing pins the string. Left
   alone to keep this diff on its subject; a one-line candidate if a sweep
   reads the skip reasons as reported facts.

`docs/CHAIN-AUTHORING.md` moved both statements: the withholding sentence
became a declares-it bullet beside `pendingGate`'s, and the roster bullet
names the declaration. Full suite green (78 files, 2508 cases).
