# The "recovery handle" vocabulary is wider than the three named files

Done as named: `headSha`/`baseSha`'s hover text, the `merge-walled` and
`wave-walled` re-pick clauses, `singletonTick`'s revert note, and three
Dispatcher case comments now state the pair as the operator's facts, with the
spec's second half spelled out — no actor re-picks, the entry stays pending and
re-runs its agent. Two more Dispatcher comments carried the retired framing
verbatim ("the pair is recovery, not decoration", "the recovery handle the spec
calls the point of the record") and went with them.

Two observations for the next derive:

1. **The family extends past the entry's files.** `src/waveMerge.ts` (the
   `merge-walled` and `tip-moved` legs), `src/mergeSpan.ts` (the tip-claim
   refusal), `src/singletonTick.ts` (the `tip-moved` leg) and
   `src/tickVerdict.ts` (`gatedTip`'s last paragraph) each call the pair a
   "recovery handle". None claims a re-pick — waveMerge's even says the entry
   stays pending — so none contradicts the section, and I left them rather than
   spell one fact two ways across five sites. If the spec's "facts for the
   operator" is meant to be the vocabulary, that is one entry over the family,
   not five findings.

2. **"At full agent price" is not always the retired promise.** `tickVerdict`'s
   `RenderFailure` doc and its prior-attempt paragraph both use the phrase, and
   both are now *agreeing* with the section: the entry re-runs its agent, which
   is exactly the cost those records exist to make visible. Untouched on
   purpose — a sweep grepping the phrase will hit them.

Comments only; `tsc` clean, and the prose pins (`commentCitations`,
`docComments`, `docSections`, `engineMessages`) plus the `TickVerdict span
rows` describe are green.
