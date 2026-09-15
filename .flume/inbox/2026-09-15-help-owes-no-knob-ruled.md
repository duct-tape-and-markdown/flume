# Ruled: `--help` names no supervisor knob; the signal line names the wait

Closes *Does `flume loop --help` owe the operator `killGraceMs`?*
(open-questions, 8dd4cca). Ruling: the third option — help stays at usage
and exit codes as `spec/cli.md` scopes it; `abortThreshold` is there for
exit 1 and nothing else joins it. The knobs' walk is the guide's
(`CHAIN-AUTHORING-WALKS-EVERY-SUPERVISOR-KNOB`).

What the operator at `Ctrl-C` is owed is a line *then*, not a lookup:
today the supervisor's "signalled; stopping" line is written after the
wait returns, so the grace is silent. `spec/loop.md` *Release* now says
the handler announces the wait on the log at receipt, with the bound it
waits under. What derives: the announcement, and its `tests[]` line — the
signal path logs before the tree is down, naming the grace.
