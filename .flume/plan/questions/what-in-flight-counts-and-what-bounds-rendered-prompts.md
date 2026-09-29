# `flume status`'s in-flight count reads an unbounded directory, and counts "started and unaccounted" rather than "still in flight"

`spec/cli.md`, *`flume status` owes exactly this*, item 7 says the spend line
"names how many agents are still in flight". The shipped derivation
(`src/runSpend.ts`, `RunSpend.inFlight`) is **one per rendered prompt in the
run's window that no usage row names**. Two things follow that the spec has
not ruled, and they interact — which is why they are one question.

## 1. What the number means

An agent whose process died between its prompt write and its row append leaves
a prompt no row names, and it stays counted for the rest of the run. That is
the truthful reading of *what this total does not yet carry* — its cost is
real and is not in the byPhase total — but it is not "still in flight".

The narrower reading needs a fact nothing on disk holds: a record of an
invocation **ending** without a usage row. `THE-USAGE-ROW-IS-ON-DISK-AS-IT-IS-PAID`'s
note reached the same place from the other side and named it a candidate
engine finding (`engineering.md`, *A fact the engine holds is reported*).

- **(a) Keep the derivation, move the spec sentence.** Word item 7 as what the
  number is — started and not yet accounted for — so the operator reads it as
  "how stale this total is", which is the job the line's own doc says it does.
  No code moves. Costs: the phrase stops promising liveness.
- **(b) Narrow the number, add the fact.** A third artifact — an invocation
  *end* marker, or a row written on the failure path too — lets the count mean
  what the sentence says. Costs: a new per-invocation write on the hot path,
  and a crash between marker and row reopens the same gap one level down.
- **(c) Print both.** Started-and-unaccounted, with the subset the supervisor
  still has a live child for. Costs: the supervisor's child set is not on any
  reporting surface today, so this is (b)'s cost plus a surface.

**(a) is what the tree argues for** — the number is already the honest one and
(b) chases a gap that cannot be closed by construction — but the sentence is
`spec/`'s, so the ruling is not ours to make.

## 2. What bounds `rendered-prompts/`

`recordRenderedPrompt` (`src/tickAttempt.ts`) appends one file per invocation
and nothing ever trims — unlike `tick-verdicts.jsonl` (rolling 200) or the
rows files (cleared per tick). Under a live supervisor `flume status` now
readdirs that directory on every call, and status is the verb operators bake
into shell prompts and watch loops. On a state root that has ticked for months
the listing is the whole history.

Correctness is unaffected today: the window is a string compare against the
stamp each name carries, so old entries are filtered, not miscounted. The
question is whether the directory gets a retention rule at all, and if it
does, **whether an in-flight count read from a trimmed directory can still be
right** — a trim that crosses the run's start instant would silently drop
in-flight entries and read as a complete total.

That dependency is the reason to rule 1 and 2 together: under reading (a) a
trim below the window edge is safe by construction; under (b) or (c) the
count's source would no longer be the directory at all, and the retention
question becomes free-standing.

Raised from `THE-SPEND-ROW-TOTALS-THE-ROWS-AND-NAMES-THE-IN-FLIGHT`'s build note.
