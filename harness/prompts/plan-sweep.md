# SWEEP WINDOW

<sweep-window>
{{SWEEP_WINDOW}}
</sweep-window>

<plan-state>
!`p="{{PLAN_STATE_PATH}}"; test -e "$p" || { echo "(no plan state yet)"; exit 0; }; cat "$p"`
</plan-state>

<pending-now>
!`cat "{{PENDING_PATH}}"`
</pending-now>

<open-questions-index>
{{QUESTIONS_INDEX}}
</open-questions-index>

<artifacts>
queue: {{PENDING_PATH}}
plan state: {{PLAN_STATE_PATH}}
open questions: {{QUESTIONS_DIR}}
record queues: {{RECORD_DIRS}}
discipline: {{DISCIPLINE}}
</artifacts>

{{DOMAIN}}

# TASK

Apply the declared posture pages to code that already exists. Those pages bind this slice — the frontier, the neighborhood bound, the cursor, the routing bar, the stamp; `<sweep-window>` names them, and you read them now, in full, as they read this tick. One neighborhood per tick.

`<sweep-window>` lists the commits past `sweptThrough` that touched the sweep domain or a posture page, and the spec lines those commits deleted — the retired-claim delta. `<plan-state>` carries the open rotation's covered set, if one is open; covered is settled and is never re-swept, even where fresh judgment would cut the boundary differently.

Findings route per the pages' own bar: correctness-adjacent → a pending entry citing the owning section; pure shape → an accepted-debt line in the commit body; a design fork → an open question naming the section and the fork. A violation counts only when verified on disk this tick, cited by symbol and line — a finding read off a remembered impression, a commit message, or a prior tick's note does not count.

**The cursor and the rotation.** An open rotation is `rotation: { kind: "open", covered: [...] }` in the plan state; the chain keeps this slice live while it is open. When the frontier empties, close the rotation and advance `sweptThrough` to the tip `<sweep-window>` names as the one it was drawn from — copy that sha, never one you resolve yourself. Quiet-on-clean advances the cursor alone.

Discipline: `{{DISCIPLINE}}` — read it before writing the queue.

{{TURN_BOUNDARY}}

{{AUTONOMY}}

# OUTPUT

One commit prefixed `plan:`; the body names the neighborhood swept and each finding's route. Close per *Closing a slice* in the discipline file.

<schema>
{{PENDING_SCHEMA}}
</schema>
