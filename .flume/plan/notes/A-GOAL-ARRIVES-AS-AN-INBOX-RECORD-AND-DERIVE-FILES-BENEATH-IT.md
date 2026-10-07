# The goals block states an absence, and cannot say why

Three things the next drain should know.

**A goal with nothing beneath it is ambiguous by construction.** A goal whose
last descendant shipped and a goal nobody has decomposed yet are the same
queue: a root `group` with no children. So `harness/goals.ts` renders the fact
("nothing stands beneath it in the queue") and no verdict, and the inbox prompt
tells the drain not to delete such a file. Retiring a finished goal is
A-GROUP-LEAVES-THE-QUEUE-WITH-ITS-LAST-DESCENDANT's ledger pass; until that
ships, a finished goal stands in the queue and the block shows it standing with
none remaining. If an operator wants the drain to retire goals meanwhile, that
is a decision, not an inference the block can make.

**A goal entry still owes `summary`, `per` and `acceptance`.** They are
required for every entry the composed validator parses, `group` included —
`harness/entryExtension.ts`, `packageFields`. `spec/harness.md`, *Goals and
decomposition* lets a goal state "spec sections, entries, or a description", and
a description-only goal has no section to cite, so the drain is left either
inventing a cite or parking the operator's own instruction. Worth a question:
either the extension makes `per` (and perhaps `acceptance`) optional for a
`group`, or the spec says a goal names a section.

**No liveness leg rides the goals.** The slice is woken by records, friction,
refusals and lanes as before; a goal needing a re-rank or a retirement wakes
nothing on its own, so the block is read whenever something else woke the
drain. Deliberate — a wake leg over standing state is a new wake condition the
spec does not state — but it means a stale rank waits for the next record.

**Steps stayed out**, per the entry's note and
`how-does-a-build-session-say-which-steps-it-finished.md`: the derive prompt
files `work` beneath a goal and names the missing channel as what a `step`
waits on.
