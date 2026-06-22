# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## 2026-06-22 — process-boundary integration tests (`tests/loop-process-boundary.test.ts`) exceed vitest's 30s default and are fanout-hostile

**Status: PARKED** (test-infra strategy; no `per` cite — no spec section authorizes test-timeout/suite-partitioning policy; fix options carry tradeoffs)

Surfaced auditing the §16 delta. `b62d1b6`'s body states it was "Built directly (interactive), not via a fanout tick" because "the entry's process-boundary test spawns real `flume tick` subprocesses that are worktree-hostile … Recorded as a follow-up finding" — but that finding had **no home** in any plan artifact (inbox empty, no OQ). Recording it here so it stops getting re-discovered.

**Verified at source:** `tests/loop-process-boundary.test.ts` runs the real CLI via `execFile(TSX, [CLI, …])` — no stubbed loader, by design (§2 module-cache reload can only be proven with fresh OS processes). One test (single `tick`) passes; the second ("a chain.ts rewritten on disk between two real tick processes governs the second", multiple sequential `tsx` cold-starts) times out at exactly the 30s vitest default — reproduces in isolation. Cumulative real-subprocess cold-start cost (WSL2) is the likely cause; a true hang in the rewritten-chain path isn't fully ruled out and should be checked before just raising the limit. Pre-existing since `1152671`; **not** a §16 regression — `b62d1b6`/`cd03386` are otherwise clean (tsc green; §16 Dispatcher/Prompt/Gate coverage passes). Operational impact: a real fanout build `vitestGate` reverts here, which is exactly why §16 shipped interactively.

**Options:**
- **(A) Raise the per-file/per-test timeout** (build-writable: the test file's 3rd arg, or `vitest.config.ts`). Cheapest; unblocks the gate. But masks slowness and does **not** fix worktree/fanout-hostility (a worktree can't spawn the real CLI cleanly) — and if the second test actually hangs, a bigger timeout just stalls longer.
- **(B) Partition real-subprocess tests into a separate slow/integration project** excluded from the fanout `vitestGate`, run on trunk/CI only. Fixes both timeout and fanout-hostility; more infra; needs a gate-strategy decision (which suite each gate runs).
- **(C) Accept the carve-out:** entries touching this surface always build interactively (as `b62d1b6` did); document it. No code change; leaves the footgun live and undocumented for future fanout ticks.

**Recommended disposition:** B if process-boundary coverage is meant to run under autonomous fanout build at all; otherwise A as a stopgap with a one-line note. Either way **first confirm the second test is slow, not hung** — a hang is a real §2 defect, not a timeout-tuning question. No `per` cite exists (test-suite policy is unspecced), so parked rather than filed; a spec section on gate/suite partitioning would let plan derive this.

## 2026-05-17 — orphaned baton (awake flag → phase absent from chain) hibernates indistinguishably from a clean stop; the inbox's §5/§6 home is a category error

**Status: PARKED** (net-new terminal classification + supervisor stop + exit status; still no `per` cite — needs a human spec call: add an Axis-C/loop-safety section to the now-live v0.3 line, or explicitly reopen v0.2 scoping)

**Update 2026-06-22 (`RELEASE-v0.3.md` now exists):** disposition A's blocker is half-cleared — a `spec/RELEASE-v0.3.md` line now exists, but it carries the **foundations governor** (§§1-9) and **relocatable state** (§§10-15), **not** an Axis-C/loop-safety/orphaned-baton section. So the finding is still unauthorized by spec (no section to carry a `per` cite into) and stays PARKED. The recommended landing is now *cheaper than originally framed*: append a new section to the existing, live, editable RELEASE-v0.3.md (a human edit) rather than create the file from scratch. The Axis-C shape below is unchanged; nothing to re-derive.

Drained from inbox this tick (source: `2026-05-17 chaos-flume dogfood`, human). The finding is **real and verified at source, and slightly worse than reported**:

