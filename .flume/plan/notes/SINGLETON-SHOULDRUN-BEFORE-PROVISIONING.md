# Two doc surfaces still say shouldRun sees promptArgs' exact ctx

The singleton consult now runs before provisioning with `ctx.cwd` at the
repo root, so `cwd` is the one field the two calls disagree on. Prose
outside this entry's fence still states the old identity:

- `src/Phase.ts:353` (`Phase.shouldRun`) — "Sees the same `TickContext`
  `promptArgs` sees — no new plumbing."
- `src/Phase.ts:69` (`TickContext.cwd`) — "Absolute path of the worktree
  this tick runs in", now false on a singleton decline (no worktree exists).
- `docs/CHAIN-AUTHORING.md:220-260` (*decline a tick before the
  invocation*) — describes the decline's cost without the singleton/fanout
  split `spec/loop.md` now draws.

None is load-bearing for this entry's acceptance, and both files are
outside its declared fence, so they shipped unchanged. A chain reading
`ctx.cwd` inside a singleton `shouldRun` would be misled by the Phase.ts
line — worth an entry declaring `src/Phase.ts` + `docs/CHAIN-AUTHORING.md`.

This repo's own chain is unaffected: the plan slices' `shouldRun` reads
`ctx.flumeDir` and `ctx.pickable` only (`.flume/chain.ts:670`).
