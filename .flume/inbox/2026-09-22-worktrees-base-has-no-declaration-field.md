# `Chain.worktreesBase` has no declaration field

`Chain.worktreesBase?: (paths) => string` is on the engine's chain surface
(`src/Phase.ts`; `spec/worktrees.md`, *Placement — the worktree base*): a
chain that wants worktrees outside the checkout says so once, evaluated at
load. The harness declaration schema (`harness/declaration.ts`) has no field
that reaches it, so a package consumer cannot declare it — the pass-through
`friction` was missing before 0.17 (`engine-boundary.md`, *Surface, not
prescription*: a hook that cannot reach an engine field is a missing field).

Reported by a downstream consumer (temper) porting to the package on 0.17.0:
it places worktrees off-repo to close the pwd-prefix vector *Placement*
names, and today only `FLUME_WORKTREES_DIR` reaches that. The env var still
outranks the field, as the section states.

Shape: optional `worktreesBase` on the declaration, a function over
`FlumePaths`, passed through whole the way `capabilities` and `friction`
are; the `spec/harness.md` *What a consumer declares* row and the
`docs/CHAIN-AUTHORING.md` declaration list (pinned against the schema)
follow.
