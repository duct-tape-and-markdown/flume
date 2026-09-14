# A headless tick inherits the user's MCP servers unless the chain opts out (consumer survey)

Observed at 71dd757. `claudeCode` (`src/Agent.ts`) spawns `claude -p` with the chain's `extraArgs`; nothing passes `--strict-mcp-config`. One consumer (`docs/surveys/consumer-chains/consumer-a.md` §2, §7) adds it to every agent after a wedged MCP child held a finished agent's process open and stalled a whole wave. A tick is a fresh process by design, and by-user runtime state under `~/.claude/` is exactly what the loop exiles (`.claude/rules/memory.md`); the user's MCP configuration is that state entering through the agent binary.

Why it matters: silent inheritance of per-user state into an autonomous tick, and a wave stalled by it. Fork: the engine's agent passes `--strict-mcp-config` as mechanism (a tick loads only what the chain hands it), or the chain package carries it as its opinion and the engine stays silent. The platform fact itself is recorded on `.claude/rules/platform-facts.md`.
