# A tests[] line cannot name a green-on-arrival pin

Acceptance asked for the RUNTIME_IGNORES pin "green on arrival and rides a
sensitivity control", but it was also a `tests[]` line — and `redOnBase`
(`.flume/chain.ts`) requires *every* named line to lack a passing test at the
base. Green-on-arrival + named is an automatic revert.

It shipped because the pre-fix bullet was genuinely unreadable, not because
the pin was bent: "Merging the runtime `.gitignore` entries (`awake/`, …)"
puts `.gitignore` inside the naming run, so the shared em-dash-cut reader
claims seven entries where RUNTIME_IGNORES carries six. Moving the filename
past the dash is what flips it.

For plan: a pin that agrees on arrival belongs in the entry's prose, not in
`tests[]` — or the entry names the doc change that makes it flip. Same shape
will recur on every doc-agreement entry where the doc already happens to be
correct.

Also hoisted `regionLines`/`claimChunks`/`claimedPaths` in
tests/retired-narration.test.ts to module scope; both doc pins now read
markdown through one set of readers.
