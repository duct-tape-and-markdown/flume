# One refusal, two sentences: which revert-refused line do both legs speak?

From THE-TWO-MERGE-LEGS-CARRY-ONE-SPAN's note. `src/mergeSpan.ts` now runs the
one revert-refused sequence for both legs, and to stay behavior-free it kept
both operator lines — so `SpanNarration.revertRefused` (`src/mergeSpan.ts:110`)
hands each leg **two** spellings of the same fact and lets it choose:

- `refusal` — the bare words `ResetKeepRefusedError` / `checkMergedTipUnmoved`
  raised.
- `failure` — the `StageFacts` the leg records, whose `message` for the
  unrevertable arm is `unrevertableMergeFailure`'s
  `<refusal> — afterMerge-failed commit <mergedSha> stays on trunk,
  unrevertable to <preCherry>` (`src/tickVerdict.ts:382`), already carrying
  both shas in full.

What the operator reads today:

- **wave** (`src/waveMerge.ts:727`) — `[flume] <tag>: revert of <merged8>
  refused (<failure.message>); commit stays on trunk, left for the operator;
  other entries continue`. Names `mergedSha` twice, short then full, and
  `preCherry` in full, because the recorded words already spelled them.
- **singleton** (`src/singletonTick.ts:414`) — `[flume] <phase>: revert of
  <merged8> back to <landedOn8> refused (<refusal>); commit stays on trunk,
  left for the operator`. Both shas short, each once, and the word
  `unrevertable` never appears.

Neither is wrong and nothing is hidden either way — both name the commit left
standing, so this is shape, not correctness (`engineering.md`, *A module is
one job*: "a request, site, or verdict shape spelled three ways by three
siblings has one vocabulary"). It is here rather than in the queue because the
fix is a wording choice on a line you read, and the note's author declined to
make it for you.

## The fork

1. **The singleton's shape wins.** Both legs speak `revert of <merged8> back
   to <landedOn8> refused (<refusal>)`, each leg adding its own tail (`other
   entries continue` for the wave). Then `revertRefused` takes `refusal` alone
   and `failure` leaves the narration surface — one field, one sentence, and
   the duplicated sha in the wave's line goes away. Cost: the wave's log stops
   quoting the recorded failure verbatim, so a reader correlating the log line
   against the `mergeOutcomes` row matches on the shas rather than on the
   string.
2. **The wave's shape wins.** Both legs speak the recorded `failure.message`,
   so the log line and the ledger row are the same words by construction, and
   `unrevertable to <preCherry>` reaches the singleton's operator too. Then
   `refusal` leaves the narration surface. Cost: the singleton gains full shas
   in a line that currently abbreviates every sha it prints, and the short
   `merged8` ahead of the quote is a repeat.
3. **Keep both, declare the divergence.** The two audiences differ — a wave
   line sits among siblings and wants the ledger's exact words for
   correlation; a singleton line is alone and wants brevity — so the two
   fields are the right depth, and the fix is a sentence at
   `revertRefused`'s doc saying so and citing it (*The fix lands at the
   mechanism*, "a divergence that genuinely is the right depth is declared and
   cited at the site"). The doc there already explains the two fields
   mechanically; what it does not say is that the difference is deliberate
   rather than inherited from the pre-fold legs.

**My read:** (1). The wave's line is the one with a defect in it — `mergedSha`
printed twice in one sentence, short and then full — and it is there only
because the sentence was composed around words that had already spelled the
shas. Correlation against the ledger row does not need string equality when
both carry the sha. (3) is the honest answer if you want the wave's log to stay
quotable against `mergeOutcomes`; it costs nothing to ship and is the only
option that needs no line to change.

Downstream either way: `SpanNarration.revertRefused` loses a field under (1) or
(2), which is a type change inside `src/mergeSpan.ts` with two callers and no
public surface.
