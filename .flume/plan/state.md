# State

Phase: **v0.1 line shipped; v0.2 build line active.** Mode this tick: **audit** — the substantive delta is the `build:` commit `142ff5c` (CHAIN-AUTHORING-GATE-GUIDANCE, §7a/§7c docs), shipped by `ff98457`. No spec delta; inbox empty. Promote also fired (mechanical — CHAIN-AUTHORING-GATE-GUIDANCE shipped → RELEASE-0.2.0 unblocked).

## Audit — `142ff5c` (build: document gate-placement default + byte-equality anti-pattern — §7a/§7c) vs §7

Cross-checked the full diff (`docs/CHAIN-AUTHORING.md`, only file, 72+/3−) against `spec/RELEASE-v0.2.md` §7 (a)+(c) and §12's "(v) is docs, not runtime". Trunk green: `pnpm tsc --noEmit` exit 0; docs-only + a `pending.json` deletion are the only commits since `c9dd21f`'s verified 91-pass — neither touches `src/`/`tests/`, so vitest is structurally unaffected (not re-run for a pure-docs delta).

**Conformant.**

- **§7(a) docs half — delivered.** The "Where to place a gate" subsection states the default verbatim-in-substance with §7a (cheap structural → `afterCommit`: `tscGate`, bundle self-containment; expensive correctness → `afterMerge`) and carries the contention rationale (the bcrypt-fanout 5 s-timeout-under-CPU-contention incident, three clean commits reverted). Incident is anonymised — appropriate: CHAIN-AUTHORING is a consumer doc, not an internal forensic. Adds a sound pre-merge-vs-post-merge tradeoff paragraph (no spec contradiction). The chain.ts half of §7a is correctly **not** attempted — off build's `writablePaths`, parked OQ#1.
- **§7(c) docs — delivered.** The "Anti-pattern: gate on the safety property" subsection works the `bundleFreshnessGate` example faithfully: ~257 pure-reorder lines, pnpm virtual-store hashes in esbuild output, the real invariant living in `bundleSelfContainmentGate`. Generalises the lesson without over-reaching. §12 "(v) is docs-only — do not derive a runtime entry" honored.
- **Load-bearing premise verified, not assumed.** Both stale-clause reconciliations describe **shipped** behavior: `AFTERMERGE-REVERT-ISOLATION` (§7b) shipped (`bd5e6f4` build / `b58974d` chore), and `git merge-base --is-ancestor b58974d HEAD` confirms it is live on trunk. So per-entry afterMerge revert isolation is real runtime — the doc now states truth, not aspiration.
- **Doc-internal self-reference accurate.** §7a's guidance claims "the cascade example keeps `vitestGate` at `afterCommit` because its suite is trivial." Verified: `docs/CHAIN-AUTHORING.md:159` shows the cascade vitest gate at `when:"afterCommit"` (lines 448–449 concur). No false internal claim.
- **File scope exactly conformant.** `142ff5c` touched only `docs/CHAIN-AUTHORING.md`, matching `entry.files.edit` exactly. No off-allowlist path. `ff98457` removed exactly the `CHAIN-AUTHORING-GATE-GUIDANCE` entry (25 deletions, single file, single tag) — clean mechanical ship.
- **Tests ⊇ acceptance.** Entry `tests: []`, acceptance is doc-content presence — both subsections present with the required default+rationale and the bundleFreshnessGate example. Met by inspection; no test surface owed (docs deliverable per §7c/§12).

