# The file-scope budget's form, and three more git-only suites with none

Form shipped: `vi.setConfig({ testTimeout, hookTimeout })` at file scope,
above the first registrar. Both arms probed on vitest 2.1.9 (a 150ms
declaration reds a 600ms case and a 600ms hook), because vitest resolves a
site's timeout at registration — a declaration below the hooks would not
reach them. The widened scan therefore cannot look only at a registrar's
timeout argument: a file-scope declaration is a `vi.setConfig` call whose
`timeout` fields name a harness budget, and the hook arm is half of what a
git-only file needs (the windows red was a case timeout plus an EBUSY
teardown on the repo it still held).

Not in this entry, found while scanning: `tests/Dispatcher.test.ts`,
`tests/friction.test.ts` and `tests/worktrees.test.ts` are default-lane
files that spawn `git` through `execFile` and declare no budget at all —
same shape as the three shipped here, same 5s inheritance. If
THE-SPAWN-BUDGET-IS-DECLARED-PER-FILE is scoped to the scan alone, these
three want an entry of their own; the scan will red on them once its
vocabulary carries `git`.
