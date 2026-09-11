# Runtime ignores reach the default state root only through the repo's .gitignore (human)

`src/job.ts` writes `RUNTIME_IGNORES` into a `.gitignore` under a job's state
root, but the default `.flume/` root relies on the repo's committed
`.gitignore` carrying each runtime directory by hand (`rendered-prompts/`
was added that way, 2026-09-10). A downstream repo that misses one line
commits tick artifacts. Options: the engine writes `.git/info/exclude` for
its runtime dirs at the default root; `flume init` writes them once; or the
spec makes it the repo's job and a gate refuses a commit adding a runtime
path. Which layer owns it is a decision — park if unclear.
