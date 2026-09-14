# Plan state ships typed; the cutover owes two prompt rewordings

`harness/planState.ts` — `readPlanState`/`writePlanState`/`planStatePath` over
`<stateRoot>/plan/state.json`: `derivedThrough`, `sweptThrough`, `rotation`
(`{kind:"closed"}` | `{kind:"open",covered:[]}`). All three required; absent
artifact reads `undefined`, anything present-but-unreadable throws.

Judgment call to route: the prose form tolerated a lost cursor line ("Losing a
line re-arms the whole window", `.flume/prompts/plan-discipline.md`). The typed
form refuses a present artifact missing a cursor, by name — re-arming on a
half-written artifact fails silently in the direction that looks like work
getting done. The cutover must reword that line and plan-sweep.md's "paragraph
beginning `Rotation open`".

Also extracted `harness/refusal.ts` (`strict`, `parseOrThrow`): declaration.ts
already performed this artifact's field-naming refusal (engineering.md, *The fix
lands at the mechanism*). Future harness schemas import it.

Nothing in-tree consumes the accessor yet — its only caller is its test until
the chain factory lands. Dead surface if no cutover entry follows.
