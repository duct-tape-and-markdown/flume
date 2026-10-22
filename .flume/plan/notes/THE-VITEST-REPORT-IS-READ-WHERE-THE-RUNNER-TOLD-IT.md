# The same inferred-report-location shape still stands in the cascade example

Shipped: both vitest operations append `--outputFile=<file>` beside
`--reporter=json`, reading the report out of a temp file the runner mints and
removes per run (`withReportFile`, `harness/vitestRunner.ts`). The stdout scan
for `{"numTotalTestSuites"` is gone. Measured on vitest 2.1.9: an absolute
`--outputFile` is honoured, nested dirs created, and the report is written on a
non-zero exit too, so the success-over-non-zero refusal survives — but its
message now restates the report's own claim (`claims success: N passed, M
failed`) rather than quoting a stdout tail, since the report no longer passes
through stdout at all. Two refusal arms now: nothing written at the told file,
and bytes there that do not parse.

For plan: `parseTestReport` (`examples/cascade-chain.ts`) still carries exactly
the retired shape — `details.indexOf('{"numTotalTestSuites"')` over a
`shellGate`'s captured output, with the same "found rather than assumed"
comment the runner had. It is the consumer the sweep's *Consumer restatement*
lens reads (`.claude/rules/posture-sweep.md`), and it cannot be fixed the way
the runner was: a chain can tell its own `shellGate` where to write only by
appending `--outputFile` to the args it declares and then reading that file
itself, which nothing on the gate surface helps with — a gate hands the chain
captured `details` and no place to put a file. Either the example appends the
flag and reads the file by hand (a chain-local copy of what the runner now
owns), or the honest answer is that an entry-tests gate wants the runner, not a
shellGate. Worth an entry or a question rather than a silent edit from here.

Unchanged by design: `scriptRunner`'s reader stays over stdout — a declared
reader is already told where to look.
