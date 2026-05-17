# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## 2026-05-17 — `teardownWorktree` / `WorktreeSetupResult` / `setupWorktree → {extraEnv}` published with no spec authority

**Status: PARKED — NEEDS AMENDMENT** (API already shipped in `@dtmd/flume@0.1.2`; the natural moment to fold it in — the v0.2-spec authoring round — passed without it)

`ab2f10f` (`feat(phase):`) added three public-surface elements, exported via `src/index.ts` and **published to npm in `v0.1.2`** (`25dc78b`, CHANGELOG `[0.1.2] ### Added`):
- `Phase.teardownWorktree?(ctx)` — best-effort per-worktree cleanup hook.
- `WorktreeSetupResult` — new exported type.
- `setupWorktree` may now return `{ extraEnv }` (was `Promise<void>`).

No spec section authorizes any of it. `spec/RELEASE-v0.1.md` §2 ("`src/index.ts` is the canonical export list") enumerates `WorktreeSetupContext` but **not** `WorktreeSetupResult`, and describes neither `teardownWorktree` nor a `setupWorktree` return value; §6 covers `setupWorktree` pnpm guidance only.

**Update (this tick):** `spec/RELEASE-v0.2.md` is now committed (`2e2fc5b`) — and was authored/committed *without* folding this surface in, despite the standing recommendation below. Its §2-framing paragraph explicitly enumerates its only additive-to-v0.1-§2 surface as `chainLoadGate`; §1 hard-scopes v0.2 to "**only these three**" (per-tick reload, chainLoadGate, worktree race); §7 non-goals does not list these hooks either. So the surface remains unspecced, and the cleanest landing spot (a fresh, live spec being written) has now shipped without it. This is no longer just "where should it go" — it's "the obvious window closed; an explicit human call is required."

This is a spec→plan→build pipeline break: public API was authored and **published** with no upstream spec/plan record. Plan cannot file a backfill pending entry — there is no spec section to carry a `per` cite into (per `.claude/rules/spec-plan-build.md`: no `per` cite ⇒ open question, not a pending entry). Flagging the process gap rather than papering it with a plausible spec-by-proxy, per `.claude/rules/collaboration.md` (*architectural missteps*).

The code itself is coherent (JSDoc'd, `void`-returning impls unaffected, dispatcher wires `extraEnv`/`teardownWorktree` — `src/Dispatcher.ts:265-281,353-378`, `src/Phase.ts:125-160`); the defect is governance, not implementation.

**Options for where this surface should be specced (it cannot be un-shipped):**
- **(A — recommended) Amend `spec/RELEASE-v0.2.md` to record it as additive public surface** (extend the §2-framing list and add a §2 bullet, or a dedicated subsection), with a one-line note that v0.1.2 shipped it ahead of spec. v0.2 is the live, editable line; v0.1 is frozen-once-shipped (CLAUDE.md). **Tradeoff now:** v0.2 §1 says "only these three" — so this also expands v0.2's declared scope, which is itself a human scoping call, not a mechanical edit. Either widen §1's scope sentence or land it as an explicitly out-of-the-three "specced-after-the-fact surface" addendum.
- **(B) Amend frozen `spec/RELEASE-v0.1.md` §2/§6 retroactively.** Records the surface against the line that actually shipped it (v0.1.2), but reaches into a frozen spec — conflicts with the freeze posture; defensible only if v0.1.2 is treated as still part of an open v0.1 line.
- **(C) Accept as permanent unspecced surface.** Rejected as a recommendation — directly violates "§2 is the canonical export list" and the never-silently-fill-a-gap non-negotiable.

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
