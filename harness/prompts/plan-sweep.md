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
!`d="{{PENDING_DIR}}"; test -d "$d" || { echo "queue directory absent: $d" >&2; exit 1; }; n=0; for f in "$d"/*.json; do test -e "$f" || break; n=$((n+1)); printf '=== %s\n' "${f##*/}"; cat "$f"; done; test "$n" -gt 0 || echo "(queue empty)"`
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
discipline: {{DISCIPLINE}}
</artifacts>

{{DOMAIN}}

# TASK

Apply the declared posture pages to code that already exists. Those pages bind this slice — the frontier, what a neighborhood is, the cursor, the routing bar, the stamp; `<sweep-window>` names them, and you read them now, in full, as they read this tick. You sweep **neighborhoods** — one frontier module read together with its immediate imports, then the next — until the budget line below says to put the rotation down. That line is the bound, not a count: a rotation a phrase delta armed is the whole domain, and one module per tick prices it at a hundred ticks.

`<sweep-window>` lists the sweep-domain paths the commits past `sweptThrough` touched — each named once, whatever number of those commits touched it — then the posture pages that range touched, each of which is a phrase delta putting every sweep-domain module in the frontier, then the spec lines the range deleted — the retired-claim delta. `<plan-state>` carries the open rotation's covered set, if one is open; covered is settled and is never re-swept, even where fresh judgment would cut the boundary differently.

Findings route per the pages' own bar: correctness-adjacent → a pending entry citing the owning section; pure shape → an accepted-debt line in the commit body; a design fork → an open question naming the section and the fork. A violation counts only when verified on disk this tick, cited by symbol and line — a finding read off a remembered impression, a commit message, or a prior tick's note does not count.

**The cursor and the rotation.** An open rotation is `rotation: { kind: "open", covered: [...] }` in the plan state; the chain keeps this slice live while it is open. When the frontier empties, close the rotation and advance `sweptThrough` to the tip `<sweep-window>` names as the one it was drawn from — copy that sha, never one you resolve yourself. Quiet-on-clean advances the cursor alone.

Discipline: `{{DISCIPLINE}}` — read it before writing the queue.

{{PUT_DOWN}}

{{TURN_BOUNDARY}}

{{AUTONOMY}}

# OUTPUT

One commit prefixed `plan:`; the body names the neighborhoods swept and each finding's route. Close per *Closing a slice* in the discipline file.

<schema>
{{PENDING_SCHEMA}}
</schema>
