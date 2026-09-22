# scratchRepo's own header now miscounts its consumers

`makeScratchRepo`'s doc (`tests/helpers/scratchRepo.ts`) opens "One home for
a fixture five suites spelled five times". After this adoption three suites
call it — `cliHelp`, `cli`, `cliStateDirs` — and the four the entry ruled out
(`runtimeIgnores`, `examples.integration`, `tip-claim.integration`,
`loop-process-boundary.integration`) are a different fixture shape, not
unadopted copies of this one. So the header states a count that was never
this helper's consumer set and is now wrong in both directions. Left as-is:
rewriting the extraction rationale is a call this entry did not name. Worth
one line of a later rotation — the fix is to state the job, not the tally.

Mechanical detail for the queue: `exec` dropped out of `cliStateDirs`'s
`subprocess.ts` import entirely once the local maker left; `cli.test.ts`
still uses it for its seeding helpers. No other import moved, and the two
`// no .flume/chain.ts written` trailers moved above their statements to keep
the callsites inside the surrounding line width.
