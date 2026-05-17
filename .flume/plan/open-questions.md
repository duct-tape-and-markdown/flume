# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## 2026-05-17 — §7a dogfood `.flume/chain.ts` gate-placement move is outside build's writablePaths

**Status: PARKED** (off-allowlist edit + a builtin affordance gap; needs a human/`chore(flume):` call, gated on §7b shipping)

§7(a) requires the dogfood `.flume/chain.ts` to place expensive correctness gates at `afterMerge` and cheap structural gates at `afterCommit`. The dogfood build phase's `writablePaths` (`.flume/chain.ts:237-239`) **explicitly excludes** `.flume/{chain.ts,prompts/**,plan/**}` — "harness/human territory; edits flow through `chore(flume):` commits, not build ticks." So `writablePathsGate` would revert any build commit that moved the dogfood gates. Per `.claude/rules/spec-plan-build.md` ("off-allowlist file paths become open questions proposing chain.ts amendments, not pending entries") this is parked, not filed.

The buildable half of §7a/§7c (the `CHAIN-AUTHORING.md` guidance + byte-equality anti-pattern) **is** derived as `CHAIN-AUTHORING-GATE-GUIDANCE` (docs/, build-writable). Only the dogfood chain.ts gate-move itself is blocked here.

**Two coupled wrinkles the human must weigh:**
1. **Builtin affordance gap.** Every builtin gate is hardcoded `when: "afterCommit"` (`src/builtinGates.ts` — tsc/vitest/eslint/chainLoad/writablePaths all `afterCommit`). "Place `vitestGate` at `afterMerge`" is therefore not a relocation — the dogfood chain must express an afterMerge expensive gate via the `shellGate({ when: "afterMerge", … })` factory (or a new when-overridable builtin). The factory path is pure chain.ts authoring (still off-allowlist); a when-overridable builtin would be a `src/` change but is **not** mandated by §7 and would be scope creep if derived.
2. **Ordering vs. §7b.** Moving expensive gates to `afterMerge` *before* `AFTERMERGE-REVERT-ISOLATION` (§7b) ships makes the footgun worse: a flaky afterMerge gate under whole-wave revert nukes N−1 clean siblings. The chain.ts move must land **after** §7b ships, not before.

**Options:**
- **(A — recommended) After §7b ships, a human/`chore(flume):` commit moves the dogfood expensive gate(s) to `afterMerge`** (vitest as an inline `shellGate({ when: "afterMerge" })`), keeping `tscGate`/structural at `afterCommit`, and re-greens `pnpm test`. Plan files nothing for it — it is harness ceremony, the same lane as the OQ#3 tag question. The §9 CHANGELOG `### Changed` "dogfood gate placement" line is contingent on this landing (flagged in `RELEASE-0.2.0` notes).
- **(B) Amend the dogfood build phase `writablePaths` to admit `.flume/chain.ts`** so a build entry can do the move. This widens build's authority into harness territory permanently for a one-time edit; itself a chain.ts change (so still a human/`chore(flume):` edit), and a precedent worth not setting lightly.
- **(C) Add a when-overridable builtin gate variant** so chains can place builtins at `afterMerge`. A clean general affordance, but not in §7's scope — derive only if the spec asks.

**Recommended disposition:** A. It is the smallest honest landing, sets no precedent, and naturally sequences after §7b. Note: the broader revert-blindness theme (§5–§8) repeatedly touches prompt/chain surfaces; this round only §7a actually needs an off-allowlist edit because §5's prior-attempt block is injected structurally (mirroring the dispatcher-owned `<harness>` block, `src/Prompt.ts:117`), not via a `{{token}}` in `.flume/prompts/*.md` — so §5 stays fully build-writable and is *not* parked here.

## 2026-05-17 — `teardownWorktree` / `WorktreeSetupResult` / `setupWorktree → {extraEnv}` published with no spec authority

**Status: PARKED — NEEDS AMENDMENT** (API already shipped in `@dtmd/flume@0.1.2`; the v0.2-spec authoring round passed twice now without folding it in)

`ab2f10f` (`feat(phase):`) added three public-surface elements, exported via `src/index.ts` and **published to npm in `v0.1.2`** (`25dc78b`, CHANGELOG `[0.1.2] ### Added`):
- `Phase.teardownWorktree?(ctx)` — best-effort per-worktree cleanup hook.
- `WorktreeSetupResult` — new exported type.
- `setupWorktree` may now return `{ extraEnv }` (was `Promise<void>`).

No spec section authorizes any of it. `spec/RELEASE-v0.1.md` §2 ("`src/index.ts` is the canonical export list") enumerates `WorktreeSetupContext` but **not** `WorktreeSetupResult`, and describes neither `teardownWorktree` nor a `setupWorktree` return value; §6 covers `setupWorktree` pnpm guidance only.

