# The unreleased range carries five breaks, not four

**Five, not four.** `TickVerdictGateResult` → `ReportedGateResult` (e3882d0;
`TickResult.gateResults`/`ShipContext.gateResults` widen to the full row) is a
public type rename in `v0.15.0..HEAD`. Same miss class as 66781ef — no
`BREAKING:` line, so `git log --grep` and the mined draft both drop it. Found
by diffing emitted `.d.ts` at v0.15.0 against HEAD, which is the only decidable
way to count. Acceptance reads "per breaking change", so the note covers five.

**Dangling cite.** `src/cliVerdict.ts:123` says `TickVerdictMergeOutcome.tag`;
the field is `entryTag` since 8a8bd0c, which edited that file. The citation pin
cannot reach it by design — it resolves tokens, not members, and `tag` resolves
elsewhere. Expired narration, not a pin defect.

**Unlinked.** Nothing points at `docs/MIGRATING-0.16.md`; the link sites are
README (sibling entry) and CHANGELOG (the cut's).

**`PriorAttemptRef`** is `priorAttemptPath`'s parameter type but is not
re-exported from `src/index.ts` — a consumer passes an untyped literal.
