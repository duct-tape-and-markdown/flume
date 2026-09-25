# SPEC WINDOW

<spec-window>
{{SPEC_WINDOW}}
</spec-window>

<pending-now>
!`d="{{PENDING_DIR}}"; test -d "$d" || { echo "queue directory absent: $d" >&2; exit 1; }; c=" {{CLAIMED_TAGS}} "; n=0; for f in "$d"/*.json; do test -e "$f" || break; n=$((n+1)); b="${f##*/}"; t="${b%.json}"; m=""; case "$c" in *" $t "*) m=" [in flight]" ;; esac; printf '=== %s%s\n' "$b" "$m"; cat "$f"; done; test "$n" -gt 0 || echo "(queue empty)"`
</pending-now>

{{CLAIMED_ENTRIES}}

<plan-state>
!`p="{{PLAN_STATE_PATH}}"; test -e "$p" || { echo "(no plan state yet)"; exit 0; }; cat "$p"`
</plan-state>

<plan-state-shape>
Your plan state file takes one of these JSON shapes; each `<...>` is a value you fill, and a field not shown is refused:
{{PLAN_STATE_SHAPE}}
</plan-state-shape>

<open-questions-index>
{{QUESTIONS_INDEX}}
</open-questions-index>

<artifacts>
queue (one `<tag>.json` per entry): {{PENDING_DIR}}
your plan state (this slice's own file): {{PLAN_STATE_PATH}}
open questions: {{QUESTIONS_DIR}}
record queues: {{RECORD_DIRS}}
discipline: {{DISCIPLINE}}
</artifacts>

{{DOMAIN}}

# TASK

Derive the spec changes since `derivedThrough` into pending entries. The spec locus ({{SPEC_LOCUS}}) is the source of truth: ratified intent changes there before it changes anywhere, and each changed or added section becomes the entries that make the tree match it. Search the codebase before assuming a section unimplemented — a commit listed alongside may already have landed it, in which case the section is judged done in the commit body, not derived.

Each entry: `per` cites the section verbatim; `files` names the exact paths the work will touch, tests included; `blockedBy` when a prior entry must ship first; `acceptance` is one line that turns green; `tests[]` one line per behavior. Discrete, independently shippable units (`PROTOCOL.md`, *What makes an entry good*). A section that would need many large entries is a signal to file a spec-split open question, never to compress; the spec is sized for intent, not for plan's character budget. Read the open questions before parking: a "do not derive until X" question may already govern the section, and one already open takes an amendment to its own file.

**The cursor.** `<spec-window>` renders spec commits oldest-first with their diffs, within a budget, and names the sha the cursor may advance to. Advance `derivedThrough` to the last commit whose every changed section you derived into entries, judged done, or parked as a named question — never further, never as bookkeeping. A spec commit landing mid-tick is exactly the race this cursor exists to survive.

Discipline: `{{DISCIPLINE}}` — read it before writing the queue.

{{PUT_DOWN}}

{{TURN_BOUNDARY}}

{{AUTONOMY}}

# OUTPUT

One commit prefixed `plan:`; the body names each derived section and its entries, or why it needed none. Close per *Closing a slice* in the discipline file.

<schema>
{{PENDING_SCHEMA}}
</schema>
