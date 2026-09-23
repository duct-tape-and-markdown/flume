# A vitest report claiming success over a non-zero exit — does the fact earn a platform-facts section?

`readRun` (`harness/vitestRunner.ts`) now refuses a report-derived `ok: true`
over a non-zero status, and the case that pins it runs real vitest:
`UNHANDLED_TEST` (`tests/harnessRunner.test.ts`) passes its assertion while a
rejection nobody awaited reaches vitest's unhandled-error check, which sets the
exit code **after** the JSON reporter has computed `success` from the files that
reported. Measured on vitest 2.1.9 / linux by the build tick that shipped it.

That is an external toolchain fact, and `CLAUDE.md` names its home:
`.claude/rules/platform-facts.md` is "the home for facts about the toolchain and
host OS … a code comment carrying one is a copy the harness should own instead,
seen only by an agent that already opened that file." Today the fact lives
only in that fixture's doc comment. Your surface — build cannot write the page.

Why it is more than tidiness: the fixture *is* the case's producer, so the fact
is load-bearing for the test. If a later vitest folds unhandled errors into
`success`, the fixture stops producing the contradiction and the case reds with
nothing wrong in `harness/` — and the agent reading that red has no page
telling it the fixture expired rather than the runner.

## Options

1. **Add the section, stating the expiry condition, and let the comment cite
   it.** The section carries the measured behavior and the condition that
   retires it ("a vitest that folds unhandled errors into `success`"); the
   fixture comment keeps its own rationale — why *this* file produces the
   contradiction — and points at the page for the vitest behavior. The
   condition, not the version era, per `engineering.md`, *Narration is the
   ladder's bottom rung*; the version is the measurement, not the scope.
2. **Add the section and shrink the comment to a pointer.** Tighter, and it
   strands something: the comment is also the case's vacuity rationale, so a
   bare pointer leaves the reader of the fixture without why it is shaped this
   way — the orphaned-claim failure that same section names.
3. **Leave the fact in the fixture comment alone.** Cheapest, and it is the
   arrangement CLAUDE.md calls the wrong home: invisible to every agent that
   did not open `tests/harnessRunner.test.ts`, re-measured on the next vitest
   bump.

I'd take 1. If you add the section, the derive slice picks the spec-locus
change up next rotation and files the comment's pointer as an entry; nothing
else is queued against this.

Filed from the build note on
`VITEST-RUNNER-REFUSES-A-SUCCESS-REPORT-OVER-A-NONZERO-EXIT`.
