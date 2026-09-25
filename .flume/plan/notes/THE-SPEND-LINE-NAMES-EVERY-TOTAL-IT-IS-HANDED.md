# The sibling renderer over the same shape has no such pin, and its cite overclaims

The pin landed as a perturbation case: the fold's own output names the
roster, and for each total the fold reports as moved *alone* the rendered
line must move. Probed by adding a ninth summable field to `AgentUsage` plus
its sum in `totalAgentUsage` — the case reds with "webSearches is summed but
never printed"; removed again before the commit.

Two adjacent observations for the next derive.

1. `formatResult` (`src/terminalRender.ts:242`) is the second hand-written
   roster over the same compile-exhaustive shape. It spells five of
   `AgentUsage`'s seven numeric facts — `cacheCreationInputTokens` and
   `cacheReadInputTokens` are absent — and abbreviates tokens. That looks
   deliberate (a glance line, not a CI-addable one), so it is not the spend
   line's defect. But `AgentUsage`'s own doc (`src/Agent.ts:86`) says these
   are "the values `formatResult` renders that event's terminal line from",
   which reads as all of them. Either the sentence names the subset, or the
   omission is declared at `formatResult`. Prose-only, so debt rather than an
   entry unless plan reads the overclaim as load-bearing.

2. `tests/loopSupervisor.test.ts:2282` still pins the spend line as one exact
   hand-written string over a hand-written fixture. Left standing on purpose:
   it is the only case that pins the line's *spelling* (separators, `×`,
   decimal places), which the new perturbation case deliberately does not
   read. Not duplication — different claims — but a ninth total goes green
   there, so it is not the roster's guard and should not be read as one.

No blocker; entry shipped whole.