- `Dispatcher.tick()` (`src/Dispatcher.ts:360-368`): when `chain.phases.find(p => awake.includes(p.name))` is `undefined`, returns `{ hibernated:true, awakeAfter:[], summary:"awake flags reference unknown phases: …; hibernating" }`. **Structurally identical** to the clean "no phases awake" stop — only the `summary` string differs — **and the orphaned awake flag is never cleared from disk** (no `baton.sleep` on this path).
- `flume tick` (`src/cli.ts:206`): `return outcome.failed ? 1 : 0`. `failed` is unset (only `hibernated:true`) → **exit 0**, same code as a clean hibernation.
- `superviseLoop` (`src/Dispatcher.ts:1249`): its only hibernation stop signal is `baton.hibernating()` = `awake().length===0` (`src/Baton.ts:57-59`). The orphaned flag is still on disk → **never true** → the supervisor never stops on this condition; it hot-spins to `--max` (then host re-invocation makes it effectively unbounded — the reviewer's observed 100+ no-op segments / 111% CPU). The *tick* claims `hibernated`; the *supervisor* structurally cannot honor it. So this is not "hibernates silently forever" so much as "claims per-tick hibernation while the supervisor refuses to stop" — which matters for the fix: merely clearing the orphaned flag would convert it into a *silent clean* hibernation (wrong — masks the misconfig); the reviewer's ask for a *distinct terminal/misconfig signal* is the correct framing.

**Why this cannot be a pending entry (two independent, each-sufficient blockers):**

1. **No active spec line.** `spec/` holds only `RELEASE-v0.1.md` (frozen) and `RELEASE-v0.2.md` (shipped→frozen this line; CLAUDE.md: earlier lines frozen once shipped). No `RELEASE-v0.3.md`. Plan derives against spec deltas; there is no open derive target and no spec section to carry a `per` cite into (`.claude/rules/spec-plan-build.md`: a candidate that can't carry a clean `per` cite is a question for a human).
2. **Architectural-misstep flag — the inbox's "fits §5/§6 union" is a category error** (raised here per `.claude/rules/collaboration.md` "Caveat — architectural missteps": flag the framing, don't paper it over with a strained §6 `per` cite). §5 (prior-outcome feedback) and §6 (no-commit taxonomy) are scoped to *a no-commit tick where an agent ran or a gate fired* — per-entry/phase retry feedback persisted into the §5 `<prior-attempt>` block for the next retry of that work. Orphaned-baton is **upstream of agent invocation**: no phase picked, no agent, no entry/phase to retry, no "prior attempt" to forward. The shipped contract already excludes it **on purpose** — `TickOutcome.noCommit` doc (`src/Dispatcher.ts:277-278`): *"Absent when … ran no agent (nothing pickable)."* `TickOutcome` already carries the right axis for "couldn't run at all": `failed?: boolean` (§3 chain-resolution-threw). Orphaned-baton is a sibling of `hibernated`/`failed` (a baton/chain misconfiguration terminal state), **not** a member of the `NoCommitMode` work-outcome union. Folding it into §6 would re-introduce the exact agent-failure-vs-not conflation §6 exists to eliminate, on a different axis. That makes it **net-new normative behavior**, not derivation of frozen text — and autonomous phases never edit `spec/` (CLAUDE.md non-negotiable).

**Architectural correction (web-grounded; the inbox's §5/§6 framing is wrong, and here is the right model — recorded so the spec author and any future plan tick do not re-derive or re-attempt the §6 fold):**

Flume has **three outcome axes**, and the bug is that orphaned-baton is routed onto the wrong one:
- **Axis A — work outcome:** commit / no-commit{gate-revert|voluntary-bail|platform-preempt}. Per-entry, **retryable**, next tick retries with §5 feedback. Channel: §5 prior-attempt block + `TickOutcome.noCommit`.
- **Axis B — clean quiescence:** nothing pickable; terminal **success**. Channel: `hibernated:true`, exit 0, supervisor stops via `baton.hibernating()`.
- **Axis C — precondition/config error:** the declared world is inconsistent (chain threw, §3; **or an awake flag names a phase the chain does not declare**). Deterministic, **non-retryable**, neither work nor quiescence. Channel today: only half-built — §3 → `failed:true`/exit 1; **orphaned-baton is mis-routed onto Axis B** (exit 0, `hibernated:true`).

The inbox's "4th member alongside gate-revert/voluntary-bail/platform-preempt" puts an Axis-C concern on the Axis-A channel — the exact agent-vs-not conflation §6 exists to remove, re-introduced on a new axis. The correction: **orphaned-baton is Axis C; it joins §3's `failed`/exit-axis, generalized into a typed terminal-misconfiguration channel, carried on the exit code — the only channel that survives §2's process boundary.** Three independent bodies of practice converge on this:
1. **`sysexits.h` convention.** `EX_CONFIG` (78) = "something found in an unconfigured/misconfigured state", deliberately distinct from `0`, `EX_USAGE` (64), and generic `1`; rationale verbatim: "the caller can get a rough estimation about the failure class without looking up the source code." `flume tick` exiting **0** here is the core defect — it asserts clean success across the only boundary the supervisor can see.
2. **Kubernetes config-vs-runtime line.** `CreateContainerConfigError` (declared ConfigMap/Secret absent → distinct non-retriable status, fail-fast, **does not enter the backoff loop**) vs `CrashLoopBackOff` (runtime, retried). "Awake flag → phase the chain doesn't declare" is the precise analogue of "Pod → ConfigMap that doesn't exist": upstream of running work. Pod failure policy exists specifically to fail-fast on non-retriable config faults and stop burning compute on retries — flume's exact symptom.
3. **Poison-pill / dead-letter discipline.** A deterministic always-fails-identically condition is a poison pill; "one malformed record … infinite retry loop while downstream starves" is verbatim the observed hot-spin. Correct handling: detect non-transient → stop reprocessing, route to a distinct terminal channel for a human; **never retry-forever, never silently ack**. Today's exit-0 is silent-ack — the one option the literature rules out.

**Root-cause architectural flag (deeper than the inbox finding):** `superviseLoop`'s *sole* hibernation-stop signal is `baton.hibernating()` reading disk (`src/Dispatcher.ts:1249`). That correctly represents Axis B (disk genuinely empty) but **structurally cannot represent Axis C** — a baton that is non-empty *and* unrunnable. Using the disk-quiescence check as the stop-signal for a *disk-state misconfiguration* is the actual architectural error: the orphaned flag is definitionally what makes `hibernating()` false. §2's process-per-tick redesign moved supervisor state to disk + the child exit signal but only half-built the cross-boundary terminal channel (§3's `failed`→exit-1 exists; orphaned-baton must **complete** it). The supervisor's Axis-C stop decision must come from the **child's exit signal**, never from re-reading the broken disk state.

**Options (the human decides both axes):**

- *Where it gets specced:*
  - **(A — recommended) Open a `spec/RELEASE-v0.3.md` line** with a "loop safety: terminal vs. transient hibernation" section. Cleanest: v0.2 stays frozen (consistent with the freeze posture and the OQ#3 tag-line precedent), and this is genuinely a new theme, not a v0.2 correctness item that slipped.
  - **(B) Explicitly reopen `spec/RELEASE-v0.2.md`** to add it as a §6-adjacent-but-distinct section (a *new* §6a "non-pickable terminal classification", explicitly *not* a `NoCommitMode` member). Records it against the line whose §5/§6 work it neighbors, but breaks the shipped→frozen posture for a case that is *not* a v0.2 regression (the bug predates §5/§6 and is orthogonal to them).
  - **(C) Accept as permanent unspecced behavior.** Rejected — directly violates the never-silently-fill-a-gap non-negotiable and leaves an autonomous-harness footgun (token/CPU burn, wedged-run-masked-as-benign) unspecced.
- *What shape the spec should mandate (Axis-C model above; independent of A/B; recorded so the authoring session doesn't re-derive):* a distinct **Axis-C terminal classification** on `TickOutcome` — sibling to `hibernated`/`failed`, **not** a `NoCommitMode` member — generalizing §3's `failed` into a typed terminal-misconfiguration outcome (e.g. `terminal: { kind: "orphaned-awake", phases: string[] }`), surfaced as (i) a **distinct `EX_CONFIG`-class non-zero `flume tick` exit status** (≠ 0 clean-hibernate; either reuse §3's `failed` code or a dedicated misconfig code — human's call, but it must be non-zero and terminal), and (ii) a **`superviseLoop` fail-fast on the child exit signal**, *not* on `baton.hibernating()` (which the orphaned flag definitionally defeats — the root-cause flag above). Open sub-question for the spec author: should `flume tick` clear the orphaned flag or leave it for human inspection? Leaving it preserves diagnosability and is consistent with stopping on the exit signal (not disk quiescence); clearing it would re-hide the misconfig as a silent clean stop (the §1 silent-ack anti-pattern). Recommend: leave the flag, stop on the exit signal.

**Recommended disposition:** A (new `spec/RELEASE-v0.3.md` line), with the Axis-C shape above mandated and the inbox's §5/§6 framing explicitly rejected in the new section's prose so a future plan tick does not re-attempt the §6 fold. Smallest honest landing that respects the freeze posture; sequences naturally as the first v0.3 theme. The buildable surface, once specced, is small and `src/`-local (`TickOutcome` field + `cli.ts` exit-code branch + `superviseLoop` stop condition + tests) — no chain.ts/off-allowlist edit, so unlike OQ#1 it is fully build-derivable once a spec section exists to carry the `per` cite.

## 2026-05-17 — §7a dogfood `.flume/chain.ts` gate-placement move is outside build's writablePaths

**Status: PARKED** (off-allowlist edit + a builtin affordance gap; needs a human/`chore(flume):` call)

**Update 2026-05-17 (post-`b58974d`):** the "must land **after** §7b ships" precondition (wrinkle 2 below) is now **satisfied** — `AFTERMERGE-REVERT-ISOLATION` (§7b per-entry afterMerge isolation) shipped (`bd5e6f4`/`b58974d`). The afterMerge footgun is closed, so moving expensive gates to `afterMerge` no longer risks the whole-wave blast radius. The remaining blockers are unchanged: the off-allowlist edit + the builtin `when:"afterCommit"` affordance gap still require the human/`chore(flume):` call (rec A). No autonomous movement.

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
