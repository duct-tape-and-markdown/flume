# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## 2026-05-17 — `spec/RELEASE-v0.2.md` is untracked; the v0.2 queue is blocked on committing it

**Status: PARKED** (blocks the entire v0.2 derive — no plan movement until resolved)

`spec/RELEASE-v0.2.md` exists in the working tree, is fully formed, and self-declares **"READY FOR PLAN"** with three normative scope sections (§2 per-tick chain re-resolution, §3 `chainLoadGate` + engine fallback, §4 worktree create/teardown race serialization). But `git status` shows it as `?? spec/RELEASE-v0.2.md` — **untracked, never committed**.

Plan derives against the *committed* spec corpus (`git diff <last-plan>..HEAD -- spec/`); an untracked file is invisible to that delta and is not yet a durable upstream artifact. Deriving a ~3-entry v0.2 queue from an uncommitted file would have build trusting a spec the human hasn't committed to — it can still change or vanish (`git clean`) before it lands. Per `.claude/rules/spec-plan-build.md`, the pipeline only holds when each layer trusts the committed upstream artifact.

This is the only blocker on starting v0.2. The content itself looks plan-ready; the issue is purely that it isn't in git.

**Options:**
- **(A — recommended) Commit `spec/RELEASE-v0.2.md` as a `spec:` commit.** Next plan tick's spec-delta then surfaces it and derives the v0.2 queue (estimate 3 entries, one per §2/§3/§4 — §3's `chainLoadGate` is the only additive-to-v0.1-§2 surface; §2's `DispatcherOptions` change is the §2 break that makes this a minor). No tradeoff — this just lands the decision the human already wrote.
- **(B) Leave it untracked deliberately** (still drafting). Plan then stays parked on v0.1 post-ship state and does not derive v0.2 until A happens. State this explicitly so the park isn't mistaken for an oversight.

The working tree also carries uncommitted edits to `.flume/PROTOCOL.md`, `.flume/chain.ts`, `.flume/prompts/{build,plan}.md`, and `CLAUDE.md` — harness/chore-lane, off plan's writable paths, flagged here only so they aren't lost in the same commit decision.

**Recommended disposition:** A. Commit the v0.2 spec (and the harness-lane working-tree edits under their own `chore(flume):` commit if intended); re-wake plan; it derives the v0.2 queue from the committed §2/§3/§4.

## 2026-05-17 — `teardownWorktree` / `WorktreeSetupResult` / `setupWorktree → {extraEnv}` published with no spec authority

**Status: PARKED — NEEDS AMENDMENT** (the API is already shipped in `@dtmd/flume@0.1.2`; this is a forward-looking spec-ownership + process question)

`ab2f10f` (`feat(phase):`) added three public-surface elements, exported via `src/index.ts` and **published to npm in `v0.1.2`** (`25dc78b`, CHANGELOG `[0.1.2] ### Added`):
- `Phase.teardownWorktree?(ctx)` — best-effort per-worktree cleanup hook.
- `WorktreeSetupResult` — new exported type.
- `setupWorktree` may now return `{ extraEnv }` (was `Promise<void>`).

No spec section authorizes any of it. `spec/RELEASE-v0.1.md` §2 ("`src/index.ts` is the canonical export list") enumerates `WorktreeSetupContext` but **not** `WorktreeSetupResult`, and describes neither `teardownWorktree` nor a `setupWorktree` return value; §6 covers `setupWorktree` pnpm guidance only. The (untracked) `spec/RELEASE-v0.2.md` §2–§4/§7 also does not mention these hooks — its only additive-to-§2 surface is `chainLoadGate`.

This is a spec→plan→build pipeline break: public API was authored and **published** with no upstream spec/plan record. Plan cannot file a backfill pending entry — there is no spec section to carry a `per` cite into (per `.claude/rules/spec-plan-build.md`: no `per` cite ⇒ open question, not a pending entry). Flagging the process gap rather than papering it with a plausible spec-by-proxy, per `.claude/rules/collaboration.md` (*architectural missteps*).

The code itself looks coherent (JSDoc'd, `void`-returning impls unaffected, dispatcher wires `extraEnv`/`teardownWorktree` — `src/Dispatcher.ts`); the defect is governance, not implementation.

**Options for where this surface should be specced (it cannot be un-shipped):**
- **(A — recommended) Add it to `spec/RELEASE-v0.2.md` §2 as additive public surface**, alongside `chainLoadGate`, with a one-line note that v0.1.2 shipped it ahead of spec. Cleanest: v0.2 is the live line, `spec/RELEASE-v0.1.md` is frozen-once-shipped (CLAUDE.md), and v0.2 §5 already owns post-v0.1 CHANGELOG/versioning. Requires a human edit to the (still-uncommitted) v0.2 spec — couple with the question above.
- **(B) Amend frozen `spec/RELEASE-v0.1.md` §2/§6 retroactively.** Records the surface against the line that actually shipped it, but reaches back into a frozen spec — conflicts with the freeze posture; only do this if v0.1.2 is treated as still part of an open v0.1 line.
- **(C) Accept as permanent unspecced surface.** Rejected as a recommendation — directly violates "§2 is the canonical export list" and the never-silently-fill-a-gap non-negotiable.

**Recommended disposition:** A, folded into the v0.2-spec commit. Also a process note: `feat(phase):`-prefixed code landing outside the `build:`-per-pending-entry path is how this bypassed plan; if out-of-band feature commits are expected during fork reconciliation, the spec-plan-build rule should say so.

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
