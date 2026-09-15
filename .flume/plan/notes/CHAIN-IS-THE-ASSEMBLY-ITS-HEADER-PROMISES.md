# The split needed no test edits, and two moved types went module-local

`entry.files` predicted edits to `harnessChain.test.ts`,
`harnessGates.test.ts` and `harnessJudge.test.ts`. None were needed: no test
imports the moved names — every case drives `harnessChain` itself. So the
registry/script construction cases (`harnessChain.test.ts`) now sit a module
away from the code they cover: shape, not correctness, worth a look if a later
entry re-homes them.

Two types moved with their code and had to stop being exported:
`GateDeclaration` (`declaredGates.ts`) and `ParkPredicate` (`judgeGate.ts`)
are named only inside their own module's signatures, and
`exportConsumers.test.ts` reds an export no other module references. A new
internal harness module earns its exports only through what `chain.ts` calls.
