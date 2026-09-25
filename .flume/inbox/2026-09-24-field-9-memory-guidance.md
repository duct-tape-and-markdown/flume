# No memory guidance: three ticks and an eight-wide wave exhausted a 32 GB host

Downstream field report, 0.19: `maxTicks: 3` with `maxParallel: 8`, each
tick an agent CLI, node, and often a browser, and the host killed the
supervisor. This repo runs two ticks and a two-wide wave on 11 GB after two
OOM reboots. Asked: a note on per-tick memory, or a memory-aware budget.
Route the note to `docs/CHAIN-AUTHORING.md` beside the supervisor knobs:
agents and waves multiply, the judge suites serialize under the ship lock
so only the agents stack, and a measured figure per agent. A memory-aware
budget is a design fork for the human, not filed here.
