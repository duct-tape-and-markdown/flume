# The escape hatch is the engine's, not just this module's

`phase.promptArgs?.(ctx)` is invoked uncaught at `src/Dispatcher.ts:1957`
(singleton) and `:3281` (fanout entry). Any chain's `promptArgs` that throws
kills the tick with no verdict, no prior-attempt record and no worktree
teardown path of its own — the harness package just stopped being one of
them, every other consumer still is. That is the sibling of
GATE-THROW-IS-A-GATE-FAILURE one layer up: a throwing `promptArgs` has an
obvious classification already in the vocabulary (`render-refused`, whose
meaning is "the prompt never resolved"), so the engine could report it as a
fact instead of dying.

Also observed while bounding the renders: the inbox window's material is read
with `readFileSync` through `recordFiles`/`recordsPending` (`harness/records.ts`),
which is the same escape shape over the filesystem rather than git. Untouched
here — the entry's `per` bound is what `touchedPast`'s fail-open promised,
and nothing promises that one.
