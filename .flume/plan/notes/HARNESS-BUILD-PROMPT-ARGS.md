# TickContext reports no stateRootRel, so build's args take repoRoot

Two things the next plan tick should weigh, both surfaced by wiring the
five args in `harness/prompts.ts`:

1. `GateContext` carries `stateRootRel`; `TickContext` does not. The note
   path the build prompt names is repo-relative — the spelling the records
   gate keys a note by — so `buildPromptArgs` takes `repoRoot` as a
   parameter and calls the engine's own `computeStateRootRel`. That is a
   fact the engine already holds for gates and does not report to
   `promptArgs` (`engineering.md`, *A fact the engine holds is reported*).
   The field on `TickContext` would delete the parameter.

2. `Phase.promptArgs` is synchronous, so `resolveCite`'s promise cannot be
   unwrapped there. Rather than a second section reader beside the gate's,
   `citeResolver.ts` gained `resolveCiteSync`: the same locus check and
   section grammar over a reader that answers now. HARNESS-PHASES can wire
   build's `promptArgs` to it as-is — no engine widening needed.
