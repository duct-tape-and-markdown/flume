# Ruled: the supervisor delegates the grace to the tick child

Closes *Does a signalled loop's outer grace nest over the tick child's
own?* (open-questions, 0b18fc1). Ruling: the first option. The supervisor
signals the tick child's group and waits on the child unbounded; the one
timer in the tree is the child's, over the agent it can see. An outer
timer at the level whose job is to not release over a live writer is how
that level fails the job, and a same-number outer timer firing first
orphans the agent the inner escalation was about to kill.

The cost is named in `spec/loop.md` *The loop lock and the tip claim*: a
child wedged past its handler holds the run open, the operator kills it,
and stale-reclaim takes the claim — the story win32 already lives on. No
margin constant, no second knob.

What derives: `defaultTickRunner` drops its bound and waits on the child;
the announcement (A-SIGNALLED-RELEASE-ANNOUNCES-ITS-WAIT) names the child's
grace, not a bound of its own; the `tests[]` line is the agent that swallows
`SIGTERM` for the whole grace and is still killed under a loop.
