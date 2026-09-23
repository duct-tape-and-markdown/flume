# blamesSpan shipped; two follow-ons the entry could not carry

**No consumer declares it yet.** `blamesSpan: false` is live on `GateResult`,
but nothing in `harness/` or `.flume/` sets it, so the withholding arm is
exercised only by tests. The obvious first consumer is `harness/judgeGate.ts`:
it already reports a suite red at the base as `verdict: "base-red"`
(JUDGE-REPORTS-A-SUITE-RED-AT-THE-BASE-AS-BASE-RED), which is exactly the
case the spec section names. Wiring it changes this repo's own quarantine
behavior — a base-red build tick would stop holding its entry — so it is a
policy call, not a mechanical follow-through. Worth its own entry.

**`failingFiles` now reaches the gate-revert record.** The `per` section says
it is copied onto the verdict row *and* the record; the record never carried
it, because the retired derivation was the only reader. Added, so the
sentence is true. `GateRevertAttempt` gained the field beside `blamesSpan`.

**Left undone: a 0.18 migration note.** Dropping
`GateRevertAttempt.suspectFlake` breaks a chain whose `shouldRun` reads it,
and the repo's convention is that the build tick shipping a break writes
`docs/MIGRATING-<next>.md`. The entry's acceptance reads "suspectFlake exists
nowhere in src/, tests/ or docs/", and a note that walks the break must name
it — the two cannot both hold. I took the acceptance and wrote no note.
`docs/MIGRATING-0.18.md` owes a section for this break at the cut; plan may
want an entry for it, and may want such an acceptance phrased against live
surface rather than all of `docs/`.

**MIGRATING-0.13 § 2.7: amended, not left.** Its text now names only
`failingFiles`. The series is a path a consumer walks forward, so telling
someone upgrading through 0.13 today to adopt a field 0.18 removes is worse
than dropping the sentence; CHANGELOG's 0.13 entry keeps the record.
