# What window does the drain count "a family noted three times" over?

`spec/harness.md`, *The phases* states the drain's bar and closes it with "a
family noted three times files once" — with no window named. The sweep's own
copy of the rule has one: `.claude/rules/posture-sweep.md`, *Routing* reads
"three plan commit bodies **of one rotation**", counted off `git log` from the
rotation's cursor. The drain has no rotation, and the only cursor it carries is
`drainedRuns`, which is per-CI-lane and means nothing here.

So the drain prompt (`harness/prompts/plan-inbox.md:62`, shipped at 56ea7ba0)
had to write the window itself, and wrote it as "three of this slice's own
`plan:` commit bodies" — which, with no cursor, is **all of history**. That is a
gap the spec left, not a build decision, so it comes back to you rather than
being filled quietly.

**The fork**

- **(a) Say it is unbounded, and why.** Recommended. The count self-terminates:
  once the family's entry stands, the family stops being re-noted, so "ever
  noted three times and never filed" is exactly the condition the rule is
  trying to catch. A bounded window has the opposite failure — a family
  re-noted twice per window forever never files, which is precisely the
  recurring re-note cost the rule exists to stop. On this reading the drain's
  unbounded window is more correct than the sweep's bound, and the fix is one
  sentence in the spec saying so, which the prompt then points at.
- **(b) Declare a drain cursor.** A `notedThrough` sha on the inbox plan state,
  advanced as the drain counts, with its own `SLICE_STATE_RULES` entry. Gives
  the drain a real window at the cost of a new cursor, a new gate rule, and a
  second thing a tick must remember to advance — machinery for a bar that is
  self-limiting either way.
- **(c) Bound it by a fixed span** — last N plan commits, or since the last
  release tag. Cheap, and arbitrary: neither span means anything to a shape
  family's recurrence.

Whichever you take, the spec sentence is the home; the prompt should point at
it rather than spell a second window (`.claude/rules/engineering.md`,
*Narration is the ladder's bottom rung*). Note that the drain, unlike the
sweep, cannot cite the posture page directly: `Slices.sweep.posturePages` is
consumer-declared and required only when `plan-sweep` is enabled, so a consumer
running the drain alone has no page to cite — which is why the bar is spelled
in the drain prompt at all.

Drained from build note `THE-DRAIN-PROMPT-STATES-ITS-FILING-BAR`.
