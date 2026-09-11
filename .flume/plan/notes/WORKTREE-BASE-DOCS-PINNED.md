# Worktree-base doc pin: the template scan anchors on `<entry…>`

The pin (tests/retired-narration.test.ts) reads two claim shapes per doc: the
`<ENV> ?? join(flumeDir, "…")` formula token, and per-entry templates matching
`<flumeDir>|<repoRoot>/.flume|.flume` + segments + an `<entry…>` placeholder.
The placeholder keeps README's sibling state-list rows (`.flume/awake/<phase>`,
`.flume/loop.pid`) out of a worktree scan — but a doc renaming the placeholder
to something not starting `entry` drops silently out of the scan. The
populated-corpus test catches a doc losing *all* its templates (today README 2,
CHAIN-AUTHORING 3), not a partial narrowing. Cheap residue, not filed.

Out of scope deliberately: `docs/PRD-dock-collapse.md:163` also names
`FLUME_WORKTREES_DIR`, but a PRD records a decision rather than teaching the
current base. If `docs/` gains another surface that *teaches* the base it needs
a row in `BASE_DOCS` — nothing mechanical will notice its absence.

`tests/paths.test.ts` already pins the resolver's own branches; this pin
re-asserts none of them, only that the docs' words match.
