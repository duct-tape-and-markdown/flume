# Two spec sentences now understate what the union shares

Shipped as filed: `queueFenceViolations` (src/paths.ts) is the one
derivation; `pendingGate` and `flume check` both call it, `fenceWhen`
stays a pendingGate-side filter over the entries it submits.

Two human-surface lines describe the old shape and are now narrower than
the tree, neither wrong:

- spec/pending.md, "The union has one home" names
  `entryWriteScopeUnion`'s consumers as `writablePathsGate` +
  `effectiveFenceLines`. Both now reach it through `entryWriteScope`, and
  the queue pre-check is a third consumer the sentence does not mention.
- spec/cli.md, `check` calls the fence arithmetic "the same
  `entryWriteScopeUnion`/`matchesAny` computation the write guard
  enforces" — true, but the stronger fact is that `check` and
  `pendingGate` now share one named derivation, so the verb and the gate
  cannot name different offending paths.

`entryWriteScopeUnion` itself keeps no direct caller outside src/paths.ts
now (tests/paths.test.ts aside). It is not on `src/index.ts`, so
"An export earns its consumer" is satisfied by the test — flagging it in
case the spec rewrite wants it made module-private instead.
