# The same one-path-per-line shape sits unrefused on the retry prompt

Shipped: `unspellableTouched` (`harness/declaredGates.ts`) refuses before the
spawn, naming the path on `failingFiles` and escaped in `details`; the
`gateFacts` block that declared the gap now names it; `docs/CHAIN-AUTHORING.md`
states the refusal for a chain author.

Two things for the next plan tick:

1. **Engine surface, same defect class.** `src/Prompt.ts:990` renders a gate's
   `GateResult.failingFiles` by `join("\n")` into an indented block for the
   retry context. So the very path this refusal reports lands in the agent's
   prompt as two file lines — one-path-per-line with nothing refusing on it,
   one layer down from the gap just closed. Reachable only through a gate that
   puts a newline path on `failingFiles`, which now includes a shipped one.
   Candidate fix is at the renderer (escape or fence the line), not at each
   gate. `writablePathsGate`'s `details` prose (`src/builtinGates.ts:800`) has
   the same shape for the same input.

2. **Pre-existing red re-measured on this tip**, unchanged by this entry:
   `tests/harnessRunner.test.ts:1107` — `coverage.kind` `known` where the case
   wants `unknown`. Full suite otherwise green, 2617 passed. That is
   THE-UNLISTABLE-TREE-CASE-DRIVES-A-RESOLUTION-THAT-REFUSES, already queued.

The pin's span deliberately carries a space, a quote, a backslash and a tab:
every shape near the fence that the channel does spell, so the refusal is
pinned narrow rather than as "any odd path fails".
