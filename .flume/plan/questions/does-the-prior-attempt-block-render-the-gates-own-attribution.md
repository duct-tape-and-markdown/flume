# Does the `<prior-attempt>` block render the gate's own attribution?

A `gate-revert` record carries three fields the rendered block never shows:
`verdict`, `failingFiles`, and `blamesSpan`, all three stamped by
`buildGateRevert` (`src/priorAttempts.ts:795`). `modeLines`' gate-revert arm
renders `when`, `gate`,
`message`, `details`, `diffStat` and stops (`src/Prompt.ts`).

That matches the spec exactly — `spec/loop.md`, *Prior-outcome feedback to
the retrying tick* enumerates the gate-revert block as "which gate phase
reverted, the gate's `name`, its one-line `message`, its full `details`, and
a stat digest". So the engine is conformant and this is not an entry: the
list is the contract, and widening it is a spec edit.

**Why it is worth your ruling rather than a debt line.** One of the three is
not just absent, it is contradicted. The block opens, unconditionally:

> A previous attempt at this work committed and was REVERTED by a gate.
> Read the failure below and change your approach — do not blindly
> reconstruct the reverted change.

`blamesSpan: false` is the gate declaring that failure *is not the gated
span's* — "the suite was red at the base, or a resource the span never
touched refused" (`spec/chain.md`, *What a gate returns*). The engine already
honours it everywhere it holds a mechanism: no quarantine key
(`src/waveMerge.ts:884`), no `blamedOn` on the record
(`src/tickAttempt.ts:768`). The prompt is the one place the disowned blame
still lands, and the agent is the only reader who cannot see the field.

This is live on this repo, not hypothetical: `harness/judgeGate.ts:133`
returns `{ verdict: "base-red", blamesSpan: false }` when the suite was
already red at the base. A build tick reverted by it is told to change an
approach the judge said was never the problem.

## The fork

1. **Widen the block for all three.** Render `verdict` and `failingFiles`
   when present, and let `blamesSpan: false` replace the opening
   instruction ("the gate declared this failure not your span's; the revert
   still happened"). Cost: a spec edit to that bullet, and the block grows
   for every revert. Gain: the retrying agent stops pattern-matching
   `message` for a discriminant the chain already wrote down, and stops
   being misdirected on base-red.
2. **`blamesSpan` only.** The narrow fix — the other two are legible from
   `message`/`details` often enough, and a chain wanting them has
   `promptArgs` + `TickContext.priorAttempts` (`spec/loop.md`, same
   section). Smallest spec edit; leaves the "keys on *why*" reader
   (`src/Prompt.ts:209`) a chain-side reader only.
3. **Nothing changes; the block is deliberately the chain's to widen.** The
   record is on `TickContext.priorAttempts` and `promptArgs` can render
   whatever it wants. Then the opening instruction is still wrong under
   `blamesSpan: false` and wants a spec sentence saying the chain owns that
   correction — otherwise every chain rebuilds it.

My read: (1), with (2) as the floor — the misdirection is the part that
costs an agent a wasted tick, and the other two are the same fact the engine
already holds.

## Downstream of the ruling

`tests/Prompt.test.ts`'s per-mode case now reads each fixture's own record
fields and asserts every one lands in the block
(THE-PER-MODE-PRIOR-ATTEMPT-CASE-ASSERTS-THE-FIELDS-ITS-TITLE-CLAIMS). It is
a generator: under (2) or (3), a gate-revert fixture gaining `verdict` or
`failingFiles` reds until the arm renders it. That is the intended direction,
but it means the ruling decides what a future fixture may carry, not just
what the block prints.
