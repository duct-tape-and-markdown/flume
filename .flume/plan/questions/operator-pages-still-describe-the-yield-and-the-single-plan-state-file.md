# Three claims on this repo's operator-owned pages are now false

`CLAUDE.md` and `.flume/PROTOCOL.md` sit outside every phase's fence — build's
fence is `src/ harness/ tests/ bin/ examples/ docs/ scripts/` plus root config
(`.flume/declaration.ts`), and the plan slices write only plan artifacts. So no
autonomous tick can correct these, and they are accumulating.

Verified on disk this tick:

1. **`.flume/PROTOCOL.md:84`, *A landing does not wake plan*** — "the inbox
   slice yields to pickable work whatever the marker says, so a wake against a
   live queue is declined". No leg yields any more: since
   `EVERY-WINDOW-IS-LIVE-ON-ITS-OWN-WORK` (acddabd), a record, a friction note
   or a standing refusal opens the window whatever the queue carries. The
   surrounding advice — batching is free, a landing need not earn
   `flume wake plan-inbox` — still holds on its own terms; only the reason given
   for it is gone.
2. **`.flume/PROTOCOL.md:70`** — "Each owns one cursor in the plan state
   (`plan/state.json`, typed fields ...)". Two errors: the artifact is now
   `plan/state/<slice>.json`, one file per writer, and the inbox slice owns
   `drainedRuns`, not a cursor. No cursor is shared.
3. **`CLAUDE.md:24`, *Workflow: Flume*** — "plan state at
   `.flume/plan/state.json`". The file is gone; the directory is
   `.flume/plan/state/`.

`.claude/rules/spec-plan-build.md` already says `state/`, so that table is
right and is the wording to copy.

**Recommendation, not a fork.** All three are stale statements of shipped
behavior, not decisions — an interactive session under human direction can make
the edits in one pass. Raised here because the expired-narration lens
(`posture-sweep.md`) names `.flume/PROTOCOL.md` as its own domain but the sweep
has no way to write there either.
