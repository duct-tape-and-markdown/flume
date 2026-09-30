# TickResult.platformFailures had no assertion in the suite at all

Observed while placing the pin: before this tick `platformFailures` appeared
nowhere under `tests/` — not the field, not a class string. Its sibling
`provisionFailures` is read at ~39 sites, so the gap is this one field's.
The two cases added are the first read of it, and the other classes that
reach it are still unpinned for content:

- The non-zero-exit arm of `invokeAgent` (`src/tickAttempt.ts`). The
  existing `platform-preempt` case asserts `exited with code 137` through
  the *retry prompt* text only, never through the reported record, so the
  exit-code class and the record it becomes are two unjoined claims.
- The provision/render/ship legs: `stageFailureFacts((err as Error).message)`
  at eight call sites across `src/waveTick.ts` and `src/singletonTick.ts`.
  Nothing pins that a thrown message reaches `platformFailures` rather than
  only the log.

Not filed as a finding here because it is coverage breadth, not a defect
this entry's `per` reaches. Flagging it because the field's stated job is a
supervisor comparing one tick's preempt against the next's by `signature`,
and a signature nothing reads in a test is the vacuity that section warns
about, one surface up from the arm just pinned.

Second, smaller: the two class *strings* are still authored at the
classifier and re-spelled as literals in the test. That is the ordinary
shape for an assertion, and the seam this entry pinned is the abort's
`name`/`code` keys, not the wording — noted so a later reading does not
mistake the literals for the duplication the entry was about.
