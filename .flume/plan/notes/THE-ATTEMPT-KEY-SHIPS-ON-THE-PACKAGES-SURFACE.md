# The phase keyspace still has no keyer a caller can reach

Shipped both keyers from `src/index.ts` and pointed the two docs pages that
taught hand-composition (`docs/CHAIN-AUTHORING.md` §5,
`docs/MIGRATING-0.16.md` §3) at them.

Observed while doing it: the surface now answers for an entry you hold and
for a record you hold, but a consumer looking up a *singleton phase's* record
by name still composes `phase:${phase.name}` itself — the only engine
spelling for that half is `priorAttemptMapKey`, which takes a
`PriorAttemptRef` and is module-local. `docs/MIGRATING-0.16.md` still teaches
that composition, and the acceptance line ("nothing outside the engine has to
compose `<keyspace>:<slug>`") is only true for the two halves that shipped.
Either a `phaseAttemptKey(phase)` closes it on the same terms, or the ref
keyer itself goes public; both are the same section's call
(`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
rediscovered*). Filing it rather than widening the entry.