**Update (this tick — `4187f44`):** `spec/RELEASE-v0.2.md` was rewritten and substantially expanded (§1 in-scope grew from "only these three" to seven items; new §5–§8) — and *still* did not fold this surface in. Its §2-framing paragraph enumerates the only additive-to-v0.1-§2 surface as `chainLoadGate` + "the gate-feedback context" (§5); §1's in-scope list and §11 non-goals both omit these hooks. The old "v0.2 §1 says 'only these three'" framing is now stale, but the substantive gap is unchanged and worse: the cleanest landing spot (a fresh, live, *expanding* spec) has now been edited twice without recording shipped public surface. This is a spec→plan→build pipeline break: public API was authored and **published** with no upstream spec/plan record. Plan cannot file a backfill pending entry — no spec section to carry a `per` cite into (per `.claude/rules/spec-plan-build.md`).

The code itself is coherent (JSDoc'd; `void`-returning impls unaffected; dispatcher wires `extraEnv`/`teardownWorktree`); the defect is governance, not implementation.

**Options for where this surface should be specced (it cannot be un-shipped):**
- **(A — recommended) Amend `spec/RELEASE-v0.2.md` to record it as additive public surface** (extend the §2-framing list + add a §2 bullet or a dedicated subsection), with a one-line note that v0.1.2 shipped it ahead of spec. v0.2 is the live, editable line; v0.1 is frozen-once-shipped (CLAUDE.md). The §1 in-scope list would also need a line, or land it as an explicitly out-of-the-themes "specced-after-the-fact surface" addendum — itself a human scoping call, not a mechanical edit.
- **(B) Amend frozen `spec/RELEASE-v0.1.md` §2/§6 retroactively.** Records it against the line that actually shipped it (v0.1.2), but reaches into a frozen spec — conflicts with the freeze posture; defensible only if v0.1.2 is treated as still part of an open v0.1 line.
- **(C) Accept as permanent unspecced surface.** Rejected — directly violates "§2 is the canonical export list" and the never-silently-fill-a-gap non-negotiable.

**Recommended disposition:** A. Also a process note: `feat(phase):`-prefixed code landing outside the `build:`-per-pending-entry path is how this bypassed plan; if out-of-band feature commits are expected during fork reconciliation, `.claude/rules/spec-plan-build.md` should say so explicitly.

## 2026-05-17 — `v0.1.1` git tag exists but CHANGELOG and `25dc78b` assert it does not

**Status: PARKED** (CHANGELOG is a ship artifact stating a falsehood; correct text depends on a tag-reconciliation decision the spec is silent on)

`CHANGELOG.md` `[0.1.1]` states: **"No `v0.1.1` git tag exists."** Commit `25dc78b` body states: "no v0.1.1 git tag — that release has no canonical commit. Only v0.1.2 is tagged." Both are **false**: `git for-each-ref` shows an annotated tag `v0.1.1 → 060b481 → ce73d95 "build: v0.1.1 — fix README scope placeholder"`.

`ce73d95` is **not reachable from `main`** — it is a fork-branch commit whose content `main` re-landed as `e9adb1c`. Wider reality: `v0.1.0` (`8d6ea2c`) is **also** an off-`main` fork commit; only `v0.1.2` (`25dc78b`) is on `main` and equals `HEAD`. So three published tags exist; two point at history not in the canonical branch, and the CHANGELOG narrative about that reconciliation contains a verifiably wrong claim.

§8 makes CHANGELOG accuracy a ship requirement ("v0.1 entry summarizes what shipped"). The factual sentence can be fixed by build, but the *right* sentence depends on what happens to the off-`main` tags — a release-ceremony call the spec does not cover. Filing a "fix the sentence" pending entry would paper over the unresolved tag state (per *architectural missteps*, flag the root).

**Options:**
- **(A — recommended) Keep the tags as-is; correct the CHANGELOG to state the off-`main` reality accurately.** e.g. `[0.1.1]`: "Tagged `v0.1.1` at off-`main` fork commit `ce73d95`; content reconciled into canonical history via `e9adb1c`." Honest, no history rewrite. Cheapest, but leaves published tags pointing off-`main` permanently.
- **(B) Delete the `v0.1.0`/`v0.1.1` tags** (they point off canonical history); CHANGELOG's "no v0.1.1 tag" claim becomes true and `[0.1.0]` is re-tagged on `main`. Cleanest history story; mutates already-published tags (npm dist-tags unaffected, but git consumers may have fetched them).
- **(C) Re-point `v0.1.0`/`v0.1.1` to the `main` commits that carried their content** (`v0.1.1 → e9adb1c`, `v0.1.0 → <main commit>`). Tags become reachable from `main`; still a published-tag mutation.

Tag creation/deletion/move is human release-ceremony lane (not plan's, not build's `build:` lane). Once chosen, the CHANGELOG correction is a `build:`/`chore(release):` follow-up under §8 — plan files it as a pending entry *then*, with the disposition fixed.

**Recommended disposition:** A — least disruptive, no published-tag mutation, and the CHANGELOG becomes truthful with one factual edit. If a clean canonical-history story matters more than tag stability, B.
