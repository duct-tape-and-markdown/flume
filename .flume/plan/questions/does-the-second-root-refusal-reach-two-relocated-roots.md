# The second-root refusal misses the shape the report was about: widen the evidence, or narrow the spec sentence?

`spec/jobs.md`, *The checkout is the unit of isolation* (`:54`-`:59`) now
states: "a state root resolved in a checkout whose flume state already names a
different one is refused at resolution, naming both roots and the checkout,
before anything is provisioned."

The refusal shipped at f76a8eed. Its evidence is the checkout's *bay*: a
resolved `flumeDir` that is not `<repoRoot>/.flume`, in a checkout whose
`<repoRoot>/.flume` holds one of `STATE_ROOT_NAMES` — a baton, a worktree
base, a verdict log (`checkoutStateRootArtifact`, `src/cliStateDirs.ts:106`).

## What that does not reach

The report it was filed off runs three efforts in one clone, **each with its
own `FLUME_DIR`**. None of them writes into the bay, so the bay holds the
chain and nothing else, and `checkoutStateRootArtifact` answers `undefined`
for all three. Measured this tick against a checkout whose `.flume` holds only
`chain.ts`:

```
effort a: RESOLVED flumeDir=/tmp/flume-probe-effort-a configDir=<bay>
effort b: RESOLVED flumeDir=/tmp/flume-probe-effort-b configDir=<bay>
effort c: RESOLVED flumeDir=/tmp/flume-probe-effort-c configDir=<bay>
```

All three resolve. They then collide exactly as before, on `flume/<phase>`, in
git's vocabulary — the outcome the spec sentence above says the engine holds
the line against. The bay-holds-only-a-chain case is pinned as a deliberate
let-through (`tests/cliStateDirs.test.ts:746`), and it is the documented
config/state split (`spec/cli.md`, *State-root and config-dir resolution*) —
so the let-through is right and the *evidence* is what does not reach.

What the refusal does catch is a second root beside a bay the runtime has
already written into: the default root in use, plus one relocated. Real, and
narrower than the sentence.

## The fork

**(a) Widen the evidence: the checkout records which root holds it.** The two
roots only ever meet at the checkout, so the checkout is the only place a
durable record of the first one can live — beside the tip claim under the git
common dir, which is already per-checkout state the engine writes and reaps.
A second resolution reads it and refuses naming both roots. Closes the report
as stated. Cost: a new engine-written per-checkout artifact, and a reaping
question — a stale record refuses a legitimate relocation, so something has to
retire it (the record is the *last* root resolved, not every root ever?).

**(b) Read the collision off what the checkout already holds.** `refs/heads/flume/*`,
or the worktree registry. No new artifact. But this is inferring intent from
side effects (`.claude/rules/engine-boundary.md`, *Told, not inferred*): a
`flume/plan-derive` branch left by last week's run is not a live second root,
and the refusal would fire on it.

**(c) Narrow the sentence to what the engine can decide.** The spec says the
refusal covers a state root resolved beside a checkout's *own* flume state,
and states plainly that two roots both relocated out of the bay are not
detectable at resolution and stay unsupported. The report closes on
documentation. Cost: the escape the spec offers — two efforts are two
checkouts — is still the only real answer, and the consumer reaches it only by
reading a page.

## Why this is the human's

(a) is a new artifact on every checkout's git dir with a lifecycle question of
its own, which is more machinery than the finding warrants without a ruling.
(b) is the inference the boundary rule fences. (c) admits the engine enforces
less than `spec/jobs.md` currently claims, which is a spec edit and this
layer's to ask for, not to make.

Note (a) and the checkout-keying work already queued
(THE-TICK-BRANCH-AND-ENTRY-CLAIM-CARRY-THE-CHECKOUT) touch the same git-common-dir
state; if (a) is chosen they want ordering.
