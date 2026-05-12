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

<active-specs>
!`find specs/active -name '*.md' 2>/dev/null | sort | head -60 || echo "(no specs/active)"`
</active-specs>

<aligned-specs>
!`find specs/_aligned -name '*.md' 2>/dev/null | sort | head -60 || echo "(no specs/_aligned)"`
</aligned-specs>

<tsc>
!`pnpm tsc --noEmit 2>&1 | tail -15 || true`
</tsc>

<recent-commits>
!`git log -n 10 --oneline`
</recent-commits>

# TASK

Re-derive the plan artifacts from current disk reality.

1. **Reconcile** every existing pending entry against the spec section named in `per` and the files named in `files`. Stale entries get a full rewrite, never a patch.

2. **File new observations** as additional entries:
   - Spec sections current code violates → file with `per` cite.
   - tsc / vitest / eslint failures → `MAINTAIN-*` entries at the top of pending, deduped by signature.
   - Gated entries whose unblock has shipped → promote to `gate.kind = "open"`.

3. **Graduate aligned specs.** Fully-aligned `specs/active/<path>` → `specs/_aligned/<path>` via `git mv` in this same commit. Cap ~5 per tick.

4. **Re-derive state.md from scratch** (~5 lines: phase, last shipped tag, in-flight work). Never carry forward.

5. **Open questions** belong in `open-questions.md`, never in pending. If a candidate entry can't carry a clean `per` cite, it's an open question, not pending.

# OUTPUT

Commit all changes in one commit prefixed `plan:`. Write:

- `.flume/plan/pending.json` — JSON array conforming to the schema below.
- `.flume/plan/state.md` — ~5 line markdown.
- `.flume/plan/open-questions.md` — markdown.

The harness will reject your commit if `pending.json` doesn't parse, or if you modify anything outside the phase's writable paths.

<schema>
{{PENDING_SCHEMA}}
</schema>
