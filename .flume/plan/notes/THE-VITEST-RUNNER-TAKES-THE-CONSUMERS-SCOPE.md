# The scope field ships with one claim prose alone holds

`scope` is appended after the reporter flag and before a base run's files, so
the judge's narrowing lands inside the consumer's suite. Two facts for the
next tick:

**A positional scope widens a base run, and no refusal can catch it.** A
scope stated as a bare path (`tests/unit` rather than `--dir tests/unit`)
reaches vitest beside the base run's own file filters, where vitest unions the
two: the base run then covers more than the judge asked for. The detection is
not decidable from outside — a flag's value is a bare token too (`--exclude
<glob>`), so "every token after the first starts with `-`" is wrong for every
two-token flag. The field documents the shape it wants and refuses nothing,
which leaves the one claim here on the ladder's bottom rung. A mechanical arm
would need vitest's own flag/arity table in `harness/`, which is embedded
provider knowledge the sweep's own lens files against; I did not build it.
Worth a decision rather than a silent carry.

**New test mechanism: a forwarding stand-in for a tool binary.**
`recordingVitest` (`tests/harnessRunner.test.ts`) writes a node script that
logs the argv it was spawned with and then spawns the real vitest with exactly
those args, stdio inherited. So a case can assert what the runner *appended* —
a fact no report states — while the report it reads stays vitest's own. The
same shape would serve `scriptRunner`'s argument claims, which today assert
through the validator's own stdout; nothing files, but the helper is there if
an argv claim on that side ever needs the real reader.

Nothing in this repo's declaration states a scope: its lane split lives in
`vitest.config.ts`, which is what "no scope stated" already means. The field
is additive and the declaration kept compiling untouched.
