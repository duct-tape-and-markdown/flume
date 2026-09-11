# Keyspace landed; three consumers outside the fence still restate it

- `src/index.ts` does not re-export `PriorAttemptKeyspace` (fence covered
  Prompt/Dispatcher/tests only). A chain reads `rec.key` structurally, but
  cannot name the alias from the package entry point — the gap the barrel-pin
  tests exist for on `NoCommitMode`/`ProvisionFailure`.
- `docs/CHAIN-AUTHORING.md` §"The `<prior-attempt>` block" still says the
  record is "cleared once an attempt ships clean"; it is now also cleared as
  stale at a wave's queue read.
- `.flume/chain.ts` `parkStanding` filters records with `live.has(key)` and
  its doc comment restates both engine rules (retired tag ignored, phase key
  never slugifies to a tag). Now engine-owned — but only at a **fanout**
  wave's queue read, so plan's singleton `shouldRun` can still see a record
  whose entry left the queue since the last build wave. The chain guard is
  not yet redundant; it becomes so only if spec widens the sweep past the
  wave.
