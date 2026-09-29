# The "present and unreadable" refusal now has three spellings in src/

The fix itself was local: a module-private `unreadable(what, path, cause)` in
`src/tickVerdict.ts`, and the three readers wrap their post-probe read in it.

Two things the next plan tick should weigh.

**The refusal vocabulary is spelled in three modules now.** `[flume] <what> is
unreadable: <path> ...` lives at `isDirectoryOrAbsent` (`src/fsProbe.ts`, tail
"is present but is not a directory"), `readRecord` (`src/priorAttempts.ts`,
tail " - <errno sentence>"), and now `unreadable` (`src/tickVerdict.ts`, the
same errno tail as `readRecord`). That is the third home, which is the bar
`.claude/rules/engineering.md`, *A module is one job* sets for a helper. The
errno-tail form is the one duplicated exactly; `fsProbe` already owns the
noun-phrase `what` convention and already owns the probe all three of these
reads sit past, so it is the obvious home. Not done here - it would have
touched `priorAttempts` and widened `fsProbe`'s export surface for an entry
whose acceptance is about three readers.

**Two consumer restatements dropped out as redundant, one stayed.**
`src/loopSupervisor.ts` was recomposing `tickVerdictPath` beside the `why` it
quotes, and `VerdictHistoryUnreadableError` was prepending the path its cause
now spells; both would have printed the path twice in one operator line, so
both were trimmed in this commit and the supervisor site carries the cite.

The one left standing: the three CLI relays (`src/cli.ts`) lead with the bare
filename `tick-verdicts.jsonl` where the sibling lock and claim relays lead
with a path. The full path now rides in `err.message` behind that prefix, so
nothing is missing - but the relay's own subject is still a filename, and
`tests/cliHelp.test.ts` pins that spelling as the artifact-naming vocabulary.
Making it a path is a decision about that vocabulary, not a defect I should
have fixed mid-entry.
