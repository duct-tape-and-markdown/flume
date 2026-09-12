# isErrorResult has one reader, but its doc comment claims two

Shipped: both agreement tests now drive `withTerminalRenderer(claudeCode({
outputFormat: "stream-json" }))` over a mocked spawn, so the renderer and
`extractFinalMessage` read the same streamed bytes and the extraction is
production's own call (`AgentResult.finalMessage`), not a test-side one.
Verified one-sided-red by mutation on both halves.

Two observations for a later rotation, neither correctness-adjacent:

- `src/Agent.ts`'s vocabulary doc comment (above `isAssistantEvent`) says the
  block exists "so two readers can't drift". True of `isAssistantEvent` /
  `isResultEvent`; false of `isErrorResult`, whose only consumer is
  `formatResult`'s ERROR head. The entry's own notes field said the same.
  Narration asserting a sharing that does not exist.
- `assistantTurnText`'s only consumer outside `src/Agent.ts` was the
  stand-in leg this entry deleted. Rather than narrow the export, I gave it
  its own hand-authored shape test — in scope per the section's last bullet,
  but plan may prefer the narrowing.
