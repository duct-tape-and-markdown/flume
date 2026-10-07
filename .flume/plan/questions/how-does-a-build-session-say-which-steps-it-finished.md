# How does a build session say which of its steps it finished?

`spec/pending.md`, *Ship detection trusts the agent's own account* makes
`Phase.shipped` return "the tags the span ships, out of the `work` entry and
its steps", and "**A partial list ships part of the work.** The steps it names
leave the queue; the `work` entry stays queued, and the next session on it
starts from the steps that remain." The engine capability is derived
(SHIPPED-RETURNS-THE-TAGS-A-SPAN-SHIPS).

`spec/harness.md` does not say how the package produces a partial list, and
the package's `shipped` today is all-or-nothing: `harness/chain.ts` returns
`putDown(entry, …) === undefined`, so a commit with a put-down record ships
nothing and every other commit ships everything.

**Why that is not safe once steps exist.** `spec/harness.md`, *Goals and
decomposition* tells derive to file `step`s "where one session should carry
several tracked parts". The moment it does, a session that finishes two of
three steps and commits has two outcomes available: park (the two finished
steps stay queued and the next session redoes them) or ship (the unfinished
third step's file is deleted and nothing remembers it). The second is a silent
false ship of work nobody did — the failure mode the whole put-down machinery
exists to prevent, one level down. So A-GOAL-ARRIVES-AS-AN-INBOX-RECORD-AND-
DERIVE-FILES-BENEATH-IT deliberately stops at `work` entries under a goal and
does not tell derive to file steps.

- **(a) The build tick's record names the steps it finished.** The package
  already reads a record out of the worktree to classify a put-down
  (`putDown`, `harness/putDown.ts`); a continuation record naming the step
  tags it completed is the same channel carrying one more fact. For: one
  mechanism, already load-bearing, already fenced, already read at the right
  moment. Against: the record's vocabulary grows, and a step tag misspelled in
  prose ships nothing — which argues for the package refusing a named tag that
  is not one of the entry's steps.
- **(b) The commit's touched paths decide.** A step declares `files`; a step
  all of whose files the span touched is done. For: the agent writes no extra
  prose. Against: this is inferring intent from side effects — the shape
  `.claude/rules/engine-boundary.md`, *Told, not inferred* names outright — and
  it is wrong in both directions (a step can be finished without touching every
  path it predicted, and touched without being finished).
- **(c) No partial ships in the package.** A session carries all its steps or
  parks the whole entry; the engine keeps the capability for other consumers.
  For: nothing new to author, and the spec's "finer structure never means more
  sessions" still holds. Against: the partial arm the spec wrote exists for
  exactly the session that runs out of room mid-entry, and `A tick puts work
  down` says that session is normal, not exceptional.

My read is **(a)**, with the package refusing a step tag the entry does not
carry. (c) is a defensible interim and is what the tree does today; (b) should
not ship.

**Blocking on:** derive filing steps at all. Until this is answered, plan files
`work` entries under goals and no `step`s, so the partial arm is unreachable
from this repo's own loop.
