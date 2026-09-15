# The agent's own group leaves the supervisor's escalation one rung short

`src/Agent.ts` now spawns the agent in its own process group so a signalled
`flume tick` can take its tree down. Consequence on the loop path: the
supervisor's group signal no longer reaches the agent (a different group) — the
tick child's own handler forwards it, which is why this entry installs those
handlers on both paths.

Both levels bound the wait by the same chain `killGraceMs`, and the
supervisor's timer starts first: at T+grace it SIGKILLs the tick child while
the child's own escalation is still ~ms away. An agent that swallows SIGTERM
for the whole grace is orphaned under a loop, where the old shared group killed
it. The common case is strictly better — the supervisor's release now waits on
the agent's real exit, which it never did — but the pathological one needs a
decision: does the outer grace nest (supervisor waits longer than the level
below), or does the supervisor tell the child "your group is mine" so the child
only waits? spec/loop.md's "the handler signals that group ... so the release
is the whole tree's" now reads one group short.
