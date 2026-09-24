# An unknown phase exits 1 here and 2 at every other verb

Shipped as specced: `tick --phase ghost` exits 1 (`spec/loop.md`, *Baton —
presence wakes, absence hibernates*, which names the code outright, and the
entry's acceptance). But `spec/cli.md`, *Subcommand surface* lists **"an
unknown phase"** as a member of the usage class that "exit[s] 2 uniformly",
and the two verbs that already refuse one — `wake`/`sleep` (`chainRefusesPhase`)
and `render` (`RenderUsageError`) — both exit 2. So one refusal class now has
two codes, decided by which verb was typed.

The two readings are both defensible: 1 says the chain mounted and only the
request was wrong (the `commit-refusal` reading, and what a supervisor child
should report); 2 says the argv could not be honored as typed, like every
other unknown name. Not build's to settle — a human ruling on `spec/cli.md`'s
enumeration, and either way it is one sentence in one file plus a code change
at one site. Flagging rather than parking, since the entry named the code.

## Two adjacent shapes, both landed

- `takeFlagValue` (`src/cli.ts`) — `--phase <name>` would have been the fourth
  copy of "find the flag, guard the value, splice" in that file. It is now one
  function with two callers (`--phase`, `render --entry`); the numeric flags
  (`--max`, `-n`) keep their own parse, which decides more than presence.
- `markerAgentChainSrc` (`tests/helpers/repoChain.ts`) — a fixture agent that
  writes a marker when invoked, so "no agent ran" is a file on disk rather
  than a negative read over a process's whole output.

## What is still open

Nothing spawns `--phase` yet: `defaultTickRunner` (`src/loopSupervisor.ts`)
still spawns a bare `flume tick`, so the flag is operator-facing until
THE-SUPERVISOR-HOLDS-ONE-CHILD-PER-AWAKE-PHASE lands. Until then a supervisor
child still races the baton for its phase.
