# The third spelling, `flume -h <name>`, ships untested

The arm is now spelling-blind: any of `help` / `--help` / `-h` in first
position carries its trailing name to `helpPageFor`, and the refusal echoes
the spelling typed (`usage: flume -h [<command>]`). So `flume -h status`
answers the status page today.

The entry named two spellings and `spec/cli.md` (*Subcommand surface*) names
the same two, so `-h <name>` has a test for neither the answer nor the
refusal, and `docs/CLI.md` does not mention it. It falls out of the one
decider rather than being decided — which is the shape the spec sentence
asks for ("one decider serves every spelling of help for a name"), but
nothing pins it, so a future narrowing of the arm would ship green.

Either the spec sentence names `-h <name>` alongside the other two (and a
case pins it), or the arm should refuse it — a decision, not a build call.
