# AUDIT WINDOW

<commit-window>
!`node .flume/delta-window.mjs audit 600`
</commit-window>

<build-records>
!`node .flume/delta-window.mjs build-records`
</build-records>

<tsc>
!`out=$(pnpm tsc --noEmit 2>&1); rc=$?; if [ $rc -eq 127 ] || [ $rc -eq 126 ]; then printf '%s\n' "$out"; exit $rc; fi; printf '%s\n' "$out" | tail -10; echo "(tsc exit $rc)"`
</tsc>

<pending-now>
!`cat .flume/plan/pending.json`
</pending-now>

<state>
!`cat .flume/plan/state.md`
</state>

<open-questions-index>
!`grep -n '^## ' .flume/plan/open-questions.md || echo "(none open)"`
</open-questions-index>

# TASK

Reconcile what landed since `Audited through:` with the intent it claims. Two motions over one window.

**Cross-check.** For each build or chore commit rendered above, read its diff against the section its entry cited — the entry has left the queue; the commit body names the tag and the section. Look for spec drift, missed cases, undertested logic, scope creep beyond the entry's `files`, gate bypass. `.claude/rules/engineering.md` is the shape bar: a fix without the test that fails on the pre-fix tree, a green over nothing, a seam gate reading a fixture. Findings route to a pending entry with a `per` cite, an open question, or accepted debt (one line in the commit body). Plan commits in the window need no cross-check; they are listed so the cursor can pass them. A red `<tsc>` on trunk is a finding before anything else is.

**Reconcile build's refusals.** `<build-records>` carries every standing prior-attempt record and the last build wave's outcomes. A voluntary bail means a build agent looked and refused — "the work is already shipped" is the field-traced case; a park (`not-shipped`) means the entry cannot ship inside its fence. Each is yours to resolve now: drop the entry, re-scope it, widen its `files`, or answer what it parked. A record whose tag is no longer in the queue is stale; say so in the commit body. An unreconciled record re-picks the same entry into the same wall.

**The cursor.** `<commit-window>` renders diffs for a contiguous, oldest-first prefix of the window and names the sha the cursor may advance to. Advance `Audited through:` to exactly that sha once every rendered commit is cross-checked — never to HEAD; commits beyond the budget re-appear next tick, and re-showing is the safe direction. Never advance as bookkeeping.

Discipline: `.flume/prompts/plan-discipline.md`.

# OUTPUT

One commit prefixed `plan:`; the body says what each rendered commit was checked against and what the records resolved to. Close per *Closing a slice* in the discipline file.

<schema>
{{PENDING_SCHEMA}}
</schema>
