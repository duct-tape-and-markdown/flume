# The stamp now reaches lines the spec sentence does not name

All six sites landed on one module-scope `operatorLog` in `src/cli.ts` — the
in-`dispatch` construction moved up, so `main`'s write-refusal arm shares it
rather than building a second one. Unbranched, as the entry directed.

Two things for the next plan tick.

**The spec sentence is narrower than the shipped behavior.** `spec/cli.md`, *A
log line carries the instant it was written* scopes the stamp to "the CLI's
supervisor and its tick children". Four of these six refusals are reached
before the verb branch, so `flume status`, `flume log`, `flume check`,
`flume render` and `flume friction` now write a stamped line too when bay
discovery, the bay/root disagreement, state-root resolution, or an obstructed
root refuses them. Each is stderr and no verb's piped stdout moved, which is
the acceptance's own reasoning — but the sentence still reads as though a
`status` refusal is unstamped. Either the sentence widens to "every line the
CLI writes as narration" or it names the pre-verb refusals as the exception it
already tolerates. `tests/cliHelp.test.ts`'s `REFUSAL_SUBJECT` is where that
reading is now encoded: it admits an optional stamp because a `status` refusal
over the state root carries one and a `status` refusal over `loop.pid` does
not.

**`docs/CLI.md` is uneven on it.** The `flume tick` section (line ~50) claims
"each refusal above" opens with its instant — over-broad on the pre-fix tree,
true now. The `flume loop` section states nothing about the stamp at all, so
an operator reading only that section learns it from `tick`'s page or not at
all. Not filed here; the entry's acceptance was behavior-only.

The stamp spelling is now single-homed at `tests/helpers/stampedLine.ts`
(regex source, the optional-prefix fragment, `narratedLines`,
`expectStampedDuring`), since two suites read it.
