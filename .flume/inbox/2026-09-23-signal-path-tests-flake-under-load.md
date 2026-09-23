# The signal-path tests carry timing bounds that fail under gate load

Three reverts or CI reds in 24 hours, none a regression:

- `tests/cli.test.ts`, "a bare tick whose agent ignores SIGTERM kills it
  after the declared grace rather than exiting over a live writer" —
  `expected 4141 to be less than 2500`, during a two-wide wave (reverted
  ONE-STATE-ROOT-LISTING-PROVES-ITS-ABSENCE at 8686a8e3's wave).
- `tests/loopSupervisor.test.ts`, "a chain declaring neither supervisor knob
  gets both defaults" — `Test timed out in 5000ms`, while four suites ran
  beside the wave (reverted CITATION-VERDICTS-NAME-THEIR-SITES-IN-THE-FIRST-LINE).
- `tests/tip-claim.integration.test.ts`, "a signalled bare flume tick
  releases its tip claim on POSIX" — `expected true to be false` on the
  posix CI lane at 8686a8e3; green locally and on re-run, and no commit
  since the prior green touches signal handling.

Each asserts a wall-clock bound around a real child's signal handling, and
the bound is sized for a quiet host. The base-red arm cannot catch these
(green at the base too), so each costs an attempt and a retry. Worth one
look at whether the bounds derive from the declared grace with headroom, or
whether the cases poll for the state they assert rather than sleeping a
fixed budget (`engineering.md`, *A green verdict is proven non-vacuous*:
a bound that reds on load proves the load, not the property).
