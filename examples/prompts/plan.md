# CURRENT STATE

<pending-queue>
!`d="{{FLUME_DIR}}/plan/pending"; test -e "$d" || { echo "(no queue directory yet)"; exit 0; }; find "$d"/ -maxdepth 1 -name '*.json' >/dev/null || exit 1; n=0; for f in "$d"/*.json; do test -e "$f" || break; n=$((n+1)); printf '=== %s\n' "${f##*/}"; cat "$f"; done; test "$n" -gt 0 || echo "(queue empty)"`
</pending-queue>

<state>
!`p="{{FLUME_DIR}}/plan/state.md"; test -e "$p" || { echo "(no prior state)"; exit 0; }; cat "$p"`
</state>

<open-questions>
!`p="{{FLUME_DIR}}/plan/open-questions.md"; test -e "$p" || { echo "(none)"; exit 0; }; cat "$p"`
</open-questions>

<inbox>
!`d="{{FLUME_DIR}}/inbox"; test -e "$d" || { echo "(drained)"; exit 0; }; find "$d"/ -name '*.md'`
</inbox>

<spec-corpus>
!`test -d specs || { echo "spec corpus root 'specs' not found under $(pwd)" >&2; exit 1; }; find specs -name '*.md' | sort | head -60`
</spec-corpus>

<tsc>
!`pnpm tsc --noEmit 2>&1 | tail -15`
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
- **Open questions live in `open-questions.md`**, never in the queue.
- **state.md is rewritten from scratch** (~5 lines: phase, last shipped tag,
  in-flight work), never carried forward.

# OUTPUT

Commit all changes in one commit prefixed `plan:`. Write:

- `{{FLUME_DIR}}/plan/pending/<tag>.json` — one file per entry, conforming to the schema below; the filename and the entry's `tag` must agree.
- `{{FLUME_DIR}}/plan/state.md` — ~5 line markdown.
- `{{FLUME_DIR}}/plan/open-questions.md` — markdown.

The harness will reject your commit if any entry file doesn't parse, if an entry's declared `files` can't survive build's fence, or if you modify anything outside this slice's writable paths.

<schema>
{{PENDING_SCHEMA}}
</schema>
