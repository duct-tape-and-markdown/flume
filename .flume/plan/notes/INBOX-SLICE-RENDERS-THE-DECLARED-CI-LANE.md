# Lane block renders; this repo's lane is red

Render leg only, as scoped: `harness/ci.ts` reads a lane through `gh`,
`windows.ts` renders `CI_LANES`. Nothing makes the slice live over a red lane,
and nothing writes `drainedRuns` but the prompt's instruction — the
liveness/stamp leg derive is filing is still owed.

Probed against the real forge (repoRoot=trunk, main): lane `windows` is
FAILING at run 35006160531, so the next inbox tick has real titles to drain.

Two for derive:

- The failing log is the largest block any tick renders: ~1268 lines, ANSI
  coded and `windows\tRun pnpm test\t<ts>`-prefixed, trimmed to the window's
  1200-line *diff* budget. A CI log line is not a diff line; a lane-specific
  bound, or stripping ANSI/step prefix at the reader, is the lever.
- Branch is read at the repo root, not the tick's worktree: a scratch branch
  has no runs, and a liveness predicate gets no cwd at all. The stamp leg must
  read the same tree or the two readers disagree.
