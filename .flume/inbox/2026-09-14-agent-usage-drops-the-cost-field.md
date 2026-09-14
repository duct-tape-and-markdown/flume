# AgentUsage decodes the result event and drops its cost (consumer survey)

Observed at 71dd757. `src/Agent.ts:662` reads `total_cost_usd` off the `result` event to render the terminal line, and `AgentUsage` (`src/Agent.ts:64-76`) carries model, turns, duration and four token counts — no cost. Two of five surveyed consumers (`docs/surveys/consumer-chains/consumer-a.md` §3 #6, `consumer-b.md` §3 #3) re-scan the agent's raw stdout for that one field, each with a comment saying it is the only reason they still look at raw output. One annotates the whole telemetry block as "dies when flume#10 lands".

Why it matters: `engineering.md`, *A fact the engine holds is reported* — the engine parsed the number and kept it in memory. A `costUsd?: number` on `AgentUsage`, read at the same decode, retires both scans.
