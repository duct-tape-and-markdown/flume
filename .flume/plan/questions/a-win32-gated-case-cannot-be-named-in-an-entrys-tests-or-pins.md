# A win32-gated case cannot be named in an entry's `tests[]` or `pins[]`

The ruling landed: `.claude/rules/engineering.md`, *A fix ships the test that
would have caught it* now says a defect only one host exhibits ships its case
gated to that host, the lane there is the proof, and the case need not red on
the build host's base. The inbox record that carried the ruling put the
consequence for the queue plainly — "the five win32 entries gain
`runIf(win32)` cases, not an empty `tests[]`".

**The entry surface cannot express that today, and the judge walls it.**
Measured on this tree:

- The runner counts a line carried only by a test whose report status is
  `passed` (`harness/vitestRunner.ts`, the `passing` filter in `readRun`). A
  `describe.runIf(process.platform === "win32")` case on the linux build host
  reports as skipped, not passed.
- So the line resolves to `unnamed` (`harness/judge.ts`, `LineState`) — "no
  passing test on the merged tree carries the name" — which is a verdict the
  judge gate reports against the entry. `pins[]` is no escape: it relaxes the
  base half only, and the merged-tree half is exactly the half a skipped case
  fails.
- `spec/harness.md`, *The judges* states two lanes and no third: `tests[]`
  green on the merged tree and red at the base, `pins[]` green only. Nothing
  there describes a line whose case the build host does not run.

So the ruling and the mechanism disagree. A build tick that follows the rule
and declares the case is walled; one that ships the case and declares nothing
satisfies the judge, and the entry then claims no property — which is the
state the ruling was written to end.

## The fork

**(a) The case ships, the entry claims nothing.** Status quo: the `runIf` case
lands in the diff, `tests[]` stays empty, the entry's `acceptance` and the
commit body name the case and the lane. Cheapest, and it is what the two
standing win32 entries already do.

- Against: nothing on the entry surface says the case exists, so a build tick
  that ships no case at all is indistinguishable from one that shipped a good
  one. The ruling's "not an empty `tests[]`" is a direct answer to exactly
  that, so (a) is the option the ruling rejects.

**(b) A third line state, reported as a fact.** The runner already parses the
whole report; have it report the named line as carried by a *skipped* case,
and the judge report a `host-skipped` line state beside `proven`, `carried`,
`unnamed` and `green-on-base`. The gate's policy then decides — accept it as a
declared line whose proof is the other host's lane, and say so in the verdict.

- For: it puts the claim on the line the entry declares, and it is the engine's
  own posture — a fact reported, never a verdict inferred
  (`.claude/rules/engine-boundary.md`, *Told, not inferred*). One filter in
  `readRun`, one state in `LineState`, one sentence in `spec/harness.md`,
  *The judges*.
- Against: a line nothing on this host ever ran is a green the judge is
  passing over — the shape *A green verdict is proven non-vacuous* exists to
  refuse. It is honest only while the verdict says out loud which host owes
  the proof, and while a lane actually reports it, which needs
  A-RED-STANDING-LANE-IS-READ-FROM-AN-ANCESTORS-FAILED-RUN to have shipped.

**(c) Claim the ledger instead of the case.** `tests/helpers/host-declarations.json`
already records every host-gated skip with its reason, and
`tests/hostDeclarations.test.ts` pins that every declared skip has one. That
pin is green on the linux host, so an entry *can* claim it today.

- Against: the pin's title is fixed and suite-wide, so every win32 entry would
  name the same line, and the line asserts only that a skip is ledgered — not
  that the case exists, and not what it asserts. It buys bookkeeping, not proof.

**(d) A win32 runner for build.** The only option that puts the proof where
the fix is; priced out already in this directory's predecessor question as out
of scope for the v0 line.

**My read: (b), and it is small.** (a) is ruled out by the ruling itself, (c)
claims the wrong thing, (d) is a host purchase. The decision I cannot make is
whether a line proven only by another host's lane may ride `tests[]` at all,
or wants its own array — `hostTests[]`, or a per-line `host` qualifier — so
that reading an entry never suggests the build host proved something it
skipped. That is a shape call on the entry schema, which is spec.
