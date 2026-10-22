# The capture reports both streams; two fixture facts worth a page

Shipped as planned: `CapturedRun` gains `stderr` on both legs, `lastOutput`
(`harness/toolRun.ts`) renders the tail of both streams, and the three
refusals over output a runner could not read quote it — vitest's no-report
and report/exit-disagreement arms, and the script runner's unanswered-name
arm. Both streams are named every time, so an empty one reads as "(nothing)"
rather than as a quote that went missing.

Two things the next tick may want:

1. **`node -e <code>` parses later `--opts` as node options.** The vitest
   runner appends `--reporter=json --outputFile=…` to whatever `invoke`
   declares, and a `process.execPath -e …` stand-in exits 9 with `bad
   option: --reporter=json` before the script runs — so the fixture ends its
   args with `--`. The pre-existing `["-e", ""]` no-report case has been
   passing off that refusal rather than off the silence it names; it still
   refuses for the right reason, but its premise is node's, not a silent
   tool's. A fixture-authoring fact, candidate for
   `.claude/rules/platform-facts.md` if plan wants it homed.

2. **`ScriptReport` still carries stdout alone**, deliberately: the declared
   reader's contract is "the whole of stdout, parsed however it is written",
   and widening it is a consumer-surface decision nobody has made. A
   validator that reports its document on stderr cannot be read today — its
   output reaches the refusal but never the reader. Worth a question if any
   consumer wants it.

Also measured: the capture's catch arm now requires `code`, `stdout` and
`stderr` together, since node attaches both captured streams to the error at
once; an error carrying one and not the other is rethrown rather than
reported with an empty stream nobody read.
