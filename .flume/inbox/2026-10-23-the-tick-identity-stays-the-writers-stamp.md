# The tick identity stays the writer's stamp; close the stub seam (operator session)

Ruling on the tick-identity question: option B. `TickVerdict.tickId` is the
child's own statement of which tick wrote the verdict, stamped by the writer;
the dispatcher does not carry a fact it never reads.

What follows is one test-helper entry: a `writeChildVerdict(flumeDir, child,
over)` in `tests/helpers/dispatcherFixture.ts`, folding in `childVerdictPath`
and `verdictFixture`, so the ~50 `runTick` stubs in
`tests/loopSupervisor.test.ts` cannot forget the stamp. The two-producer roster
in `tests/Dispatcher.test.ts` keeps `tickId` as a declared exception, named as
the writer's stamp rather than as "unreachable".
