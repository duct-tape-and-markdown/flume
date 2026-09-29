# `FLUME_TIP_CLAIM_HELD` set to a value that names no pid refuses exit 1, and no spec sentence says so

From build note THE-SUPERVISOR-CLAIM-HANDOFF-IS-DECODED-ONCE, item 1. The entry
shipped one decode (`decodeTipClaimHandoff`, now `src/cliRunContext.ts:45`)
answering the pid, the acquire and `supervisedRun`, and a present value that is
not a decimal pid now refuses exit 1 before the Dispatcher is constructed — so
`render`, `tick` and `loop` all take it. The behavior is ratified by that entry's
acceptance, not by a spec line.

Re-verified this tick, against the tree as the CLI verb split left it.
`spec/loop.md`, *The loop lock and the tip claim* states the handoff in its
*Scope* bullet (`:183`) — "the runner tells the child
(`FLUME_TIP_CLAIM_HELD=<pid>` in the child env) rather than the child probing
pids and inferring parentage" — and names two exit-1 refusals beside it (a live
holder, *Acquire*, `:157`; detached HEAD, `:189`). A **present value that names
no pid** is stated nowhere on the page. The refusal is real:
`tipClaimHandoffRefusal` (`src/cliRunContext.ts:57`) composes it and
`tests/cli.test.ts:3185` drives it through the real CLI. So `spec/` and `src/`
disagree by omission, and `spec/` is yours (`.claude/rules/spec-plan-build.md`).

## The narrow ask

One sentence in that section's *Scope* bullet, beside the bare-tick refusal it
already carries: a `FLUME_TIP_CLAIM_HELD` that is present and is not a decimal
pid refuses before any work, naming the var, the value and the remedy.

## The exit code is not a fork — the research closes it

The note asked whether `1` or `78` (`EX_TERMINAL_MISCONFIG`) is right, on the
grounds that a loop child exiting 78 fail-fasts the supervisor, "which is
arguably the right shape for a malformed env every later child would inherit
too". **That premise does not hold, measured on disk:**
`defaultTickRunner` (`src/loopSupervisor.ts:1062`) sets
`env.FLUME_TIP_CLAIM_HELD = String(process.pid)` **unconditionally** on every
child it spawns, so no loop child can ever observe a malformed value — the
supervisor overwrites whatever the operator exported. The only process that can
see one is a bare `flume tick` reading the operator's own shell.

That is exactly the lane `1` already names: *Exit codes — the run never lies to
CI* gives `flume tick` `1` for "harness error, HEAD detached, or another live
process holds the tip claim", and both sibling tip-claim refusals are `1`. And
`78` would not fit as written — Axis C is "the chain resolved but declares an
inconsistent world", while this refusal fires *before* the chain resolves and the
inconsistency is the environment's, not the chain's; `TickOutcome.terminal.kind`
would need a new member, "each arriv[ing] with its own spec text".

So the recommendation is to ratify `1`, and the sentence has no decision in it
beyond wording. Saying so explicitly is still worth a line, because the next
producer reading three exit-1 refusals with only two stated will file this again.
