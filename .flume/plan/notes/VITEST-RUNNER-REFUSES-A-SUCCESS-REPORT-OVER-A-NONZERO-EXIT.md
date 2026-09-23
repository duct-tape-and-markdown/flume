# The vitest runner's refusal leans on a vitest behavior, not a flume one

Shipped: `captureRun` (`harness/toolRun.ts`) returns `CapturedRun`
(`{ stdout, status }`); a failed spawn and a signal kill still throw, so a
reported `status` is always a real exit code. `readRun`
(`harness/vitestRunner.ts`) refuses exactly the contradiction — report-derived
`ok` true over a non-zero status — and an ordinary red suite reads as its
failures. `scriptRunner` takes `{ stdout }` and declines the status at its
header, bounded by the answer-set reconciliation.

Two things worth a plan tick's attention.

**The tests[] fixture pins vitest, not us.** Measured on vitest 2.1.9/linux:
an unhandled rejection sets `exitCode = 1` after the JSON reporter has already
computed `success` from the files that reported, which is how the case
produces a green report over a failed run. If a later vitest folds unhandled
errors into `success`, that fixture stops producing the contradiction and the
case reds with nothing wrong in `harness/`. That is an external fact of the
kind `.claude/rules/platform-facts.md` holds, and build cannot write there —
routing it so a human can decide whether it earns a section.

**Two shipped runners now diverge on what a status means**: vitest rules on
it, scriptRunner declines it. Both divergences are declared and cited at their
sites, so nothing is filed here. But the decision is spelled twice, and a
third runner would spell it a third time; if one ships, the question "what a
captured status means to a runner" wants a stated home rather than a comment
per module.
