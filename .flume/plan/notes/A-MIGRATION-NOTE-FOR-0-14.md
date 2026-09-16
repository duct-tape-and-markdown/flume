# 0.15 is the last noteless minor, and the series is now a chain

Shipped. The note series is contiguous 0.10 through 0.14 and resumes at
0.16; `0.15.0` is the only released minor with a `### Breaking` section and
no note. The packaging pin computes the gap off the tree, so 0.16's opener
is the sole page still naming an uncovered minor, and it names exactly one.
A 0.15 note would empty `spanning` and red that test's non-vacuity guard
(`tests/harnessPackaging.test.ts`, "every docs/MIGRATING note names the
minors it does not cover ahead of its first section"); the assertion needs a
skipped-nothing arm before the last gap closes. Worth an entry of its own if
plan files 0.15.

Sourcing: 0.14's before/after shapes came from `git show v0.13.0:` /
`v0.14.0:`, not the working tree. Three the changelog implies are not what
0.14 held — `api.git` carried `showNameOnly` alone (no `readFileAtRef`),
`STATE_ROOT_NAMES`/`resolvePendingPath` were never on the exports map, and
`ensureRuntimeIgnores` ran from `flume job new` alone. A note derived from
changelog prose would have named three calls that did not exist.
