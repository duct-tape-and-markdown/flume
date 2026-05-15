# CURRENT STATE

<pending-json>
!`cat .flume/plan/pending.json 2>/dev/null || echo "[]"`
</pending-json>

<state>
!`cat .flume/plan/state.md 2>/dev/null || echo "(no prior state)"`
</state>

<open-questions>
!`cat .flume/plan/open-questions.md 2>/dev/null || echo "(none)"`
</open-questions>

<spec-toc>
!`grep -nE '^## ' spec/RELEASE-v0.1.md 2>/dev/null || echo "(spec/RELEASE-v0.1.md not found)"`
</spec-toc>

<intent>
!`cat docs/INTENT.md 2>/dev/null || echo "(docs/INTENT.md not found)"`
</intent>

<inbox>
!`cat .flume/inbox.md 2>/dev/null || echo "(no inbox)"`
</inbox>

<tsc>
!`pnpm tsc --noEmit 2>&1 | tail -15 || true`
</tsc>

<recent-commits>
!`git log -n 10 --oneline`
</recent-commits>

# TASK

Re-derive the plan artifacts from current disk reality. The canonical ship target lives in `spec/RELEASE-v0.1.md` — human-curated, do not modify. Pending entries are the implementation work breakdown derived from it. **Plan is also the review activity** — auditing what shipped is part of this phase, not a separate process. **Plan also drains `.flume/inbox.md`** — externally-deposited findings (from humans or future review skills) get routed each tick.

**Default posture: research-leaning.** Codebase search and reading the full cited spec section are first-line tools, not last-resort fallbacks. When a question surfaces — a divergence, an unclear contract, a candidate entry without a clean cite — research the solution landscape before bailing to `open-questions.md`. Most questions have known-good answers in the codebase or ecosystem; the open-questions loop is for genuinely judgment-call decisions and architectural missteps, not for things a 30-second search would resolve. See `.claude/rules/collaboration.md` — *Inform before parking*.

1. **Drain `.flume/inbox.md`.** Walk every entry under the marker. For each, decide one outcome:
   - **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant spec section).
   - **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
   - **Accept as debt** — note the disposition + one-line reason in the commit body (no artifact change).
   - **Already addressed** — if a pending entry already covers it, or shipped code resolves it, note in commit body.

   After routing, **remove the entry from inbox.md**. The inbox is a queue, not a log. Do not leave entries sitting after disposition. If you can't decide, park.

2. **Review what shipped since the last plan tick.** Read `<recent-commits>` (above) and the diffs of any commits more recent than the last `plan:` commit. Audit them against the spec sections they claim to implement. Look for: spec drift, missed §s, code smells, test coverage gaps, API-surface oversights. **Your findings route directly** — file as pending entries, park as open questions, or accept-as-debt-with-reason in the commit body. **Do not write to inbox.md**; that's an external-contributor surface. The commit body carries the narrative of what this tick observed and routed.

3. **Reconcile** every existing pending entry against the spec section named in `per.section` and the files named in `files`. Stale entries get a full rewrite, never a patch. Read `spec/RELEASE-v0.1.md` to refresh.

4. **File new observations** as additional entries — drawn from step 2's review findings and from spec reconciliation:
   - Spec sections current code violates or doesn't yet implement → file with `per` cite.
   - tsc / vitest failures → `MAINTAIN-*` entries at the top of pending, deduped by signature.
   - Gated entries whose unblock has shipped → promote to `gate.kind = "open"`.

5. **Re-derive state.md from scratch** (~5 lines: phase, last shipped tag, in-flight work, what's blocked on what). Never carry forward.

6. **Open questions** belong in `open-questions.md`, never in pending. If a candidate entry can't carry a clean `per` cite into the spec, it's an open question for a human to fold into `spec/RELEASE-v0.1.md`.

7. **Verify entry file paths against build's `writablePaths`** in `.flume/chain.ts` before filing. If an entry's natural target sits outside that allow-list, build will revert or self-block on every attempt — that's a chain.ts amendment question, not a pending entry. File it as an open question proposing the amendment (or a spec change that retargets the file in-scope), with a one-line cite to the writablePaths line.

# OUTPUT

Commit all changes in one commit prefixed `plan:`. Write:

- `.flume/plan/pending.json` — JSON array conforming to the schema below.
- `.flume/plan/state.md` — ~5 line markdown.
- `.flume/plan/open-questions.md` — markdown.
- `.flume/inbox.md` — drained (remove routed entries; preserve the header).

**Commit body carries the audit narrative.** What you observed in the shipped commits, what you routed where, what you accepted as debt and why. The durable record lives in `git log --format=%B`.

The harness will reject your commit if `pending.json` doesn't parse, or if you modify anything outside the phase's writable paths.

For `per.path`, use `spec/RELEASE-v0.1.md`. For `per.section`, use the exact section heading text from the spec without the leading `## ` (e.g. `3. Public API surface`, `5. Tests`, `7. CHANGELOG`).

**Field discipline — entry fields are telegraphic.** `files[].description`, `tests[].asserts`, `acceptance`, and `notes` are pointers, not spec restatements (per `.claude/rules/collaboration.md` — *Match prose to the medium*). If `description` reads like *"Add X: if input matches /pattern/ then…"*, you're duplicating the spec; the right shape is *"Widen X per §N."* The `per` cite is the reader's path to mechanics — trust it. Aim for ≤200 chars on uncapped fields; if you can't fit, either the entry is doing too much or you're repeating the spec.

<schema>
{{PENDING_SCHEMA}}
</schema>
