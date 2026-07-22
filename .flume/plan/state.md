# State

Phase: **v0.4 ACTIVE** (`spec/RELEASE-v0.4.md` opened `d2371fe`; v0.1/v0.2/v0.3 frozen). Mode this tick: **audit**.

## This tick — audit the third v0.4-era ship wave (2 build commits + chore drain)

Delta = 3 commits since `e615052`, no spec change, empty inbox, no blocked entries.

- `898dfbb` **FIX-RELOCATED-PENDING-COMMIT vs v0.3 §11: conformant.** Verified at `src/Dispatcher.ts:1371-1374`: out-of-repo pendingPath detected via `relative(repoRoot, pendingPath)` after the disk write; returns `revParse` HEAD, so the caller's existing `updSha === preUpdate` branch keeps `commitSha` undefined (`:795`) and narrates the no-commit variant (`:799`). Test asserts all four mandated outcomes (entry merged to trunk, pending updated at the relocated path, exactly 1 trunk commit + no reported chore SHA, no in-repo `.flume` bleed). Ship-log no-commit variant: incidental within the declared file, serves §13 honest-narration intent, accepted. Two corner debts **ACCEPTED** (see commit body): `..`-prefixed-dirname false positive in the detection idiom; footprint-only relocated wave misnarrated as "already recorded".
- `c7de392` **FIX-EXTRAENV-JSDOC-SCOPE vs v0.4 §2b: conformant.** Comment-only, declared file only. Acceptance's literal "no gate mention remains" is over-strict — shipped JSDoc mentions gates precisely to negate the stale claim ("gates … do not see these vars"), which serves the §2b intent better than silence. Plan wording defect, not a build defect; no finding.
- `fbed998` chore drain: removed exactly the 2 shipped tags; clean.
- Follow-through: the §2a default-base test carries no stale in-repo-pin comment (`tests/Dispatcher.test.ts:622`) — the optional relax the entry offered turned out unneeded.

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none (no blockedBy gates).

## Queue (1)

Head: `PHASE-AGENT` (§4 per-phase agent seam). Open, no gates — sole remaining entry.

## Active plan target

`spec/RELEASE-v0.4.md` — decomposition current; underived surface: none. Shipped so far: §3, §2c tests + docs, §5 guard, §6 lane (CI proof still pending push), §2b JSDoc align, plus the v0.3 §11 relocated-dock bookkeeping fix. Remaining spec work: §4 (`PHASE-AGENT`).

## Open questions

**3**, unchanged this tick: §7a gate-move (PARKED, `chore(flume):` actionable), v0.4-§5 dogfood adoption (PARKED, actionable, can share that commit), §3 loop-78/mixed-flag recording (NEEDS AMENDMENT, two one-line spec edits).

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only; pending.json and open-questions.md carried unchanged; inbox.md untouched (empty). No new/edited entries → no path checks triggered.
- Trunk: HEAD `fbed998` at tick start, tree clean. **origin/main 34 behind** — windows lane and everything post-PR#5 unexercised in CI; human push still pending.

Plan continues: no
