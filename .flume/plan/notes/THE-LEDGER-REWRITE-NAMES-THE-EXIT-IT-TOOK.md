# The rewrite's `tipMoved` folded into the exit it now names

`PendingRewriteResult.tipMoved` is gone, not kept beside the new `exit`
field: a boolean exactly equal to `exit === "tip-claimed"` is one truth
stored twice (`.claude/rules/engineering.md`, *Derived state is computed,
never restated beside its source*), and the same page is this entry's own
`per`. The acceptance's "the tip-claim report unchanged" holds where an
operator or a chain reads it — `WaveMerge.tipMoved`, `TickVerdict.tipMoved`,
and the warn line at `src/waveMerge.ts` are byte-identical; only the internal
result field changed vocabulary. If plan meant the field literally, that is a
re-file, not a regression.

Two things a next tick may want:

1. The result is now a discriminated union (`commitSha: string` on the
   `committed` arm, `undefined` on the three no-commit arms), so the merge
   stage carries no `!` and no "sha implies committed" comment. Any future
   consumer of `commitPendingUpdate` gets that narrowing for free.
2. `PendingRewriteExit` (the four-value set) stays unexported: the export pin
   (`tests/exportConsumers.test.ts`) reds an exported alias whose only
   cross-module reach is through a second alias, so `PendingRewriteNoCommitExit`
   is the exported name and the four-value set is reached through
   `PendingRewriteResult`'s arms. Worth knowing before a sibling entry exports
   a set-plus-subset pair the same way.

Operator wording: the footprint-only no-op line was "footprint already
recorded, no commit: TAGS" and is now "footprints for TAGS; pending already up
to date, no commit" — the subject and the cause are now composed separately
(`noCommitLine`, `src/waveMerge.ts`), so the dock line and the no-op line can
never swap. No test asserted either string.
