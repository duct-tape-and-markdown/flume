# No log fires at signal receipt in `flume loop`

Shipped the delegation. One sentence of the cited section is met by
nothing on either side of this commit: "saying so on the log at receipt
and naming the grace the child escalates under."

`flume loop`'s SIGINT/SIGTERM handler (`src/cli.ts`, `releaseAndExit`)
prints nothing. The only line on the signal path is `superviseLoop`'s
`[flume] signalled; stopping after N tick(s)` — written *after* the
child exits, so an operator watching a wedged child sees silence for as
long as the wedge lasts, which is exactly when the receipt line would
matter most. The pre-d9e80fe wording ("with the bound it waits under")
was unmet the same way, so this is not fallout from the respec.

Naming the grace there means the loop branch reads
`supervisorPolicy.killGraceMs` again — for the message only, never to
bound its own wait. Worth an entry of its own: it needs a test that
reads the line before the run ends, which neither of this entry's tests
does.
