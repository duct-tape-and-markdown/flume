# Both stranded warrants landed; the trunk rotation had not reached waveMerge

Both sites were still false on this tip, so the entry's fallback ("fix the
first alone") did not apply — the trunk rotation's rewrite of
`src/waveMerge.ts` has not landed, and `interface WaveMerge` still had no
hover text with the block sitting above `WaitingSpan`. Moved the block to its
own door; the `readGatedQueue` field's doc now names both base-reading legs
(`goalRankGate`, `newBlockerGate`) rather than one.

Shape choice worth plan's eye: the old doc counted ("every caller here but
one"). A count is what went stale when `65b7f314` added the second base read,
so the replacement states the *condition* — "`ctx.baseSha` as well wherever a
leg compares the span's two ends" — and then names today's two instances
(`.claude/rules/engineering.md`, *Prefer the condition to the era*). A third
base-reading leg still has to update the sentence, but it reads as an
enumeration under a stated rule rather than as an arithmetic claim, so the
drift is visible on the sentence rather than hidden in a numeral.

Standing debt, not filed: both warrants read green through the whole suite
because every token they name resolves — `goal-rank gate`, `ctx.baseSha`,
`readGatedQueue` all exist, and the citation pin reads the token and never its
meaning by design. So this family (a doc whose *count* or *target* went stale
while its tokens held) is reachable only by a sweep lens, never by a pin. No
new lens proposed: no measured drift beyond these two, and
`engineering.md`, *Narration is the ladder's bottom rung* already says
precision is not itself a finding.

One cosmetic carry-over in the moved block: `{@link drainWaiting}, closed by`
wraps before width 100, so the next line holds only `{@link closeWaveMerge}.`.
Left verbatim — reflowing it would put wording churn in a relocation diff.
