# One refusal class, two exit codes, decided by which verb was typed

Two spec files disagree, and the tree follows both:

- `spec/loop.md`, *Baton — presence wakes, absence hibernates*: "a name the
  chain does not declare is refused before any work, naming the phases it does
  (**exit 1**)". `TICK-NAMES-THE-PHASE-IT-RUNS` shipped that.
- `spec/cli.md`, *Subcommand surface* (line 96): "Usage-shaped failures exit 2
  uniformly. The category is any argv the surface ... **unknown phase**".

The two verbs that already refuse an unknown phase — `wake`/`sleep`
(`chainRefusesPhase`) and `render` (`RenderUsageError`) — both exit 2.

Both readings are defensible:

- **1** — the chain mounted and only the request was wrong. This is the
  `commit-refusal` reading, and it is what a supervisor child should report:
  the child is not a human typing argv, and the supervisor distinguishes "your
  chain no longer declares this phase" from "you typed nonsense".
- **2** — the argv could not be honored as typed, like every other unknown
  name. Keeps the usage class whole, which is `spec/cli.md`'s stated point
  ("uniformly"), and keeps one refusal from having two codes.

Either way it is one sentence in one spec file plus a code change at one site.
Flagged rather than parked because the entry that shipped it named the code, so
nothing is broken — only inconsistent.
