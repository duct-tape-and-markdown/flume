# The render seam now takes bytes, and two neighbours read it

`RenderOptions.promptFile` is gone; `renderPrompt` takes `template: string`.
The read moved to `readPhaseTemplate(configDir, promptPath)` (`src/Prompt.ts`,
exported from `src/index.ts`), called once in `Dispatcher.tick()` beside the
chain load and once in `Dispatcher.render()`. `AttemptContext` carries
`promptTemplate`, and the two context getters became
`attemptCtxFor`/`legCtxFor` parameters, so an attempt rendering from anything
but the tick's own load is unrepresentable rather than merely discouraged.

Two things plan should route:

1. **Seam with THE-PLACEHOLDER-REFUSAL-IS-A-RENDER-REFUSAL.** That entry edits
   the same two files. If it lands after this, its `promptFile` assumptions in
   `renderPrompt` are stale — the raw bytes are `opts.template`, and there is
   no path in scope at the render.

2. **A missing prompt file now refuses earlier.** Before, the `ENOENT` threw
   inside each slot's render; under fanout it surfaced as a `WaveCarriedThrow`
   after provisioning. Now it throws out of `tick()` before any worktree is
   cut. Loud either way, and strictly less to tear down, but the exit class a
   caller sees for that case changed. No test pinned the old shape (searched
   for one), so nothing red — which is itself the observation: a phase whose
   prompt is unreadable has no case in the suite, at either site.

Also unchanged on purpose: `phasePromptPath` (`src/paths.ts`) stays the one
address rule, now with `readPhaseTemplate` as its only caller.
