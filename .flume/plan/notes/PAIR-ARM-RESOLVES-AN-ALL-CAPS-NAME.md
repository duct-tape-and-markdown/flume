# The pair arm needed the judged-set filter widened too, and 18 sites landed

Widening `isIdentifierSubject` alone was not enough. `scanned` was composed
as `spans.closed.filter((site) => isSubject(site.text))`, so an all-caps span
the pair arm admitted drew a home and was then judged by nothing —
`pairs`, `resolved` and `findings` all read off `scanned`. The filter now
admits a span the pair arm claimed (`tests/helpers/commentCitations.ts`).
Worth plan knowing: the pair arm and the standalone subject rule were coupled
through that one filter, so any future widening of one arm has to be read
against it.

The entry predicted 13 sites; 18 landed, all resolving:
`DEFAULT_KILL_GRACE_MS` x3, `EX_MOUNT_DEAD` x4, `EX_TERMINAL_MISCONFIG`,
`DEFAULT_STATE_ROOT`, `CORE_ENTRY_FIELDS`, `STATE_ROOT_NAMES` x2,
`NO_COMMIT_MODES`, `SPAWN_OUTPUT_CAP_BYTES`, `RUNTIME_IGNORES`,
`FAILURE_STAGES`, `DEFAULT_ABORT_THRESHOLD`, `DEFAULT_QUARANTINE_SCOPE`.
No site reds, so nothing to fix at a citation.

Underscores: `SEGMENT` refuses them, so the widening needed its own charset
(`SCREAMING_SEGMENT`) rather than a loosened `SEGMENT` — the identifier arm
still reads names the identifier charset spells. Every other fence the
standalone rule sets stands in a pair; only the capitals one is lifted.
