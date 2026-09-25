# SWEEP WINDOW

<sweep-window>
{{SWEEP_WINDOW}}
</sweep-window>

<plan-state>
!`p="{{PLAN_STATE_PATH}}"; test -e "$p" || { echo "(no plan state yet)"; exit 0; }; cat "$p"`
</plan-state>

<plan-state-shape>
Your plan state file takes one of these JSON shapes; each `<...>` is a value you fill, and a field not shown is refused:
{{PLAN_STATE_SHAPE}}
</plan-state-shape>

<pending-now>
!`d="{{PENDING_DIR}}"; test -d "$d" || { echo "queue directory absent: $d" >&2; exit 1; }; c=" {{CLAIMED_TAGS}} "; n=0; for f in "$d"/*.json; do test -e "$f" || break; n=$((n+1)); b="${f##*/}"; t="${b%.json}"; m=""; case "$c" in *" $t "*) m=" [in flight]" ;; esac; printf '=== %s%s\n' "$b" "$m"; cat "$f"; done; test "$n" -gt 0 || echo "(queue empty)"`
</pending-now>

{{CLAIMED_ENTRIES}}

<open-questions-index>
{{QUESTIONS_INDEX}}
</open-questions-index>

<artifacts>
queue (one `<tag>.json` per entry): {{PENDING_DIR}}
your plan state (this slice's own file): {{PLAN_STATE_PATH}}
open questions: {{QUESTIONS_DIR}}
record queues: {{RECORD_DIRS}}
project conventions: {{PROTOCOL}}
discipline: {{DISCIPLINE}}
</artifacts>

{{DOMAIN}}

# TASK

Apply the declared posture pages to code that already exists. Those pages bind this slice — the frontier, what a neighborhood is, when a rotation closes, the routing bar, the cursors, the stamp — so read them now, in full, as they read this tick; a page `<sweep-window>` does not name is one this range left untouched, not one that stops binding. Nothing below restates a ruling of theirs. You sweep **neighborhoods**, one after the next, until the budget line below says to put the rotation down; that line is the bound, and how wide the rotation it bounds is stays the pages'.

**What the blocks above carry.** `<sweep-window>` lists the sweep-domain paths the commits past `sweptThrough` touched — each named once, whatever number of those commits touched it — then the posture pages that range touched, then the lines the spec locus no longer states, each under the locus page it left. Each block says in its own banner what it is and what a sha it names is for; read the banners, not a paraphrase of them here. `<plan-state>` is your state file as this tick found it, and what you write replaces it whole.

**Which field holds which cursor.** In your plan state, `sweptThrough` is the stamp, `rotation` is the rotation with its settled modules under `covered`, and `retiredThrough` is the retired-claim cursor; `<plan-state-shape>` spells the exact JSON. Every sha you write is copied from the banner that names it as this tick's advance, never one you resolve yourself — and where the retired-claim block names none, it rendered as a prefix: search what it shows and leave `retiredThrough` as you found it. That field dropped is not blank but the stamp, which re-opens every line the locus has retired since.

Findings route by the pages' own bar into this slice's three homes — the queue, a question file, your commit body. Which home a finding takes, and what makes one count as a finding at all, is theirs to say, read whole rather than off this paragraph.

Discipline: `{{DISCIPLINE}}` — read it before writing the queue.

{{PUT_DOWN}}

{{TURN_BOUNDARY}}

{{AUTONOMY}}

# OUTPUT

One commit prefixed `plan:`; the body names the neighborhoods swept and each finding's route. Close per *Closing a slice* in the discipline file.

<schema>
{{PENDING_SCHEMA}}
</schema>
