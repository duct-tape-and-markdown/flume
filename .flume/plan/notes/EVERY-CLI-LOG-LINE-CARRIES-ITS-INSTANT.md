# The pre-dispatch refusals still reach the operator unstamped

Shipped: `src/cliLog.ts` (`stampLines`/`stampedLogger`), handed to
`superviseLoop` and the tick's `Dispatcher`, and the 23 `console.*` calls
inside `src/cli.ts`'s `tick` and `loop` branches routed through it.

Two things the next plan tick should weigh.

**1. A gap against the spec sentence read literally.** Five refusals sit
above the verb dispatch in `src/cli.ts` and are shared by every verb: bay
discovery's stat failure, the bay/root disagreement, the state-root
resolution refusal, the state-root open failure, and
`tipClaimHandoffRefusal`. A `flume loop` or `flume tick` that takes one
writes an unstamped line. I left them
unstamped on purpose: stamping there stamps `flume status`, `log --json`,
`check`, `friction` and `render` too, and those verbs' stdout is data a
pipe reads, not narration. The fence I took is "the two running verbs'
own branches"; the spec says "the CLI's supervisor and its tick
children", which those refusals arguably are. If that reading is wanted,
it is a per-site call at five sites, not a mechanism change.

**2. A fact the engine was not reporting.** `defaultTickRunner`
(`src/loopSupervisor.ts`) wrote its one line — a spawn that produced no
child — through `consoleLogger` directly rather than the run's own `log`,
so a caller routing a `Logger` never saw it. Threaded the run's logger in.
Worth a sweep lens: it is the same shape as *Consumer restatement*
(`.claude/rules/posture-sweep.md`) pointed inward — an internal site
reaching for a default beside an injected value it already has.

Not filed as debt: the observational verbs above stay on `console.*` by
design, and the split is stated at the `operatorLog` construction site.
