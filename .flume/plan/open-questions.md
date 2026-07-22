# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

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

## 2026-07-22 — v0.4 §5 dogfood adoption needs off-allowlist harness edits (plan-prompt obligation text + chain.ts entryChannelPaths)

**Status: PARKED** (`chore(flume):` edit; sequenced after `ENTRY-SCOPED-GUARD` ships)

v0.4 §5 has two dogfood-side consequences the build tick cannot land:

1. **Plan's prompt must state the `files` obligation** ("declared `files` must include every path the work legitimately touches, including incidentals" — §5). The runtime half (schema description text in `src/PendingSchema.ts`) rides inside `ENTRY-SCOPED-GUARD`; the dogfood half lives in `.flume/prompts/plan.md` — harness territory, off build's `writablePaths`.
2. **The dogfood build phase should declare its channel allowance** — §5's own example: `entryChannelPaths: [".flume/plan/open-questions.md"]` in `.flume/chain.ts`. Same lane.

No design question remains — §5 and §9.5 already decided shape and home; this is only the landing lane, parked per `.claude/rules/spec-plan-build.md` (off-allowlist paths become OQs, not entries).

**Ask:** after `ENTRY-SCOPED-GUARD` ships, one `chore(flume):` commit adds the obligation line to `.flume/prompts/plan.md` and sets `entryChannelPaths` on the dogfood build phase in `.flume/chain.ts`. Same lane as the §7a gate-move above (the two could share a commit if the human lands them together).
