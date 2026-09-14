# harness/ is on disk but the package does not ship it yet

- **Nothing ships it.** `package.json` `exports` has no `./harness` subpath
  and `tsconfig.build.json` includes `src/**` only. Adding `harness/**` there
  moves the inferred `rootDir` to the repo root and breaks
  `main: ./dist/index.js` — packaging is a dist-layout change, not a one-line
  add (`spec/harness.md`, *Where it lives*).
- **`runAtBase` takes no `mergedSha`.** The spec's four params say the merged
  bytes are `cwd`'s working tree, so the runner copies from disk instead of
  `readFileAtRef`. True where the gate runs (afterMerge, clean trunk); the
  cutover entry retiring `.flume/vitestJudge.ts` should carry that.
- **`src/git.ts addWorktree` gained an optional `branch`** (omitted →
  `--detach`), so harness reuses the engine's worktree verb rather than
  spawning a second `git worktree add --detach` beside it. No other caller
  changed.
- **`lanes` has no consumer but its own test.** The judge that reads it — and
  refuses a line homed in an unrun lane — is still unfiled; it is what closes
  the vitest-lane open question.
