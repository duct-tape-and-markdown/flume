# The queue on disk no longer parses, and every goal now owes a rank

**Blocker for the next loop start.** All 12 entries in `plan/pending` still
carry `priority`, which left the core in
THE-ENTRY-CORE-CARRIES-KIND-AND-PARENT-AND-NO-RANK. The core is strict, so
`parsePendingQueue` refuses each of them. Today's supervisor was launched
before that commit and its loaded `src/` still accepts the field, which is the
only reason this tick's pending gate passed; the next `flume loop` start
refuses every commit on the schema leg until the field is dropped from each
entry file. Repairing it is plan's (`spec/harness.md`, *The gates the
discipline needs*: "a queue a gate refuses is plan's to repair").

**The rank is mandatory on a root group.** Placement is a biconditional:
an entry carries `rank` iff it is a `group` with no `parent`. A goal filed
without one is refused, which reaches
A-GOAL-ARRIVES-AS-AN-INBOX-RECORD-AND-DERIVE-FILES-BENEATH-IT — the inbox
commit that files the goal must carry its number, and a derive commit filing
beneath it must leave every rank byte-identical or the provenance leg refuses
naming the tag. Nested groups carry none.

The field is spelled `rank`; the key is `GOAL_RANK_FIELD` on the harness
surface. Provenance is decided from the phase the gate was built for, so it
only arms on the plan slices.

Two things came back or widened beside the entry. `GateEngine.parsePendingQueue`
is wired again (it retired with the filing-band gate) because `kind`'s default
is what decides whether an entry is a goal, and a fallback at the gate would
be a second copy of the engine's. And the CHAIN-AUTHORING gate-roster pin now
reads every phase's set rather than build's: `goal rank` is the first
producer-only gate *name*, so a build-only demand would have let the page drop
it with nothing red.
