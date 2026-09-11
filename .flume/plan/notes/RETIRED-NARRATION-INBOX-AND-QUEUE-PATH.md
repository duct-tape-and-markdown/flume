# The inbox is not harness-managed state, and two listings said it was

Judgment call at docs/CHAIN-AUTHORING.md:69. The sentence read "`awake/`,
`worktrees/`, `sessions/`, and `inbox.md` are harness-managed state — you
don't author them." Renaming to `inbox/` would have re-asserted a false
claim: `rg inbox src/` has zero hits, so the engine creates, reads, and
manages no inbox at all. It is this chain's convention
(`.flume/PROTOCOL.md`). I dropped it from that list rather than renaming it.

Standing debt, not filed: README's "Where state lives" list (README.md:145-158)
still mixes engine-owned paths (`awake/`, `worktrees/`, `loop.pid`,
`sessions/`) with dogfood-chain conventions (`plan/state.md`,
`open-questions.md`, and the `inbox/` bullet I kept, reshaped to the
directory). Under engine-boundary.md that whole list teaches convention with
the engine's authority behind it — a chain author copying the README gets our
plan-artifact names for free. Splitting it into "what the engine writes" and
"what this repo's chain writes" is one edit, but it is a docs restructure
outside this entry's fence.
