# The property pin was not green on the base tree

`pins[]` said "already holds". It did not: the widened walk found four types
no entry module exported — `FanoutEntryOutcome`, `FlumeApiPaths`, and
`MergeFailure`/`GateFailure`, the last two not even exported from
`src/Dispatcher.ts`, though `TickVerdict`/`TickOutcome` list them. All four
gained entry lines here, as `entry.files` anticipated. If the judge runs the
new pin against the pre-fix `src/`, it reds for that reason, not a bad test.

Unforeseen widening: the namespace exclusion had to move to the *named type's*
side as well as the position's. `StandardSchemaV1["~standard"]` holds
`StandardSchemaV1.Props`, nameable through its namespace; without the
target-side check the property arm flagged it. The signature arm inherits the
same exclusion — it was green either way, so no behavior moved there.

Standing gap: an inferred member type (a class property with an initializer
and no annotation) carries no type node, so no position. Emitted `.d.ts` does
name its type. Not filed — no instance in `src/` or `harness/` today.
