# The closure refusal lands after the commit; the harness could say it before

The engine now refuses a `shipped` list that is not closed downward over the
offered subtree (`unshippableTags`, `src/waveMerge.ts`). That refusal fires at
the merge stage, after the commit landed and gated: the entry stays queued, the
tick is spent, and the operator line is the only place the stranded substep is
named.

The harness's own half can say it a step earlier and does not. The build prompt
lists `<steps>` flat (`stepsBlock`, `harness/prompts.ts`) with no hint that a
step can carry substeps, and the records gate checks only that a named tag is
one the entry carries — not that naming a mid-level step obliges its substeps.
So on a nested entry a session writing the natural `Finished steps:` line gets
an engine ship refusal rather than a gate refusal it could fix in the same tick,
which is the slower of the two loops by a whole wave.

Two candidate entries, both in `harness/`, neither filed here:

- the records gate refuses a `Finished steps:` line that names a step without
  its substeps, with the respelling it wants — the same closure read, one layer
  up, where the commit is still the tick's to amend;
- the prompt's `<steps>` block renders the nesting (or states the obligation),
  so the line a session writes can be right the first time.

Observed, not measured in the wild: nothing in this repo's queue nests steps
today, so the engine arm is the only one with a test behind it.
