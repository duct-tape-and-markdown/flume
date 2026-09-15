# Two reported facts landed; spec prose now lags them

Shipped `FanoutEntryOutcome.extension` (the entry's chain-declared payload,
split by `CORE_ENTRY_FIELDS`) and `stopFlagPath` on `FlumeApi` + `src/index.ts`.

**Spec drift, human surface, build cannot touch it:**

- `spec/pending.md`, *What the package exports* enumerates the exported values
  by name and omits `stopFlagPath`. It calls itself canonical, so it is now
  wrong rather than merely short.
- `spec/chain.md`, *What a hook receives* names what rides `TickResult` for a
  `handoff`; the per-entry payload is not on it.

**Judgment call made, not parked:** `extension` is **required** (`{}` when the
chain declared none), unlike `TickContext.pickable`/`stateRootRel`, which are
optional-for-hand-built-fixtures. The engine holds the entry for every record
it emits, so "carried no payload" is statable; an optional key would make
`entry.extension?.x` the idiom and hide a future non-report. Cost: four
fixtures gained `extension: {}`. Flip it if plan prefers the precedent.

`tests/cli.test.ts` still hand-composes `join(dir, ".flume", "stop")` in ~6
stop/status/loop cases — pure shape, not filed.
