# The CI POSIX lane carries the same vacuous chain-load step

`.github/workflows/ci.yml`, "Consumer-install smoke" (~:130) scaffolds the
same `.flume/chain.ts` fixture as `scripts/smoke-install.mjs` and ends on
`npx --no-install flume status` — the identical defect this entry fixed in
the script: `status` takes the best-effort observational load, so the step
answers 0 whether or not the installed CLI reaches the fixture. The step's
own comment still says "`flume status` below best-effort loads this file",
which names the problem out loud.

One-word fix (`status` -> `check`; verified locally that `check` exits 0 over
that exact fixture with no pending.json and no git repo). Not patched here:
it is a second artifact outside this entry's scope, and `spec-plan-build.md`
routes cross-cutting fixes through plan rather than a build tick reaching
sideways.

The "Second reference chain smoke (backlog-groomer)" step below it is not
affected — it drives a real `wake` + `tick` and asserts on the committed
result, so its chain load is already load-bearing.
