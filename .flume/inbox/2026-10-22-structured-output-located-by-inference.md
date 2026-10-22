# A tool's structured report is found by scanning stdout instead of by the location the runner told it (downstream consumer report, class)

**Kind.** The runner infers where its input is rather than stating it.
`parseReport` (`harness/vitestRunner.ts`) searches stdout for the first
`{"numTotalTestSuites"` amid whatever plugins printed — pattern-matching
output the harness did not author (`engine-boundary.md`, *Told, not
inferred*). It holds only while the tool keeps printing there.

**Members.**
- Field instance (consumer-measured, not reproduced here — this repo pins
  vitest 2.1.9): vitest 5's json reporter writes `.vitest/json/output.json`
  by default, so the runner refuses "no JSON report"; the consumer wraps
  vitest to cat the file.
- Census: the script runner, CI lanes, and the agent stream all read a
  channel the declaration or the tool's documented contract names — not
  members. The vitest runner is the one inferred location.

**Owning artifact.** The vitest runner: pass `--outputFile` at a path the
runner owns and read it; the stdout scan and its heuristic go
(`engineering.md`, *A fix ships the test that would have caught it* — the
case is the real reporter writing to the told path through the real reader).
The exit-status-beside-report refusal (`platform-facts.md`, *vitest's JSON
reporter can claim success over a non-zero exit*) must survive the move.