**Accepted as debt (narrative-only — defensible, no entry/OQ).** `142ff5c` did more than the literal entry ("add two subsections"): it also reconciled §2's gate-shape paragraph and §3's failure-modes line — both still said an `afterMerge` failure "reverts the wave" (pre-§7b blast-radius-N). This is **not** scope creep: same file, build-writable, file-scope exactly conformant; §7b is shipped so the old text asserted *false* runtime behavior, and a reader trusting it while reading the new §7a "move expensive gates to afterMerge" guidance would read §7a as a footgun. The build commit body names and justifies the reconciliation. This is the contributor-not-blind-worker posture operating correctly — an in-lane coherence fix the new guidance depends on; latent doc-debt §7b's own entry left behind, now closed in the right file by the entry that made the contradiction acute. Recorded so the disposition is defensible (same posture as the §5 voluntary-bail and §4 mechanism-latitude notes).

No drift, missed cases, undertested logic (docs — none owed), scope creep, or gate bypass.

## Promote — RELEASE-0.2.0 → open

Mechanical scan of all `blockedBy`: RELEASE-0.2.0 → CHAIN-AUTHORING-GATE-GUIDANCE (tag absent from queue — shipped by `ff98457`) → **flipped to `{kind:"open"}`**. No other `blockedBy` entries. RELEASE-0.2.0 is now the open queue head — the final release-cut entry; all functional §2–§8 work has shipped.

## Notes-legibility correction (RELEASE-0.2.0, same entry, same tick)

Beyond the mechanical gate flip, RELEASE-0.2.0's `notes` carried two legibility defects that risked a CHANGELOG over-claim by the next build tick: (1) a false parenthetical `(chore(flume) move shipped)` — the §7a dogfood `.flume/chain.ts` gate-move has **not** shipped (OQ#1 still PARKED, human/`chore(flume):` lane); (2) a stale `OQ#1 resolved by 4187f44` cross-ref using pre-renumbering ordinals — current OQ#1 is the §7a chain.ts move (PARKED), so the line now directly contradicts the live OQ. pending.json is re-derived wholesale every tick (not hand-edited — `spec-plan-build.md`), and field-discipline requires notes to be pointers that don't mislead; leaving an over-claim trap in the next-to-ship entry would be the blind-worker failure mode. Rewritten: §9 `### Added` wording is settled (4187f44); the `### Changed` dogfood-gate line stays CONTINGENT on the unshipped §7a chain.ts move — build omits/softens it, does not over-claim. Within the 500-char cap (495).

## Queue (1 — open head, nothing blocked)

`RELEASE-0.2.0` (open, §9 — next for build: `package.json` → 0.2.0 + consolidated `## [0.2.0]`). All §2–§8 runtime/docs shipped (per-tick chain re-resolution, chainLoadGate+fallback, worktree-race serialization, full §5/§6 prior-outcome union, §7b afterMerge isolation, §7a/§7c docs, §8 prose durability). Only the release cut remains; npm publish + git tag are human ceremony, out of build scope.

## Open questions

- **3, byte-unchanged.** No spec change, no human input, no new evidence touched any OQ this tick. OQ#1 (§7a dogfood chain.ts gate-move — PARKED, human/`chore(flume):`; its post-`b58974d` "§7b precondition satisfied" update remains accurate), OQ#2 (unspecced `teardownWorktree`/`WorktreeSetupResult`/`extraEnv` surface — PARKED, NEEDS AMENDMENT), OQ#3 (`v0.1.1` tag vs CHANGELOG — PARKED) all unchanged. Not re-litigated. This tick's notes-correction *references* OQ#1's parked state but does not move it — the question itself (off-allowlist edit + builtin affordance gap) is still the human's.

## Writable-paths / trunk

- This tick wrote `.flume/plan/pending.json` (RELEASE-0.2.0 gate flip blockedBy→open + notes legibility rewrite) + `.flume/plan/state.md`. `open-questions.md` and `inbox.md` byte-unchanged (no OQ movement / empty queue). No off-allowlist path. Audit findings routed entirely into this `plan:` body (conformant build → narrative; one defensible in-lane scope observation accepted as debt).
- Trunk: HEAD `ff98457` (`chore(flume):` ship). No code change this tick (plan-artifact-only). tsc clean.

Plan continues: no
