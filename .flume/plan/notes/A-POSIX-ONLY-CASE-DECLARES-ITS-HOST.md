# The ledger duplicates reasons ten sites already state

Shipped: `tests/helpers/host-declarations.json` (44 rows) + the scan holding
both pins. Two departures from `files.edit`:

- **`tests/Dispatcher.test.ts` needed nothing.** Its EBUSY case mocks
  `git.removeWorktree` via `vi.spyOn` and says so at the site — platform
  neutral, no fixture to declare. A host there cuts win32 coverage for nothing.
- **`tests/Baton.test.ts` is guarded at the describe, not the case.** The lane
  named one red title; three cases share one symlink fixture and nothing here
  tells which. The block's fourth case (absence stays silent) is covered on
  both hosts by the roundtrip describe.

**For plan.** Ten pre-existing declarations already state their reason in a
comment at the site (`fsProbe`, `cli`, `bin`, `worktrees`, `harnessCi`, ...).
The ledger is now the machine-read home, so those are a second copy —
`engineering.md`, *Narration is the ladder's bottom rung*, says they shrink to
a pointer in the promoting commit. I left them: several carry more than the
host reason, so shrinking risks orphaning claims. That trim is its own entry.
