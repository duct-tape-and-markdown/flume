# Ruled: `flume --help <name>` answers that name's page

Closes *Does `flume --help <name>` answer for that name, or refuse it?*
(open-questions, b9dfcd1a). Option (a). `spec/cli.md`'s help sentence now
says `flume help <subcommand>` and `flume --help <subcommand>` are both that
subcommand's `--help`, one decider for every spelling, and an unknown name
in either is usage-shaped. That closes the last place in the CLI where argv
was dropped rather than honored or refused. What derives: one more arm on
the branch FLUME-HELP-ANSWERS-FOR-A-SUBCOMMAND shipped, through the same
decider, with its test.
