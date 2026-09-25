# The refill needed a told supervision fact, and it exposed a load-sensitive verdict case

Two things the next plan tick should know.

**A new engine surface: `DispatcherOptions.supervisedRun`.**
`spec/loop.md`, *Graceful stop — the stop flag*, says the flag ends "a
supervised wave's refill" and that "`flume tick` ignores the flag". A wave
cannot infer which it is — `quarantinedSlugs` and a pid match are both
side-effect inference (`engine-boundary.md`, *Told, not inferred*) — so the
fact is now told: `src/cli.ts` sets it from the same `FLUME_TIP_CLAIM_HELD`
read it already uses to decide whether to acquire its own tip claim, and it
reaches the wave on `TickLegContext`. Default unset, so an embedder that
never wired a supervisor is unchanged. Nothing in `docs/` rosters
`DispatcherOptions` field-by-field (only `MIGRATING-0.12.md` names
`ownTipClaimPid`), so nothing there went stale — but if a page ever does
roster that type, this is a new row.

**A load-sensitive case in `tests/cli.test.ts`.** The
LOOP-WAVE-VERDICT-MULTIENTRY-COVERAGE case asserts `verdict.declined === true`
over a two-entry wave where SHIP-A's merge raises the ledger refusal and
DECLINE-B is declined before its agent. `w.declined` is folded when
DECLINE-B's attempt reaches `mergeAttempt`, and **nothing orders that against
SHIP-A's refusal** — DECLINE-B only wins because its slot has no agent to
run while SHIP-A spawns four gits. It failed once under full-suite
contention (`declined` undefined), then passed in isolation and on a clean
full re-run; both full runs on this branch are green. This is a
pre-existing ordering gap in the case, not a regression — the fix is to gate
DECLINE-B's fold before the refusal (an `awaitOnTrunk`-style event, not a
sleep) rather than to relax the assertion.

Also: `ctx.pickable` / `ctx.claimed` now carry the selection the slot's own
pick was taken over, not the wave's opening one — an entry filed mid-wave is
absent from the opening set entirely.
