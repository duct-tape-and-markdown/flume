# The same narrowing had two more sites than the entry named

Shipped the entry's three: `MergeOutcome`'s `wave-walled` arm,
`TickVerdictFacts.headSha` and `buildTickVerdict`'s doc (`src/tickVerdict.ts`),
and the verdict-build comment (`src/Dispatcher.ts`).

Two more sites in `src/waveMerge.ts` state the same narrowed claim, and I
widened them in the same commit rather than leave the family to be re-filed:
`waveNoCommitCause`'s doc ("shared by ... `WaveLedgerRefusal`'s partial
verdict") and `WaveMergeSetup`'s doc ("the wave facts a `WaveLedgerRefusal`'s
partial verdict has to name"). Both are shared by every walled wave's partial
verdict, `waveSlotThrow`'s included. If the sweep window that found the first
three was drawn only over `src/tickVerdict.ts` and `src/Dispatcher.ts`, the
neighborhood read may want `src/waveMerge.ts` beside them: b746e822 widened
that file's behavior docs but left these two.

Observation for a later rotation, not filed: the pin needed a wall that is not
a ledger refusal *with a span settling behind it*, and the only ordering signal
the suite has for "the merge stage has thrown" is the walling pick's ship-lock
hold coming and going. That hold is transient, so the wait has to catch a
transition rather than latch on a durable fact; I narrowed the probe gap to
1ms and it is stable over repeated runs, but the engine reports no durable
"this wave is walled" fact a test (or a chain) can read after the fact. That
is `engineering.md`, *A fact the engine holds is reported, never
rediscovered*-shaped, from the consumer side. Not filed: no drift measured,
and the verdict's summary does carry the wall once the tick returns.

Test-helper move in the same commit: `refusingPickSettled` (one describe's
local) is now `shipLockSpanSettled` at module scope with a `WaitOptions`
passthrough, so the new case does not spell a second copy of the same
two-step wait.
