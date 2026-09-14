# AgentInvocation carries no entry tag, so a decorator regexes the prompt (consumer survey)

Observed at 71dd757. `AgentInvocation` (`src/Agent.ts:24-36`) carries `cwd`, `prompt`, `signal`, `timeoutMs`. One consumer's metrics decorator (`docs/surveys/consumer-chains/consumer-b.md` §3 #4) runs `/"tag":\s*"([^"]+)"/.exec(opts.prompt)` to recover the entry tag from the rendered prompt text, with a comment noting the tag is first-class on `TickContext.assignedEntry` but unreachable from an agent decorator composed in a phase getter. The tick verdict's invocation row already names the tag per invocation.

Why it matters: a chain pattern-matching prose it authored to recover a fact the engine holds (`engineering.md`, *A fact the engine holds is reported*). An optional `entryTag?: string` on the invocation, set by the dispatcher where the verdict row already sets it, retires the regex.
