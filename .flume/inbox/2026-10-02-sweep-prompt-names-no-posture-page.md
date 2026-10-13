# The sweep prompt names no declared posture page, and ships no sweep procedure (cartograph)

Where: the `plan-sweep` prompt as 0.21.0 renders it (`flume render plan-sweep` in cartograph, after cartograph declared `slices.sweep.posturePages`).

Observed:
- The task says "Apply the declared posture pages" and "Those pages bind this slice — the frontier, what a neighborhood is, when a rotation closes, the routing bar, the cursors, the stamp". No block lists the declared pages. `<sweep-window>` names a page only when the window's commits touched it, so a steady-state render names none.
- Neither the prompts nor the discipline page carry the procedure the task defers to those pages: the routing bar, the three-notes rule, covered-is-settled, the standing lenses. Flume's own sweep has them only because `.claude/rules/posture-sweep.md` is always-on in this repo, and it is not among this repo's declared posture pages.

Why it matters: a consumer's sweep tick is told to apply pages it is never shown, by a procedure it is never given. Every consumer that enables the sweep has to copy flume's procedure page into its own rules to get a working slice. Cartograph did, as a stopgap that retires when the package ships both. That is the verbatim-copy detector (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).

Options:
- Render the declared posture pages in a block of their own on every sweep render, and ship the procedure in the package's sweep prompt or discipline page.
- Declare the procedure page as a field beside `posturePages`.
