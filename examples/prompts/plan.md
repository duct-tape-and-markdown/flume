# CURRENT STATE

<pending-json>
!`cat "{{FLUME_DIR}}/plan/pending.json" 2>/dev/null || echo "[]"`
</pending-json>

<state>
!`cat "{{FLUME_DIR}}/plan/state.md" 2>/dev/null || echo "(no prior state)"`
</state>

<open-questions>
!`cat "{{FLUME_DIR}}/plan/open-questions.md" 2>/dev/null || echo "(none)"`
</open-questions>

<inbox>
!`ls "{{FLUME_DIR}}"/inbox/*.md 2>/dev/null || echo "(drained)"`
</inbox>

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

{{SLICE_JOB}}

One tick is one slice's job. The chain woke this slice because its window is
non-empty; work that window, and leave what another slice owns to the tick
that owns it — the handoff wakes it next. Nothing here is a patch: the plan
artifacts are re-derived from disk every tick.

- **Reconcile before you add.** Every existing entry is judged against the
  spec section its `per` names and the files its `files` names. A stale entry
  is rewritten whole, never patched; one whose work has shipped leaves the
  queue.
- **An entry carries a `per` cite that resolves.** If a candidate can't, it is
  an open question for a human, not a pending entry.
- **Open questions live in `open-questions.md`**, never in pending.json.
- **state.md is rewritten from scratch** (~5 lines: phase, last shipped tag,
  in-flight work), never carried forward.

# OUTPUT

Commit all changes in one commit prefixed `plan:`. Write:

- `.flume/plan/pending.json` — JSON array conforming to the schema below.
- `.flume/plan/state.md` — ~5 line markdown.
- `.flume/plan/open-questions.md` — markdown.

The harness will reject your commit if `pending.json` doesn't parse, if an entry's declared `files` can't survive build's fence, or if you modify anything outside this slice's writable paths.

<schema>
{{PENDING_SCHEMA}}
</schema>
