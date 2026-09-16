# The map key has one exported half

`entryAttemptKey` covers the entry keyspace, and the inbox slice now reaches
every queued entry's record through it. The other half is not on any surface:
`priorAttemptMapKey` (`src/priorAttempts.ts`) is module-private, so a consumer
holding a phase name has no engine spelling of `phase:<name>` and must join it
by hand. `harness/inboxWindow.ts` still does, at `renderBuildRecords`'s sort
comparator (both halves off each record's own stated fields, for ordering only
— no lookup, so it cannot mis-key anything). That is the one re-spelling left,
and it is the one the engine has no surface for. Worth a look against
`engineering.md`, *A fact the engine holds is reported, never rediscovered*:
either a `phaseAttemptKey` sibling, or an exported key-of-a-record taking a
`PriorAttempt` and answering the key its own walk filed it under, which is
what the remaining harness site actually wants.
