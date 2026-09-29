# The hook throw is a narrower divergence than the roster's other two

Shipped as written: `persistHookRefusal` (`src/tickAttempt.ts`) now spreads
`stageFailureFacts(wall)`, so the trim has one derivation, and the trailing-
newline case keys to the trimmed spelling.

One wording call worth plan's eye. The roster in `stageFailureFacts`
(`src/tickVerdict.ts`) was scoped to "a stage whose key is *not* its own
message" — true of the gate (folds the gate name in) and the render refusal
(reads `RenderRefusal.signature`). Post-fix the hook throw does not fit that
scope: its key *is* its message, both `wall`. Its divergence is one level
out — the `wall` it reports is narrower than the `render-refused` record it
wrote beside it, which carries the frames. So the roster lead now reads "a
stage whose pairing is *not* its own full text", which covers all three. If
a later entry re-reads that sentence expecting the old scope, this is why it
moved.

Second: the entry's `files.edit` predicted the `PROMPTARGS-THROWS` wave at
`tests/Dispatcher.test.ts:22773` as the pin's neighbour, and that is where it
landed — but the pin could not reuse that wave, because that case asserts the
on-disk record and the key is only on `TickVerdict.renderFailures`. The new
case is its own fanout over `BARE-THROW`/`NEWLINE-THROW` reading the verdict.
Nothing to fix; noting it because the prediction read as "extend the wave".

No standing signature fixture moved: the only walls in the suite are
`hook read a half-written file` and the `loopSupervisor.test.ts` hand-written
pair, none with trailing whitespace.
