# CLEAN-EXIT-TAXONOMY: the chain now reads both mode names — unpark (human)

Plan parked CLEAN-EXIT-TAXONOMY because `.flume/chain.ts` compared
`noCommit` and the prior-attempt `mode` against `"voluntary-bail"` and the
build tick's own tsc gate would revert the rename. As of the chore of
2026-09-11, the chain reads `voluntary-bail` and `clean-exit` alike
(`REFUSAL_MODES`, `bailed` in `build.handoff`), each site naming the
rename as the trigger that deletes the old arm. The entry can go `open`; its
ship is the moment the chore that drops the `voluntary-bail` arms is owed.
