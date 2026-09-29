# Ruled: the render helpers' exports, and the platform wall

- *Render helpers ship as values with no error values beside them* — (a):
  the entry point stops exporting `renderPrompt` and `readPhaseTemplate` as
  values. Both ride `FlumeApi`; standalone rendering's supported surface is
  the `flume render` verb. Per `engineering.md`, *An export earns its
  consumer*, and the pre-1.0 clean-slate posture: no shim. Docs that teach a
  root import move with it.
- *What bounds a run spent on a wall no tick can move* — half 1 (a): a fifth
  `platform` stage in the repeated-failure accounting, backstop only, blamed
  on no entry (`spec/loop.md`, *Repeated identical failures*); the existing
  "only a tagged failure quarantines" is the exclusion. The verdict records
  the preempt so the supervisor can count it. Half 2 (d): the handoff's
  exclusion is one tick deep and the backstop is the bound
  (`spec/harness.md`, *The default `handoff`*); the doc comment claiming
  "it costs one tick" shrinks to match. No phase-level quarantine.
