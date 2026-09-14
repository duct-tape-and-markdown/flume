# No render verb; consumers hand-build prompt verification (consumer-chain survey, re-date)

0.15.0's CLI verbs are check, friction, job, log, loop, sleep, status, tick,
wake. No `render`. Removed in 0.10 with no replacement.

New evidence: prompt verification is a need every consumer meets differently,
and one met it well enough to catch a real defect.

- One consumer pins the exact wording of the engine's rendered `files` clause
  and throws at render if it changes (`.flume/chain.ts:275-291`). 0.15.0
  reworded that sentence, so the assert now fires on every plan tick. It is
  the only mechanism in five surveyed consumers that turned an engine change
  into a loud failure rather than a silent one.
- Two migration seats separately drove `loadChainModule` + `renderPrompt` from
  scratch hosts to compare before/after renders (byte identity, unresolved-slot
  counts).

Why it matters: verifying one's own rendered prompt means reaching past the
public surface, and the one consumer that did is now bricked by the change its
check was built to detect — the check working, and no supported way to run it.

Filed 2026-08-06; verified unchanged on 0.15.0 today.
