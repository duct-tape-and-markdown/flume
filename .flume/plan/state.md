# State

Phase: **v0.4 ACTIVE** (`spec/RELEASE-v0.4.md` opened `d2371fe`; v0.1/v0.2/v0.3 frozen). Mode this tick: **audit**.

## This tick — audit the fourth v0.4-era ship wave (1 build commit + chore drain)

Delta = 2 commits since `8116ce0`, no spec change, empty inbox, no blocked entries.

- `64b4bc4` **PHASE-AGENT vs v0.4 §4: conformant.** `Phase.agent?: Agent` (`src/Phase.ts`); resolution `phase.agent ?? chainModule.agent ?? this.opts.agent` at `src/Dispatcher.ts:462`, moved *after* phase selection — the sole resolution site, feeding both `runSingleton` and `runFanout` by param into the single `agent.invoke` at `:999`. No bypass path. Mechanism-only (Agent value, no model-string sugar) per §8. CHAIN-AUTHORING documents the per-phase pattern incl. the `claudeCode({extraArgs:["--model",…]})` model-only variation + chain-local helper, per §4 bullet 3. Tests cover both §7 §4 mandates (phase.agent wins for its phase; silent sibling falls back chain > opts) plus a both-silent opts-default case. Files touched = declared set exactly; no scope creep. Optional field, non-breaking → no dogfood chain.ts co-update needed. One non-finding: §4's cite `src/Dispatcher.ts:394` now points at :462 post-move — spec line-cite drift on the human surface, not worth an OQ.
- `4f8bc46` chore drain: removed exactly the 1 shipped tag; pending now `[]`; clean.

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none.

## Queue (0)

Empty. **v0.4 derivable surface is fully shipped**: §3, §4, §5 guard, §2b, §2c, §6 lane (CI proof still pending push). What remains on v0.4 is human-lane only — see open questions.

## Active plan target

`spec/RELEASE-v0.4.md` — decomposition complete; underived surface: none. Next derivation trigger is a spec delta (v0.4 amendments or a v0.5 file).

## Open questions

**3**, unchanged this tick: §7a gate-move (PARKED, `chore(flume):` actionable), v0.4-§5 dogfood adoption (PARKED, actionable, can share that commit), §3 loop-78/mixed-flag recording (NEEDS AMENDMENT, two one-line spec edits).

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only; pending.json (`[]`) and open-questions.md carried unchanged; inbox.md untouched (empty). No new/edited entries → no path checks triggered.
- Trunk: HEAD `4f8bc46` at tick start, tree clean. **origin/main 36 behind** — windows lane and everything post-PR#5 unexercised in CI; human push still pending.

Plan continues: no
