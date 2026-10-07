# Three legs shipped on two surfaces; spec/loop.md's 69 roster still names two

The re-read's leg phrases now have one home: `MOUNT_DEAD_RE_READ_LEGS`
(`src/loopSupervisor.ts`), consumed by the refusals an operator reads and
rendered into `flume loop --help`'s 69 row, with `docs/CLI.md` pinned against
it. So the surfaces state the tree's **three** legs — chain resolution, the
exiting phase's declared prompt template, the queue's parse — while
spec/loop.md's *Exit codes* bullet names the chain and the queue only. The
entry flagged that as an open question and I did not fill it: the tree, the
help page and the CLI page now agree with each other and lead the spec by one
leg. If the roster should stay at two, the prompt leg is the thing to
re-decide, not the narration.

Two adjacent edits outside the entry's file list, both to clear the
acceptance grep rather than to change a claim:

- `src/loopSupervisor.ts`'s abort-threshold message and
  `docs/CHAIN-AUTHORING.md`'s `abortThreshold` bullet said "against the same
  wall" for the consecutive-failure backstop — a different mechanism, still
  unconditional. Reworded to "a signature that has already repeated", and the
  bullet now says outright that it is unconditional where the mount-dead
  abort is not. No test pinned either string.
- the supervisor's repaired-cause warn line named the chain and the queue
  only; it now names the prompt read too.

Debt observed, not filed: `tests/loopSupervisor.test.ts`'s mount-dead title
still reads "aborts on first occurrence", which is true only of the standing
wall. Cheap to re-title whenever that file is next opened.
