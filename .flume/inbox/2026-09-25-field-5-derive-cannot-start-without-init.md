# Field: a state root that skipped init cannot start plan-derive

Downstream report, 0.19, item 5. Priority 30. `plan/state/plan-derive.json`
requires `derivedThrough`, and only `flume-harness init` seeds it (0.19). A
relocated state root built by hand, or one migrated from before init seeded
state, has no file, and derive cannot start; the consumer hand-seeded it
with the commit before their brief existed.

The reporter's two shapes: derive treats an absent cursor as "derive the
whole spec locus", or the refusal names the file and the command that seeds
it. The first is silent over an unresolved input unless it says so on the
render (`engineering.md`, *Loud or nothing*). Route as an entry if
`spec/harness.md`, *Plan state as declared state* already rules the absent
case; otherwise a question naming both. Repro to reduce: a state root with
no `plan/state/plan-derive.json`, one derive tick.
