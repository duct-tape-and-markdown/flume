# Does a Goals row name every work entry, or bound the line?

`spec/cli.md`, *Subcommand surface*, item 9: "Each line gives the goal's
remaining `work` entries and how long it has stood." The shipped row reads that
as naming all of them — one `work TAG, TAG, …` clause, unbounded — and nothing
in the listing truncates anything today.

That is fine for the queue as it stands (one goal, no work beneath it yet) and
unreadable once derive decomposes a goal: tags in this repo run 40–60
characters, so ten work entries is a ~600-character single line, and twenty is
~1200. The operator reading `flume status` is the audience, so the bound is
theirs to set, not a build tick's to invent.

Three shapes, all consistent with the sentence as written:

1. **Name them all** (today's behavior). Nothing is hidden and the row is
   greppable; past a handful of entries the listing stops being scannable, and
   the Goals block crowds out every row under it.
2. **Name the first N, then count the rest** — `work A, B, C … +17 more`. Keeps
   the row one line at any queue size and keeps the earliest-served work
   visible, which is what the row's own ordering rule is about. Costs a number
   the spec does not currently name (what N is), and an operator who wants the
   whole list has to read the queue.
3. **Count alone** — `work: 20 entries`. Shortest and needs no N, but drops the
   one fact that makes the row actionable: *which* entry build will pick next
   under this goal.

**Recommendation: (2) with N named in the spec sentence.** The row exists to
say where a goal sits in the served order, and its head is the part that
carries that; a trailing count keeps the row honest about what it elided. If
that is right, the sentence wants to say so — "names its first N remaining
`work` entries and how many remain" — since the row is specced behavior and a
cap chosen in code is a convention with no owner.

If (1) is the intent and the long line is acceptable, say so there too: then
nothing is owed and this question closes on the sentence alone.
