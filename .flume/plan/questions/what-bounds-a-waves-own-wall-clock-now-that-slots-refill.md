# The wave's second stop condition: does the engine owe one, or does the sentence name the agent's?

`spec/worktrees.md`'s opening paragraph (`:5`-`:8`) states: "the tick ends when nothing is pickable **or its
budget says to put the wave down**", citing `spec/loop.md`, *The ship lock and the
worktree lock — sibling ticks take turns at git* and `spec/harness.md`, *A tick
puts work down*.

Measured this tick, the engine's wave-level stops are exactly two, and neither
is a budget:

- nothing pickable — `nextDisjointPick` answers `undefined`;
- the **run's teardown** — `fillSlots` (`src/waveTick.ts:375`) returns early on
  `leg.attemptCtx.stopSignal?.aborted`, and that signal is the operator's
  SIGINT / stop flag (`src/cli.ts:1028`, `:1608`), not a clock.

Nothing else bounds a wave's own wall clock. `tickTimeoutMs` is per **agent
invocation** (`spec/chain.md`, *Supervisor policy is a chain-overridable default*);
`maxTicks` bounds concurrent supervisor children (`spec/cli.md:28`); `--max` /
`DEFAULT_TICK_BUDGET` counts tick **processes**. Before the freed-slot refill
landed a tick ran one batch, so a tick count was a rough proxy for wall clock;
it is not one now — one tick drains the whole pickable queue, however long that
takes.

## The fork

**(a) The sentence already names the agent's put-down, and nothing is owed.**
The cite is `spec/harness.md`, *A tick puts work down*, which is the **agent**
declaring a segment done and writing a continuing note — per entry, not per
wave. Read that way the engine holds both conditions today: an entry ends when
its agent puts it down, and the wave ends when nothing is pickable. Nothing
ships. Cost: the phrase "its budget says to put the wave down" reads as a
wave-scoped engine obligation, and a later derive tick is as free to read it
that way as this one was.

**(b) A wave-level wall-clock budget is a real knob.** `supervisorPolicy` is
where it would live — a chain-overridable default, never fixed behavior
(`.claude/rules/engine-boundary.md`, *Routing rule (plan, build, and interactive sessions)*), read once per run beside
`abortThreshold`. A wave past its budget stops refilling; entries in flight
settle and the wave leaves with them, which is the disposition `fillSlots`
already takes on the teardown signal, so the mechanism is a second predicate on
one guard. Cost: nobody has declared this knob or asked for it, and an engine
default would be taste with the engine's authority behind it.

**(c) Narrow the sentence to the stop the engine holds.** "the tick ends when
nothing is pickable, or when the run is torn down" — and, separately, an entry
ends when its agent puts it down. Closes on a spec edit. Cost: admits a wave
running an arbitrarily long queue under no clock of its own, where the only
brake is the operator.

## Why this is the human's

(b) invents a policy knob no consumer declared, which the boundary rule fences
to a ruling. (c) is a `spec/` edit, this layer's to ask for and not to make.
(a) is the reading I lean to — the cite points at the agent's put-down, and
`spec/worktrees.md` specifies the refill in the same paragraph, so draining the
queue in one tick is the stated intent rather than a regression — but the
phrase is doing the work of two readings and the next derive tick inherits the
ambiguity either way.

Recorded off note THE-FREED-SLOT-PULLS-THE-NEXT-DISJOINT-ENTRY, item 1: the
build tick that shipped the refill wired the teardown stop and declined to
invent a budget, which is the right call and leaves this open.
