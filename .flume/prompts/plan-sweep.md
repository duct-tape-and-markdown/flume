# SWEEP WINDOW

<sweep-window>
!`node .flume/delta-window.mjs sweep`
</sweep-window>

<state>
!`cat .flume/plan/state.md`
</state>

<pending-now>
!`cat .flume/plan/pending.json`
</pending-now>

<open-questions-index>
!`grep -n '^## ' .flume/plan/open-questions.md || echo "(none open)"`
</open-questions-index>

# TASK

Apply the posture pages to code that already exists. `.claude/rules/posture-sweep.md` binds this slice — the frontier, the neighborhood bound, the cursor, the routing bar, the stamp; read it now, then the posture pages it names. One neighborhood per tick.

`<sweep-window>` lists the commits past `Posture swept through:` that touched the sweep domain or a posture page, and the spec lines those commits deleted — the retired-claim delta. `<state>` carries the open rotation's covered set, if one is open; covered is settled and is never re-swept.

Findings route per the rule: correctness-adjacent → a pending entry citing the owning section; pure shape → an accepted-debt line in the commit body; a design fork → an open question naming the section and the fork. A violation counts only when verified on disk this tick.

**The cursor and the rotation.** An open rotation is a paragraph in `state.md` beginning `Rotation open`, carrying the covered set; the chain keeps this slice live while that paragraph exists. When the frontier empties, delete the paragraph and advance `Posture swept through:` to the sha the frontier was derived from. Quiet-on-clean advances the stamp alone.

Discipline: `.flume/prompts/plan-discipline.md`.

# OUTPUT

One commit prefixed `plan:`; the body names the neighborhood swept and each finding's route. Close per *Closing a slice* in the discipline file.

<schema>
{{PENDING_SCHEMA}}
</schema>
