# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Three plan wakes that run and file nothing

**PARKED.** Three loop-33 observations, one shape: a slice is woken by the
existence of a signal rather than by unrouted work, and the tick it costs
ships nothing. `posture-sweep.md` already rules that the sweep yields to
pickable work; nothing rules the other two. Each arm is independently
answerable; the section closes when all three are.

Each wants a sentence in `spec/harness.md` — no knob in any of them.

### 1. Derive re-reads a spec commit the inbox drain already routed

Ten plan-derive ticks in loop 33 judged "already queued — cursor advances
alone" (d246140, 6f63f64, 95cef8f, cb19a4e, 9fdc468, 7ef5bb9, …). Each
followed an inbox tick that drained a record naming the very spec commit
derive then re-read. Two plan ticks per interactive ruling, one of which
does the work.

- **(a)** The inbox drain advances `derivedThrough` through a spec commit a
  drained record cited and routed; derive runs only for spec deltas no
  record claimed (*Plan state as declared state*, *The phases*).
- **(b)** Leave it: derive's re-read is the check that the drain routed the
  whole delta, and a cursor-only tick is cheap.

Recommended (a) — the drain already re-derives against the tree, and (b) buys
a check nothing reads.

### 2. A red CI lane wakes on every push while the same titles stand

Six posix-only titles red on the windows lane, all six heading one queued
entry; every push started a run, the run failed on the same six, and the lane
woke plan-inbox because the run was red and past the stamp (*CI lanes as a
findings source*, liveness). At least five such ticks drained nothing.

- **(a)** Wake only when the latest failed run's title set differs from the
  stamped run's; a same-set red advances the stamp on the next tick that runs
  anyway. The stamped titles live in the plan state beside the run id.
- **(b)** Leave it: a red lane should keep asking, and the drain is cheap.

Recommended (a). It widens `drainedRuns`'s value shape, so it is a plan-state
schema change as well as a liveness one.

### 3. Build notes wake a plan tick after every wave

Every wave in loop 33 left one note per entry and was followed by an inbox
tick to drain them before build could take the next batch. Most routed to an
accepted-debt line or an amendment to an already-queued entry.

- **(a)** While `<pending-now>` carries a pickable entry, notes wait and the
  drain rides the next plan tick that runs for its own reasons — the sweep's
  rule, extended to the inbox (*Records as one file each*).
- **(b)** Leave it: a note is a park until read, and build re-picking an
  entry whose park has not been answered is the failure this prevents.

The fork inside (a): a **park** must reach plan before build re-picks the
entry. Either a park wakes the slice and an observation does not (one
predicate on the record's kind), or build skips an entry whose note stands.
Recommended (a) with the first arm.

## Does the engine's friction listing count a dotfile?

**PARKED.** `flume job status` on a freshly seeded job reports `friction: 1
note(s) await routing` over `friction/.gitkeep`, zero bytes, copied by the
consumer's own seed dir. `countFrictionFiles` (`src/job.ts:557`) filters
`isFile()` and nothing else, while `harness/layout.ts:79` already rules that a
`.gitkeep` in a record directory is not a record. Two answers to "what is a
note", one seam apart, and the engine's reads work into a placeholder forever.

- **(a)** The engine's friction listing skips dotfiles: a placeholder is no
  note in any implementation, and the skip is name-based, never content
  interpretation. `spec/chain.md`, *`Chain.friction` — the declared friction
  channel*, states which files count.
- **(b)** The count is the chain's to filter, and the spec says so — which
  means a surface for it, since no chain can reach that count today.

Recommended (a): (b) makes every consumer declare a filter to un-count a file
git made them create.

## Is a declared friction directory a findings source?

**PARKED.** A pilot's remaining hand-written surface after adoption is
`friction`: agent notes their teardown harvest delivers to a tracked
directory, routed by their own plan prompt. The inbox slice already drains
`.flume/inbox/` and a declared CI lane's failing titles; a declared friction
directory is the same shape — files the loop must route or re-buy every tick
— and the one source a declaration cannot name.

- **(a)** `spec/harness.md`, *CI lanes as a findings source*, generalizes to
  **declared findings sources**; the friction directory is one, the inbox
  slice reads it beside the lanes, and `flume friction`'s routing job goes
  with it.
- **(b)** Friction stays engine-side plumbing and each consumer keeps a prompt
  paragraph for routing it.

Recommended (a) — (b) is the verbatim-copying detector in `engine-boundary.md`,
*Surface, not prescription*: a block every consumer's prompt repeats.

## Whose job is "don't re-dispatch against an unchanged world"?

**PARKED.** A pilot wrote a ~20-line `shouldRun` refusing an entry whose last
dispatch exited clean without committing while nothing has landed since —
after one entry burned four bails against an unchanged tree. It reads the
record's `mode` through a local `{ mode?: string }` cast and compares mtimes,
though the record has carried `headSha`/`at` since 0.13. The engine holds
every fact; the consumer holds the heuristic.

- **(a)** The harness package's default pickability refuses an entry whose
  latest prior attempt is `clean-exit` at the current HEAD. Every declared
  consumer gets it; a hand-written chain copies one line.
- **(b)** Engine pickability, as mechanism: a stateless tick over identical
  input is the identical outcome, which is not a policy anyone would choose
  otherwise.

Recommended (a) on `engine-boundary.md` unless the engine already carries a
per-entry pickability surface a chain cannot reach — in which case the fork
is whether that surface should take this predicate.

## Does a run name the git version when it is below the floor?

**PARKED.** The pilot's host runs git 2.33; the floor is 2.36 for `worktree
list --porcelain -z` (`spec/chain.md`, the git floor bullet). Reclamation does
degrade loudly, as the README says — but it is discovered mid-wave, after a
loop has been running.

- **(a)** `flume loop` and `flume job run` read the git version at start and
  **warn** when it is below the floor, naming the version and what degrades.
- **(b)** The same read, and **refuse** — the floor is a declared prerequisite
  and a wave that cannot reclaim worktrees is not a run anyone wants.
- **(c)** Leave it to the README; the loud degrade is the report.

Recommended (a): the degrade is real but bounded to reclamation, so refusing
costs a working consumer their whole loop over one verb.

## A run's spend is on disk per tick and totalled nowhere

**PARKED.** Loop 33: 146 ticks (95 plan, 50 build, 110 entries shipped), and
the operator learned the cost from the subscription's quota page at 65%, not
from flume. Every agent invocation leaves a usage row on the tick verdict
(`spec/loop.md`, *The tick verdict — one facts artifact*), so the fact is
already reported — per tick, in a file nobody opens while a loop runs. The
loop's completion summary names ticks and shipped tags but not their cost;
`flume status` (`spec/cli.md`, *`flume status` owes exactly this*) and `flume
log` total nothing.

The surfaces are enumerated in the spec, so this needs the amendment before
an entry can cite it.

- **(a)** The completion summary totals usage by phase for the run, and
  `flume status` / `flume log` total the run so far, from the verdict rows the
  engine already writes.
- **(b)** The summary alone; the observational verbs stay as enumerated.

Recommended (a). A plan-tick-to-build-wave ratio of 2:1 would have been
visible at hour two, which is the decision this number is for.
