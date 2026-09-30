# The merge stage's carry landed; its disk verdict stays unpinned

The reachable lever turned out cheaper than the entry's suggestion: a
directory standing where a pick's merge marker file goes makes
`writeMergingMarker` refuse structurally, on every host, with no gate and no
prior-attempt slot involved. Both new cases drive one wave through it, so the
arm is a real merge-stage throw rather than a stubbed one.

Two things the next plan tick may want:

1. **No disk-verdict case for this arm.** `tests/Dispatcher.test.ts` pins the
   slot-leg carry twice over — once on the `TickResult`, once on the verdict
   the CLI writes (`a wave whose slot leg throws outside a ledger read still
   writes the settled wave's verdict`). The merge-stage carry is pinned only
   on the `TickResult`; nothing reads it back off
   `.flume/tick-verdicts.jsonl`. Symmetric coverage is a small entry.

2. **The operator line for the base carry rode along.** `tickExitCode`'s
   widest arm already admitted any `WaveCarriedThrow` with no ledger class,
   but its `phrase` said "a throw out of one of its own slot legs" — false the
   moment the merge stage joined it. Widened to "one of its own legs" with the
   merge-stage cause named, and `docs/CLI.md` moved with it because
   `CLI-DOC-TICK-EXIT-CAUSES-PINNED-PER-ARM` reads the page under the arm's
   own phrase. Worth knowing that arm's prose is now the only place the two
   base-carry origins are distinguished for an operator; the verdict summary
   says which ("the merge stage threw" / "a slot leg threw").

Noted, not filed: `mergeError` keeps the *first* throw (`??=`), so a
`foldUncarriedAttempt` throw behind a walled wave is dropped. Consistent with
`slotError` beside it and with the settle-then-leave shape, so it reads as
deliberate — but nothing declares it at either site.
