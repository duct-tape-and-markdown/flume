# Does the dead-declaration rule hold past the loader?

**Section:** `spec/chain.md`, *A dead declaration is refused at load* — the
rule ("a chain field whose only consumer is statically unreachable from the
rest of the same declaration is a defect in the chain, and the loader refuses
it"), and the enumeration of "the decidable instances, each checkable from
the declaration alone, no tick required", which today lists one:
`phase.entryChannelPaths` without `phase.scopeWritesToEntry: true`.

Raised by the note under `A-DECLARED-THRESHOLD-NEEDS-THE-WINDOW-IT-CROSSES`
(shipped 6107bd52), verified this drain.

## What shipped, and why it is the same shape

`validateBudget` (`src/budgetHook.ts:87`) refuses a budget declaring
`thresholds` with no `contextWindow`: without a window there is no fraction
to compare, so the thresholds are an arm that can never fire. That is the
section's rule exactly — a field whose only consumer is statically
unreachable from the rest of the same declaration.

## Why it cannot join the section's list as written

The loader structurally cannot see it. The budget is not a chain field the
loader reads: it is an `AgentOptions` field (`src/Agent.ts:227`) composed
inside the agent factory the engine calls per tick — `harness/chain.ts:457`
builds `{ budget: { contextWindow } }` from the declaration's
`agents[phase].contextWindow` inside the closure. `loadChainModule` never
evaluates that closure, so no check "from the declaration alone" reaches the
field. The refusal fires where the value is first assembled: at chain-build
time for the adapter, and again in `parseBudgetArgs` for the hook's own argv.

So the section's list cannot take this instance; only its framing can move.

## The fork

- **(a) The rule generalizes, the loader stays its most common door.** A
  sentence saying the rule holds wherever a declaration is first read — the
  loader for the fields it can see, the assembling surface for a value a
  chain composes per tick — with the budget named as the second instance.
  Costs: the section's "no tick required" bar now describes the loader's
  half alone, and a reader must carry two doors instead of one.
- **(b) The section stays load-only.** The budget refusal lives under
  `.claude/rules/engineering.md`, *Loud or nothing*, and `spec/chain.md`
  claims nothing about refusals outside the loader. Costs: the section reads
  as an exhaustive statement of a rule it enumerates one instance of, and
  the next such refusal is filed the same way this one was.

**Recommendation: (a).** The rule as stated is about the declaration, not
about the loader; it is the *enumeration* that is load-scoped. Leaving it
implies a chain can only be dead-declared in the fields the loader reads,
which the budget disproves. (b) is defensible only if "refused at load" is
meant as the rule's boundary rather than its usual door — that is the call
being asked for.

## Not in scope here

`budgetLineDue`'s now-unreachable fraction guard, the note's second item, is
a queue entry (`A-WINDOWED-BUDGET-READING-CANNOT-LACK-ITS-FRACTION`), not
part of this question.
