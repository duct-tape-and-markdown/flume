# The maximal-record roster is now the page pin's shape, and it wants one more reader

The gate-revert roster generalized cleanly: `MAXIMAL_RECORDS`
(`tests/Prompt.test.ts`) holds one record per mode, each widened with
`satisfies Required<...>`, and the bullet read loops it. Two things the next
plan tick may want.

1. **Two rosters of the same six modes now sit in one describe.** `variants`
drives the render cases (fixtures whose values must reach the block) and
`MAXIMAL_RECORDS` drives the page read (records whose *keys* must reach the
bullet). They cannot be one array: widening a fixture with `blamesSpan: false`,
`threw` or `omittedPaths` changes which arm the block renders, so the render
case would then assert values the renderer deliberately swaps out. A
both-directions equality between the two mode lists keeps them from drifting;
that is a cross-check, not a single home, and a third roster of the same six
would want a proper split (`.claude/rules/engineering.md`, *A module is one
job*).

2. **`omittedPaths` had no line anywhere on the authoring page before this
commit** - the renderer's elision line was pinned in the suite and described
nowhere a chain author reads. Worth a look at the other rendered bounds:
`details`, `diffStat`, `failureClass` and `finalMessage` are all "bounded" in
their doc comments, and only this one variant's bound is now stated on the
page. The bound is engine behavior a consumer can observe.
