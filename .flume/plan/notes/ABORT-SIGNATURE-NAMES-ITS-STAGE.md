# The abort's reported shape widened past what spec/loop.md states

`SuperviseResult.repeatedFailure` now carries `stage` beside `signature`
and `count`, and `loopCompletionSummary` renders it. spec/loop.md
*Repeated identical failures — quarantine, then abort* still says the run
"aborts non-zero with a summary naming the repeated signature" — true but
now narrower than the surface. A human may want that sentence to name the
stage too, the way the quarantine leg one paragraph up already does
("logged distinctly (tag, stage, failure signature)").

Second observation, out of this entry's scope: `flume loop --help` and
`flume job --help` still spell the backstop's threshold as the literal
"3 consecutive ticks", while `supervisorPolicy.abortThreshold` is
chain-overridable. That is the same defect shape this entry's `per` cites
— a value the engine holds, restated as a constant in prose that a chain
can make wrong — and tests/cliVerdict.test.ts already pins the summary
against exactly that hardcoding ("names the real repeatedFailure.count,
not a hardcoded 3"). The help text has no such pin.
