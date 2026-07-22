# State

Phase: **v0.4 ACTIVE** (`spec/RELEASE-v0.4.md` opened `d2371fe`; v0.1/v0.2/v0.3 frozen). Mode this tick: **audit**.

## This tick — audit the harness/spec landing wave; OQ ledger drained to zero

Delta = 3 commits since `deccffc` (1 merge + 1 chore + 1 spec), spec delta present but records shipped behavior, empty inbox, pending `[]`.

- `d7a13ff` merge PR #6: lands the already-audited 0.3.1→v0.4 line onto main. No new surface; nothing to audit beyond the merge itself. Cleared the 36-behind backlog noted last tick.
- `12eae61` chore drain, **conformant with v0.4 §5**: `entryChannelPaths: [".flume/plan/open-questions.md"]` set on the dogfood build phase; same path admitted through `writablePaths` (guard's outer ceiling binds channel paths — correct); `prompts/plan.md` Derive dimension carries the `files` obligation with the worked incidental example (`tests/PendingSchema.test.ts`). Matches the §5 dogfood OQ ask exactly → **OQ closed**. Its staleness claim on the §7a OQ verified true: `eef522c` already landed disposition A (vitest as `shellGate({when:"afterMerge"})`, `.flume/chain.ts:264-269`; tscGate stays afterCommit) → **§7a OQ closed** (was stale; the ledger missed the landing).
- `52e768b` spec, **recording matches shipped code**: loop-propagates-78 (`src/cli.ts:328`, help text `:146`) and mixed-flags-classify-at-quiescence (`tests/Dispatcher.test.ts:442` rides-alongside case) — both §3 additions restate the standing plan rulings verbatim in substance → **§3 NEEDS-AMENDMENT OQ closed**.

**Derive**: spec delta touches only §3 and records already-shipped-and-tested semantics; no code change mandated, no entries derived. **Drain**: none (inbox empty). **Promote**: none.

## Queue (0)

Empty. v0.4 derivable surface fully shipped; **open-questions ledger now empty** (all three closed this tick: §7a stale-landed via `eef522c`, §5 dogfood via `12eae61`, §3 recording via `52e768b`).

## Active plan target

`spec/RELEASE-v0.4.md` — decomposition complete; underived surface: none. Next derivation trigger is a spec delta (v0.4 amendments or a v0.5 file).

## Open questions

**0** — ledger drained this tick.

## Writable-paths / trunk

- Wrote `.flume/plan/{state.md,open-questions.md}`; pending.json carried unchanged (`[]`); inbox.md untouched (empty). No entries → no path checks triggered.
- Trunk: HEAD `52e768b` at tick start, tree clean. **main ahead 2 of origin/main** (`12eae61`, `52e768b` unpushed); the prior 36-behind backlog cleared via PR #6. Human push of the two harness/spec commits still pending — CI has not exercised them.

Plan continues: no
