# The judge batches; shellGate still holds the phase to one span

Shipped: `JudgeRequest` is now `{ spans, cwd }` with the per-span facts on
`JudgeSpan`; a serial merge passes one span. `namedLinesGate` declares
`batches: true` and returns `BatchingGate`.

Three things for the next plan tick.

1. **The width is still 1 for build.** `mergeBatchWidth` needs *every*
   `afterMerge` gate to declare `batches`. This repo's build phase also hangs
   `tsc` at `afterMerge`, built by `shellGate`, which declares nothing — so a
   batched merge still cannot reach the judge here. `shellGate` reads no
   per-span fact (one command, one tree), so declaring it looks mechanical,
   but it is an engine change (`src/gates.ts`) and the whole shell family
   inherits it: `vitestGate`, `eslintGate`, `tscGate`. Worth an entry; the
   judge's own work buys nothing until it lands.

2. **A gap I filled, spec-silent.** `spec/harness.md`, *The judges* states the
   batch rule for the *proof* half only. For the **red-suite** half I asked
   every distinct base over the failing files and ruled `base-red` when any
   one of them reported a failure — conservative in the direction that
   withholds blame. Worth a sentence in the spec or an explicit different
   call; nothing pins the choice beyond the doc comment at the site.

3. **`GateResult` has one message for a whole batch.** When some spans of a
   batch put their work down, the gate appends what they said in parentheses
   to the judge's message; there is no per-span row on the result. If the
   dispatcher ever wants to report a batch's verdict per entry, that is a
   `GateResult` surface question, not the judge's.

Full suite green (2319 passed). All five named lines verified red against the
pre-fix `harness/judge.ts` + `harness/judgeGate.ts`.
