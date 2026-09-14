# Three names, three rules, for one adjacent fact

Shipped as `AgentInvocation.entryTag`. Naming was the only judgment call,
and the tree now carries three spellings of "which entry is this":

- `TickVerdictInvocation.tag` (Dispatcher.ts) — set under fanout, absent
  under singleton.
- `AgentInvocation.entryTag` (Agent.ts, new) — same rule, different name.
  Named `entryTag` because `tag` on an Agent-module interface already
  means the renderer's line prefix (`TerminalRendererOpts.tag`), and
  `inv.tag` beside `opts.tag` invites a chain to misread one for the other.
- `WorktreeSetupContext.entryTag` (Phase.ts) — same *name* as the new
  field, different rule: it is the worktree key, so it falls back to the
  phase name under singleton rather than going absent.

The last pair is the hazard: identical name, divergent absence semantics,
two hops apart on the chain surface. Both doc comments now state the
divergence — that is the prose rung; a rename or a pin is the rung up.
Plan's call whether it earns an entry.

Minor: `invokeAgent` is now 8 positionals, last two optional. The next
field wants an options object, not a 9th.
