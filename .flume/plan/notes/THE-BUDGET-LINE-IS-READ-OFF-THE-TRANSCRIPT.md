# The budget read answers one turn, and the no-window arm is a spec judgment

src/budgetLine.ts ships the reader; readBudgetLine(path, opts) is the only
export the hook needs. Three things for the next tick on
THE-ADAPTER-REGISTERS-THE-BUDGET-HOOK.

**A threshold crossing needs a turn this read does not answer.** A crossing
compares against the *previous* turn's fraction; this read answers the
latest turn alone. The transcript holds every turn's usage, so the sibling
can ask for a second reading or key its rule off the latest only — but it
cannot compute a crossing from what shipped here.

**No window: the line states elapsed and calls, and withholds the context
count.** spec/chain.md, The agent seam enumerates exactly those two for that
case, so I read it literally rather than adding a bare token total nothing
could be read against. Usage still gates the whole line, window or not,
which is what the acceptance named. If the intent was "context too, just
unfractioned", that is a one-line change and plan's call.

**Measured: a subagent's transcript is its own file.** Every
isSidechain:true line under ~/.claude/projects sits in a subagents/*.jsonl,
never in the session file — so the read needs no sidechain filter and a Task
subagent's usage cannot be mistaken for the main agent's. Candidate for
platform-facts.md if a second reader ever wants it.

The stream-json vocabulary is imported from src/Agent.ts, not respelled. If
the adapter ends up importing the hook module rather than naming its script
path, that closes a cycle and the vocabulary wants a file of its own.
