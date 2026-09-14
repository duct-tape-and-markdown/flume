# Subprocess fixtures reach the queue default by interpolation, not import

Eleven of the twelve literals took `resolvePendingPath`/`DEFAULT_PENDING_REL`
directly. The twelfth lives inside `ledgerRewriteFailureChainSrc` — a chain
*source string* written to disk and loaded by a real `flume tick` subprocess,
which cannot import `../src/paths.ts`. It now renders the default in:
`join(flumeDirEnv, ${JSON.stringify(DEFAULT_PENDING_REL)})`. Same fix shape
reaches any future generated-fixture site, but it is interpolation at render
time, not a live accessor — worth knowing before a sweep reads it as a literal.

Two adjacent spellings left standing, both deliberate:

- Test *titles* still say "plan/pending.json" (~967, 1014, 1025, 2049, 2088).
  Prose naming the behavior for a human, not a fixture path.
- Fixture chains declare `writablePaths: [".flume/plan/**"]` (~1903). A fence
  glob the fixture owns, unrelated to where the queue resolves.

The `git add` inside the generated chain and at ~533 now passes the resolved
absolute path as the pathspec rather than a repo-relative `.flume/...` string,
so no site re-derives the state-root name either.
