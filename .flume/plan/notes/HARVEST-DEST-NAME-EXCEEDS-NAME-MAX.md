# Two spec sentences now trail the harvest's NAME_MAX bound

Shipped as written. The bound landed as `boundedName` (`src/paths.ts`), the
one truncate-with-hash rule, now shared by `worktreeDirName` (behavior
unchanged — it keyed off the raw tag before and still does) and the harvest
destination. `NAME_MAX` is exported from `PendingSchema.ts` beside
`TAG_MAX_LENGTH`; paths.ts already imports that module, so the direction has
no cycle.

Two human-surface sentences the fix outran — build cannot touch `spec/`:

- `spec/worktrees.md`, "Teardown harvest — the delivery guarantee" states the
  destination as `<tag>--<stamp>--<file.name>` with no ceiling. The retry
  guarantee that sentence exists to make is what the bound restores, but the
  composition it prints is no longer the whole rule.
- `spec/pending.md`, "Tag grammar is mechanical safety" enumerates the
  ceilings a tag meets (NAME_MAX via the revert note, git's win32 worktree
  wall). The harvest destination is a third, and the one that motivated this
  entry.

Neither is a defect in `src/`; both are sentences a human may want to widen.
