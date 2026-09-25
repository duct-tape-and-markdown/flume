# Does the tick verdict gain gate and merge durations, and does the engine stamp its own log lines?

Field report, 0.19: "the verdict records agent duration but not gate or merge
duration; log lines carry no timestamp", so non-agent time was invisible. This
repo measured the same blind spot the hard way — by differencing verdict
timestamps, which gave a median 6.7 minutes of non-agent overhead per wave.
The report calls both straightforward and the record says they were taken; the
spec has not been written, so this is the fork.

## The verdict half

`spec/loop.md`, *The tick verdict — one facts artifact* enumerates what the
artifact carries, and that enumeration is the contract: phase name, entry tags,
`committed`, the no-commit class, each gate result in run order, shipped tags,
each span's merge fate with its footprint and shas, provisioning failures, the
summary. Duration appears once, on `invocations[]`, per agent run.

Adding a duration to each gate result and each merge outcome is mechanical —
the engine holds both clocks at the moment it writes the row — but it widens a
shape that section enumerates, so the sentence is yours to write. Two
placements, and they are not equivalent:

- **On each row** (`GateResult.durationMs`, the merge outcome's own field).
  Reads where the fact is; costs a field on a type chains already implement,
  and `GateResult` is a chain-authored return value (`spec/chain.md`, *What a
  gate returns*) — so a duration the *engine* measures does not belong on the
  value the *chain* returns. The engine would have to wrap it.
- **Beside them**, the way `invocations[]` sits beside the gate list: one
  timing row per gate and per merge, keyed by name and entry tag. Leaves every
  chain-authored shape alone and puts all the engine's own clocks in one place.

The second looks right for the same reason `invocations[]` is already shaped
that way, but it is a new top-level field and the naming is yours.

## The log half — this one is a boundary question, not a formatting one

`Logger` (`src/log.ts`) is a three-method seam and `DispatcherOptions.log`
takes any implementation; `consoleLogger` is the fallback. A consumer wanting
timestamps can already wrap it in four lines and choose its own format —
ISO, monotonic-since-start, whatever its log aggregator reads.

So stamping every `[flume]` line inside the engine is the engine choosing a
timestamp format for everyone (`.claude/rules/engine-boundary.md`, *Surface,
not prescription*: "Opinion ships by name, opted into"). Three ways out:

1. **Leave it.** The seam is the answer; `docs/CHAIN-AUTHORING.md` gains a
   four-line stamping decorator beside the logging seam, and the consumer who
   asked gets it by copying. Cheapest and inside the fence.
2. **Ship the decorator by name** — a `timestamped(logger)` helper in the
   engine's exports, opted into, never a default. Still the consumer's
   choice; saves everyone writing the same four lines.
3. **Stamp by default.** Only defensible if a timestamp is mechanism rather
   than taste — and the second-implementation test says a different
   implementation would want to choose the format.

My read is (2), with (1) as the floor. But the report's underlying complaint
is *non-agent time is invisible*, and the verdict half answers that properly
while the log half only makes it eyeballable — so if you take the verdict
half, the log half may not be worth an export at all.

Not filed as an entry: the verdict half needs a sentence in `spec/loop.md`
that only you write, and the log half is a boundary call, not a defect.
