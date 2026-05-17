# State

Phase: **v0.1 line shipped/frozen; v0.2 line shipped & now frozen.** Mode this tick: **audit** — the substantive delta is `build:` `8a927de` (cut 0.2.0: `package.json`→0.2.0 + consolidated `## [0.2.0]`), queue-cleared by `chore(flume):` `7a0b261`. No spec delta; inbox empty; pending empty; nothing blocked. Audit is the only live dimension.

## Audit — `8a927de` (build: cut 0.2.0 — version bump + consolidated CHANGELOG block) vs §9

Cross-checked the full diff (`package.json` + `CHANGELOG.md`, 61+/1−) against `spec/RELEASE-v0.2.md` §9 "Versioning & distribution". Trunk green: `pnpm tsc --noEmit` rc=0; the delta is `package.json` + `CHANGELOG.md` + a `pending.json` deletion only — no `src/`/`tests/`, so vitest is structurally unaffected (not re-run for a non-code delta — prior-tick posture).

**Conformant — one justified, fully-documented deviation from literal-verbatim §9.**

- **Version bump.** `package.json` 0.1.2 → 0.2.0; §9 "0.2.0, a minor" — the §2 `DispatcherOptions` break is the only §2-breaking change → minor under v0.1 §9. ✓
- **### Breaking / ### Added / ### Fixed — verbatim-in-substance.** Breaking: `DispatcherOptions` `chain` removed, per-tick `configDir` resolution (§2) ✓. Added: all 4 §9 items present — `chainLoadGate` (§3), per-tick re-resolution (§2), prior-outcome triad `gate-revert|voluntary-bail|platform-preempt` (§5/§6; wording settled `4187f44`), no-commit taxonomy on `TickOutcome` (§6) ✓. Fixed: all 3 — worktree race (§4), afterMerge blast-radius (§7b), silent plan-prose loss (§8) ✓. Each faithfully expanded for changelog readers; no false claim.
- **### Changed — ships 1 of §9's 2 bullets; the §7a bullet correctly OMITTED.** §9 ### Changed enumerates (i) dogfood gate placement: expensive gates → `afterMerge` (§7a); (ii) `flume loop` process-per-tick supervisor (§2). Shipped: (ii) only. Premise verified directly, not assumed: `src/builtinGates.ts` — every builtin `when:"afterCommit"`; `.flume/chain.ts:241` dogfood build phase `gates:[worktreeDepsGate,tscGate,vitestGate]` all afterCommit; zero `afterMerge` in chain.ts; `git log c924267..HEAD -- .flume/chain.ts src/builtinGates.ts` empty. So the §7a expensive-gate-→-afterMerge move has **not** shipped (off build `writablePaths`, parked OQ#1, human/`chore(flume):` lane). Transcribing §9 bullet (i) verbatim would make [0.2.0] assert an unshipped change — an over-claim (non-negotiable; v0.1 §8 makes CHANGELOG accuracy a ship requirement). Build chose truthful-over-literal, documented the omission + rationale fully in the `8a927de` body, and the prior plan tick (`c924267`) pre-authorized it in the entry notes. Contributor-not-blind-worker operating correctly.
- **File scope exactly conformant.** `8a927de` touched only `package.json` + `CHANGELOG.md` — exactly `entry.files.edit`. `7a0b261` removed exactly the RELEASE-0.2.0 entry (31 del → `[]`, single file). Clean mechanical ship; no off-allowlist path, no scope creep, no gate bypass.
- **Tests ⊇ acceptance.** Entry `tests:[]`; acceptance is artifact-presence + CI (`pnpm build` clean; v0.1 §8 consumer-install smoke; `attw esm-only`). Local half met by inspection + tsc; the CI gates are the v0.1 §8 surface, unchanged — no test surface owed (release-cut deliverable, §9/§10 posture).

**Accepted as debt (narrative-only — no entry/OQ).** `spec/RELEASE-v0.2.md` is now a **shipped → frozen** line (CLAUDE.md: earlier lines frozen once shipped). §9 ### Changed bullet (i) is therefore frozen spec text describing a change that did not ship in 0.2.0. Permanent, correctly-not-actionable divergence: plan never edits spec; [0.2.0] correctly reflects what 0.2.0 shipped; the §7a chain.ts move, when it lands via human/`chore(flume):` (OQ#1 rec A), belongs in a *future* CHANGELOG version section, never retroactively in [0.2.0]. No latent "fix [0.2.0]" debt. Already tracked by OQ#1 (whose disposition explicitly flags this §9 contingency) — recorded here so next-tick-me does not re-surface it as a fresh finding. Same posture as the prior tick's §5 voluntary-bail / §4 mechanism-latitude / §7b in-lane-reconciliation accepted-debt notes.

No drift, missed cases, undertested logic (none owed), scope creep, or gate bypass.

## Queue (0 — fully drained)

pending `[]`. RELEASE-0.2.0 was the final release-cut entry; shipped (`8a927de` build / `7a0b261` chore(flume)). All §2–§9 work landed: per-tick chain re-resolution, chainLoadGate + last-good fallback, worktree-race serialization, full §5/§6 prior-outcome union, §7b afterMerge isolation, §7a/§7c docs, §8 plan-prose durability, §9 release cut. npm publish + git tag are human release ceremony, out of build scope.

## Active plan target

**None.** Two spec files: `spec/RELEASE-v0.1.md` (shipped/frozen) and `spec/RELEASE-v0.2.md` (shipped/frozen this line). No `RELEASE-v0.3.md` → no active derive target. Plan hibernates until a human adds/edits a `spec/RELEASE-*.md` or appends an `.flume/inbox.md` finding.

## Open questions

- **3, byte-unchanged.** No spec change, no human input, no new evidence touched any OQ this tick. OQ#1 (§7a dogfood `chain.ts` gate-move — PARKED, human/`chore(flume):`; this tick's audit *references* its parked state to confirm the CHANGELOG omission is truthful but does **not** move it — the off-allowlist edit + the builtin `afterCommit` affordance gap are still the human's), OQ#2 (unspecced `teardownWorktree`/`WorktreeSetupResult`/`extraEnv` — PARKED, NEEDS AMENDMENT), OQ#3 (`v0.1.1` tag vs CHANGELOG — PARKED) all unchanged. Not re-litigated.

## Writable-paths / trunk

- This tick wrote `.flume/plan/state.md` only. `pending.json` is already `[]` (queue drained last tick — not re-touched); `open-questions.md` + `inbox.md` byte-unchanged (no OQ movement, empty queue). No off-allowlist path. Conformant build → audit findings routed entirely into this `plan:` body; one frozen-spec/artifact divergence accepted as narrative-only debt (already tracked by OQ#1).
- Trunk: HEAD `7a0b261` (`chore(flume):` ship). No code change this tick (plan-artifact-only). tsc rc=0.

Plan continues: no
