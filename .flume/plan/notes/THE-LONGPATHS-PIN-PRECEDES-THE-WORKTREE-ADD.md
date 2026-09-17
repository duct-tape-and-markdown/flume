# tests/worktrees.test.ts now runs under a file-wide git mock

The call-order pin needed a spy over `pinLongPaths`/`addWorktree`, so
`tests/worktrees.test.ts` carries a `vi.mock("../src/git.ts")` factory at the
top. Every other export passes through untouched, but the mock is file-wide:
a future case added there inherits it, and a case needing the unwrapped
module has to say so.

Checked while here, no finding: the two sibling win32-only cases
(`tests/git.test.ts`, `tests/job.test.ts`, both titled "pins core.longpaths
repo-locally, idempotently") claim the effect only, not an ordering, so their
bodies match their titles. The Dispatcher case was the sole over-claim, and
its describe title — the key
`tests/helpers/host-declarations.json` holds — was left as it reads.
