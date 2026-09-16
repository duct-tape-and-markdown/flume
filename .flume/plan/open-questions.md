# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Where does a lane's failing-title set come from?

**Status: PARKED** — `spec/harness.md`, *CI lanes as a findings source*.

The section rules two things that do not meet on disk. The **agent** "takes
the failing test titles as findings" out of the rendered log — prose the
package did not author, so the package refuses to parse it: `harness/ci.ts`
says so by name ("No test title is parsed out of that log here … taking a
finding out of material the package did not author is the slice's agent's
job"). But the **liveness** rule needs a title set *before* any agent runs:
a lane is live when "its failing-title set differs from the set the stamp
carries". Nothing under `harness/` or `src/` produces one.

A-LANE-STAMP-CARRIES-THE-FAILING-TITLES-IT-WOKE-ON is parked on this. Build
reported `not-shipped` against it: the stamp shape and the render are
mechanical, the wake is not. Whichever arm wins, liveness must also fetch a
failing job's log on the selection path, which the lane leg's own memo doc
argues against by name — the leg exists so a woken tick pays no forge cost.

**Options.**

- **(a) The lane declares its title reader** — a pattern or a function, beside
  `workflow`/`job`/`name`. Told, not inferred: the consumer states the
  grammar its runner emits. Costs a declaration field, a schema arm, and the
  render of a reader that throws. A consumer that declares none gets
  wake-once-per-run, which is today's behavior spelled rather than inherited.
- **(b) The package parses a runner's output shape.** Cheapest for the
  consumer, and exactly the grammar `harness/ci.ts` refuses on the
  engine-boundary rule. Every reporter that words a failure differently
  silently stops waking the lane.
- **(c) The forge's check-run annotations.** Structured, so no prose parse and
  no boundary violation — but empty for any reporter not emitting
  `::error title=`, which is most of them, so the lane silently stops waking
  for a reason the operator cannot see.
- **(d) Drop the title set from the wake.** The stamp stays the run; a red
  that persists wakes once per run, which is the cost the entry was filed
  over. Closes the entry and wants the spec sentence retracted.

**Recommended: (a)**, weakly, with (d) as the honest cheap alternative. (a) is
the only arm that keeps the package out of prose it did not author while
still producing a set; (d) is the only arm that costs nothing and admits the
wake is worth less than the machinery. (b) and (c) both buy a silent failure.
Either way the section's two sentences want reconciling, and that edit is the
human's.

## Does an explicit `flume wake plan-inbox` bypass the record leg's yield?

**Status: PARKED** — `spec/harness.md`, *The phases*; `.flume/PROTOCOL.md`,
*Records: one file each*.

Verified on disk: the inbox window's record leg now reads `pickable`
(`harness/inboxWindow.ts`), and `shouldRun` is consulted on every attempt
whatever the baton says — `consultShouldRun` (`src/tickAttempt.ts`) has no
awake-marker branch, and `TickContext.pickable` is always set on a
dispatcher-built context. So an operator who lands a record and runs `flume
wake plan-inbox` while the queue carries pickable work gets `declined
(shouldRun)` and no tick; the marker stays set until a tick with nothing
pickable drains the record.

That is the spec's own rule — "a slice is made live by unrouted work, never by
a signal alone". It collides with PROTOCOL's "the one landing that earns
`flume wake plan-inbox` is one that changes what is pickable — a ruling that
unblocks a queued entry": the queue an unblocking ruling acts on usually still
carries other pickable entries, so that is the one wake the window refuses.

**Options.**

- **(a) The PROTOCOL sentence goes.** Nothing earns an explicit inbox wake;
  every landing rides the next tick that runs for its own reasons. Honest to
  the mechanism, and the operator loses a lever they were told they had.
- **(b) An explicit wake bypasses the yield.** The awake marker is a fact the
  engine holds and the window does not read; a leg that reads it would make
  the operator's signal beat the yield. But the spec's own sentence refuses
  a slice made live "by a signal alone", and an awake marker is exactly a
  signal — so this arm wants that sentence qualified, not just a new leg.
- **(c) Leave both.** The sentence stays as advice that is wrong in the common
  case; an operator follows it, sees `declined`, and learns the mechanism by
  surprise.

**Recommended: (a).** It costs one sentence and nothing moves in code. (b) is
the arm to take only if the operator lever is judged worth re-opening the
"never by a signal alone" rule, which is load-bearing for the whole yield.
PROTOCOL is neither plan's nor build's to edit.

## Does a gate hold the derive cursor's advance bound?

**Status: PARKED** — `spec/harness.md`, *The gates the discipline needs*.

Two bounds on the inbox drain's `derivedThrough` advance live at the ladder's
bottom rung — only through a leading run of listed commits, and only to a sha
the rendered window named. Both are prompt paragraphs
(`harness/prompts/plan-inbox.md`, `harness/prompts/plan-discipline.md`).
Nothing refuses a plan commit that moves the cursor to a sha the block never
listed, and a wrong advance is silent: the derive slice simply never opens on
the commits stepped over.

The second bound is decidable. `derivedThrough` in the commit must be an
ancestor of the tip and a descendant of (or equal to) its pre-commit value; a
stronger form reads the plan commit's own parent and refuses a value outside
`old..HEAD`. The first bound — did the routed records really cover that
commit — stays judgement and stays prose.

The blocker is that *The gates the discipline needs* reads as a closed
enumeration: the `per` gate, the records gate, the clean-tree gate, the
pending gate. A fifth is a spec sentence, and plan does not write `spec/`.

**Options.**

- **(a) Add a cursor gate, named in that section.** One `afterCommit` gate on
  the plan phases, two `merge-base --is-ancestor` calls. Promotes a silent
  self-inflicted failure to a refusal at the point of detection
  (`engineering.md`, *Narration is the ladder's bottom rung*).
- **(b) Leave the bound as prompt prose.** Costs nothing; the failure mode is
  an autonomous agent stepping the cursor past commits nobody derives, which
  no tick afterwards can see.
- **(c) Hold it in the plan-state accessor rather than a gate** — refuse the
  write where the artifact is written. Cheaper than a gate and reaches every
  writer, but the accessor does not know the tip or the pre-commit value
  without being handed them, so it is a gate wearing a different name.

**Recommended: (a).** The defect is exactly the shape the ladder exists to
close, and the check is two git calls over values the commit already carries.
The sentence that admits a fifth gate is the human's.
