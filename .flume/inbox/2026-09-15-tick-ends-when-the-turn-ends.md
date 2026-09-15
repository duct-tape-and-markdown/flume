# A build tick ended its turn waiting for a background wake that headless mode never sends

Observed on the loop this session. `WINDOWS-LANE-TRIGGER-IS-PINNED` recorded
a `clean-exit` at `7c93b2e` with this final message, verbatim from
`.flume/prior-attempts/entry/windows-lane-trigger-is-pinned.json`:

    The suite is still running (~5 min in, sharing the machine with another
    session's concurrent vitest run). My watcher `bfp4bb1oe` is armed on this
    worktree's own output file and will wake me when it finishes — I'll commit
    then rather than keep polling.

The agent armed a background watcher on its own test run and ended its turn
expecting a wake. In an interactive session that is the right move; under
`claude -p` the turn ending is the process ending, the worktree is torn down,
and the work dies uncommitted. The engine recorded the fact correctly
(`spec/loop.md`, the `clean-exit` row) and the entry is retried with the
record in front of the next attempt, so nothing is lost but a tick — and the
next attempt reads a message that still sounds like a plan, not a mistake.

Nothing in the package's prompts says a tick is one turn. `harness/prompts/
build.md` tells the agent how to park and how to commit, and
`.flume/PROTOCOL.md` says nothing about turn boundaries; a grep of every
package prompt for background, wake, or headless finds no line. The
discipline the package owns (`spec/harness.md`, *The prompts and their
discipline*) is where the sentence belongs: a tick is one turn — ending it
ends the invocation, no background task wakes it, and a suite that has not
finished is waited on in the turn or the entry is parked, never handed to a
watcher. One sentence, in every phase prompt or the shared preamble; it is a
fact about the runtime the agent cannot see from inside it.

The contention the message names is real and separate: two vitest runs on
one host at once stretched a ~2 min suite past 5. That is the same
cost the spawn budget and the solo-wave partitioning already price, and
this record does not ask for anything on it.
