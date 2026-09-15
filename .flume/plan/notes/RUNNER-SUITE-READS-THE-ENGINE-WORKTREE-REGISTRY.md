# The same probe, still hand-run in Dispatcher.test.ts

`checkoutsOf` now asks `api.git.readWorktreeRegistry` and throws on
`read:false`; the runner suite spawns no `worktree list` of its own.

Two sibling sites, both left untouched:

- `tests/Dispatcher.test.ts` (~438, 3251, 3296, 3350, 3391, 3414, 3484)
  spawns `worktree list --porcelain` — the newline form — and asserts
  `toContain`/`not.toContain` over raw stdout. Not a decoder, so not this
  entry's defect, but it is a substring verdict over an unparsed blob:
  `not.toContain(join(".flume","worktrees"))` reads green on a spawn that
  failed shape as well as on a registry that is genuinely empty, and the
  positive ones pin a path fragment rather than a registered path.
  Whether that is the same lens is plan's call.
- `tests/worktrees.test.ts:90` `registeredWorktrees` decodes `-z` by hand
  deliberately — it is the suite ruling on `readWorktreeRegistry` itself,
  and its doc comment says so. Not residue; don't file it.
