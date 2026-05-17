# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## 2026-05-17 — §2's prescribed chain-reload mechanism cannot deliver §2's own in-process headline guarantee (build flag, `0c24b29`)

**Status: PARKED — NEEDS AMENDMENT** (resolution branches on a reproducible probe; several branches edit `spec/RELEASE-v0.2.md` §2/§6 — human lane)

`0c24b29` shipped PER-TICK-CHAIN-RELOAD exactly per §2's prescribed mechanism (`tsImport` + content-hash memoization) and verified it conforms (§2 acceptance tests green). The build then flagged, via its commit body, an internal tension in §2 itself:

- **§2 prose + acceptance preamble** promise in-process disk reload: "A tick that commits a rewritten `chain.ts` … is governed by the new chain on the next tick" / "**Within one `flume loop` process**: … the immediately following tick."
- **§2's prescribed mechanism** ("reuse `loadChain`/`tsImport`, cache-bust by content hash") cannot deliver that, per the build's empirical test (tsx 4.21 / Node 22.21): the content-hash gate fires and re-calls `tsImport`, but `tsImport` returns the **prior evaluation** — the new chain takes effect on the next `flume loop` *process*, not the next in-process tick.
- **§2's acceptance test is specified with a fake loader** ("rewrite between ticks with a fake loader"). So the suite is green while testing only the per-tick *re-invocation contract* (Dispatcher calls `chainLoader()` every tick), not the headline disk-reload guarantee. The build correctly did **not** paper this over with a passing-but-false assertion; it routed the flag via the commit body because `open-questions.md` is outside build's writable paths. This is the pipeline working as designed for an architectural misstep, not a process violation.

**Research (per *Inform before parking*) — and it sharpens, not closes, the question.** tsx's own `tsImport()` docs directly contradict the build's empirical claim: "*Since this is designed for one-time use, it does not cache loaded modules*" — calling it twice on the same path "*does not yield a cache-hit and re-loads it*" (https://tsx.is/dev-api/ts-import; mechanism is a per-call `?tsx-namespace=<uuid>` on the entry URL, cf. privatenumber/tsx#750). Documented contract and observed-on-pinned-version behavior disagree. Empirical evidence on the *actual pinned toolchain* outranks docs that may describe a different version — but this is now a **factual contradiction that must be reproduced before any heavy option is justified**, because the disposition branches hard on the outcome and three of the four options below are expensive.

**Options (the build's four, plus the research-driven step 0):**
- **(0 — do this first) Minimal reproduction probe** on pinned tsx `^4.19` (resolved 4.21) / Node 22.21: `tsImport` a temp `.ts`, rewrite its bytes, `tsImport` the same path again, assert whether the second evaluation reflects the rewrite. Cheap, decisive, crosses no lane. **If it re-evaluates (docs correct):** the build's finding was a probe artifact — §2 already works in-process; the only gap is that the §2 acceptance test never exercises the real disk loader (add a real-disk-reload test; that test is *beyond* §2's fake-loader acceptance, so it lands as §6 amendment or plan-discretion hardening — no spec rework, no toolchain change). **If it returns the prior evaluation (build correct):** it is a real constraint on the pinned toolchain → choose (a)–(d).
- **(a) Bump/replace tsx** for a loader with working in-process re-eval. Note pin is `"tsx": "^4.19.0"` — a floated 4.x may already differ from the tested 4.21; intersects directly with step 0.
- **(b) Content-addressed sibling temp module** beside `chain.ts`. Preserves import resolution; pollutes the consumer's `.flume/` on every chain change.
- **(c) Child-process resolve per tick.** Correct by construction; a per-tick process-spawn cost regression on the loop's hot path.
- **(d) Accept "reload across `flume loop` process boundaries"** and amend §2 prose + acceptance to match. No code change. Requires: §2 wording, §6 test description, `docs/CHAIN-AUTHORING.md:9-13` ("governed by the new chain on the next tick" — same overclaim, propagated per spec), and `RELEASE-0.2.0`'s CHANGELOG `### Added` line (noted contingent in `pending.json`).

**Recommended disposition:** Run **(0)** first — it is the only step that resolves the doc-vs-empirical contradiction, and every other option is contingent on its outcome. If it reproduces the build's finding, **(d)** is the lightest honest landing (no shim, no perf hit, no consumer-dir pollution; `flume loop` already re-spawns the agent per tick, and autonomous loops are driven by repeated invocation more than one very-long-lived process — so "reload at process boundary" is close to the real operating model); escalate to **(a)** only if a consumer genuinely rewrites its chain mid-single-`flume loop` and needs same-process effect. **(b)/(c)** are not recommended. The §2 prose overclaim should not reach a published 0.2.0 CHANGELOG unresolved.

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
