# The checkout segment, and the flaky case it surfaced

- The fold is `checkoutAddress` (`src/git.ts`): one `git rev-parse
  --path-format=absolute --git-dir --git-common-dir`, both paths from one
  invocation so the equality that tells primary from linked compares two
  spellings git made. Primary is the literal `primary`; a linked checkout is
  `<slug>-<10 hex>` of its admin name, since `slugify` folds `a.b` and `a-b`
  together and two checkouts must not share one claim file. `shortHash` moved
  to `src/paths.ts` beside `boundedName`, which already spelled it.
- `tests/Dispatcher.test.ts`, "a readFileAtRef failure during the
  tracked-at-HEAD probe" failed its mocked probe on the first *call* and said
  teardown walks batch order. It walks provisioning order, which is the order
  each slot's claim stake returned — a race. It reds about one run in five
  once any timing shifts; re-keyed on the worktree the probe reads. Worth a
  look for siblings: any case keyed on a wave arm's ordinal rather than on its
  entry has the same defect, and all of them read green today.
- `docs/PRD-dock-collapse.md` §3 still reads "today: repo-global
  `flume/<slug>`". It is a proposal doc, so I left the record as written — the
  sweep's expired-narration lens is the right reader for it.
- The startup sweep is untouched and still reaps old-name residue: it deletes
  the branch git's registry pairs with each directory it removed, never a
  name it matched.
