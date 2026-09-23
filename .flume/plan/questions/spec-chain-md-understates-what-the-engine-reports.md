# `spec/chain.md` understates two things the shipped code now states

Two build ticks landed doc comments that say more than the spec section they
cite. `spec/` is outside every autonomous phase's fence, so both sentences are
yours or they stay unwritten while the code carries them.

## 1. *What a hook receives* does not name `gateFailures`

The `TickResult` bullet enumerates `pickableAfter`, `flumeDir`/`configDir`,
`baseSha`, `entries`, and names `provisionFailures` in passing under `entries`.
`TickResult.gateFailures` shipped in `666aa72c` and is documented on
`src/Phase.ts`; the spec enumeration does not mention it, so the shipped type
is wider than the section describing it.

`mergeFailures` is queued to join it (`TICK-RESULT-REPORTS-THE-WAVES-MERGE-FAILURES`),
which is why this is one sentence to write rather than two: once that entry
lands, the section can say the result carries all three stage-failure classes
the verdict does, and stop enumerating them one at a time.

**Options.** (a) Add a `gateFailures` bullet now and a `mergeFailures` one
after that entry ships. (b) Wait for the entry and write one bullet naming the
three classes together — cheaper, and the enumeration stops being a list that
drifts per field. (c) Say in the bullet that the result carries the verdict's
stage-failure records and point at the type — least to maintain, but the spec
stops being readable without the `.d.ts`.

I would take (b): the asymmetry is the thing worth stating, and it is about to
be gone.

## 2. Nothing states that a base-red blames the span in every shell-backed gate

*What a gate returns* ends its `blamesSpan` bullet at "Absent or `true` is
today's behavior". *The builtin gates* says of `shellGate` only "Verdict is
exit code alone". Neither says the consequence: `blamesSpan` is set in exactly
one place in the package (`namedLinesGate`, `harness/judgeGate.ts`), no `src/`
builtin sets it, and a shell-backed gate therefore cannot disown a failure it
did not cause. A suite already red at the base blames whichever span happened
to be gated.

`GateResult.blamesSpan`'s doc comment (`src/Gate.ts`) now names this; the spec
does not. What bounds the damage is the consecutive-identical-failure backstop
(`spec/loop.md`), and that bound holds only while `abortThreshold` is finite
**and** the wave's failures share a signature — true for `tscGate`/`vitestGate`,
whose `failHint` is a constant, and false for a chain whose shell gate puts
per-entry text in `message`. Nothing detects that case.

**Options.** (a) One sentence on *The builtin gates* naming the asymmetry and
the backstop that bounds it — spec catches up to the doc comment, no code
moves. (b) Also state the signature precondition as a caveat a chain author is
expected to honour — honest, but it is prose standing in for a check nothing
performs. (c) Give `shellGate` a `blamesSpan` knob so a chain can declare it —
that is a capability, not a convention, and it would pass the
second-implementation test; but no consumer has asked, so it is surface with
no consumer today.

I would take (a). (c) is the right shape if a chain ever needs it and should be
filed then, not now.

Filed from the notes on `TICK-RESULT-REPORTS-THE-WAVES-GATE-FAILURES` and
`GATE-DOC-DECLARES-THE-SHELL-BLAME-ASYMMETRY`.
