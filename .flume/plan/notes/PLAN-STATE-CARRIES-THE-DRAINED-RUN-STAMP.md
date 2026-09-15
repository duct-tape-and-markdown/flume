# `.flume/PROTOCOL.md` still says the plan state has three typed fields

The field landed as `drainedRuns` — an optional map, lane name → the run
identity the forge reported, a lane absent meaning never drained. Nothing
reads it yet: the inbox slice's lane liveness (`spec/harness.md`, *CI lanes as
a findings source*) is still unbuilt, so the stamp is a place to write with no
writer. That follow-up entry is plan's to file.

`.flume/PROTOCOL.md:70` says "three typed fields"; it is outside build's fence
and outside every plan slice's, so the count is stale until an operator edit
fixes it. `harness/prompts/plan-discipline.md` and the module doc now say four.

One shape observation: the required-field loop in
`tests/harnessPlanState.test.ts` used to walk every key of
`PlanStateSchema.shape` and assert each refuses absence. With an optional
field in the shape that claim no longer holds of every key, so the loop now
asks each field whether it refuses `undefined` rather than reading a name —
any further optional field is covered without editing the test.
