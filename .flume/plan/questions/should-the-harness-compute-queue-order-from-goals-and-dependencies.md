# Should the harness compute queue order from goals and dependencies, retiring stored priority?

Opened in an interactive session (2026-10-06) by the operator, who is ruling
on it in that session; plan reads this file only as context and files
nothing against it.

**Where order comes from today.** The engine serves `priority` descending,
then oldest filing, then tag (`spec/pending.md`, *The entry core*). The
harness sets `priority` by where an entry came from: report or ruling 30,
build note 20, spec derive 10, sweep 0 (`spec/harness.md`, *The phases*),
with a filing-band gate and a refusal of priority edits outside the inbox
slice (*The gates the discipline needs*). The bands were introduced because
no producer set priority and the tag tie-break served the queue
alphabetically. They were a quick fix for the absence of any ordering, not a
considered model of sequencing.

**What is missing.** Nothing in the queue knows what work is waited on.
A downstream consumer's release waited a day or two behind unrelated band-30
entries. Its only lever was a ruling per entry. Nothing reports whether the
sequencing is any good.

## The proposal

Sequencing is part of deriving spec into code, so the flagship harness
should own it. Plan's judgment goes into structure, and the order is computed
from that structure.

- **Goals, written by the operator.** `.flume/plan/goals/<name>.md` (path
  open) names what something outside the loop waits on: spec sections or
  entry tags. Goals live outside `spec/`, because a goal is time-bound and
  the spec states what flume is, with no windows (`spec-writing.md`, *One
  truth, in the present tense*).
- **Plan's output is structure.** It decomposes the work, declares complete
  `blockedBy`, and states which goals each entry serves. That is the
  judgment, and the work no computation can do.
- **The harness computes order at every selection, and never stores it.**
  Goal work first, in the operator's goal order. Then the entries the most
  other work waits on, read off the `blockedBy` graph. Then oldest filing.
  Then the tag. The order updates the moment anything ships, with no tick.
- **The engine gains one hook.** The chain supplies the ordering function;
  the engine's default is oldest filing, then tag. Other chains will want
  their own policy, so this passes the second-implementation test.
- **Status reports how well sequencing works:** remaining work per goal,
  filing-to-ship time, and idle fanout slots. Without that feedback,
  "effective" cannot be judged.

**What it deletes:** the provenance bands; the filing-band gate; the
priority-edit refusal; the goal-band idea; and, possibly, `priority` from
the engine's core entry schema. A chain wanting a stored rank declares it in
its own extension. Flume is pre-1.0, so the break is allowed.

**Rejected alternative: plan writes the ranks.** Written ranks go stale
between derive ticks. Most of the ordering is computable from facts plan
already declares, so a model recomputing it is the prose rung doing the
computable rung's work (`engineering.md`, *Narration is the ladder's bottom
rung*). And a stored rank derivable from the graph is derived state restated
(*Derived state is computed, never restated beside its source*).

## Forks

1. **Does `priority` leave the engine core**, or stay as an optional input
   the default order reads?
2. **Does provenance survive as an input?** For example, a downstream
   report outranks a sweep finding within equal goal and critical-path
   weight. Or urgency is only ever what the operator states as a goal.
3. **How plan states goal membership:** a `serves` field on the entry, or
   matching each goal's spec sections against the entry's `per`.
4. **Whether order prefers small or low-conflict entries.** The serial gated
   merge is the bottleneck, and no entry carries a size estimate today.
5. **Where goals live,** and who closes one: the operator deleting the
   file, or status reporting it done when nothing it names remains.

A prior-art survey (critical path, WSJF, kanban classes of service, merge
queues) is being read into these forks in the same session.
