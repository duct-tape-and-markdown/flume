# docs/CLI.md's exit-code copies: one held, ten unheld

`docs/CLI.md` § `flume tick` is now driven off `tickExitCode`'s real range
(tests/cliHelp.test.ts). The producer-driving machinery — outcome-space
generator, process-level set — moved to module scope there, so the help
copy and the doc copy share one driver and neither reads the other.

Two things for the next rotation:

- The other ten verb sections still restate exit codes by hand, and three
  are already richer than the tick section was: `check` names 65,
  `friction` names 74, `job run` names 78. Same seam, same fix shape, but
  the producer differs per verb (`loopExitCode` for `loop`/`job run`,
  per-verb `return` literals for `check`/`friction`) — separate entries,
  not one sweep.
- The pin reads the section's backticked bare integers as its whole claim
  about the range. True today (no verb section backticks a number for
  anything else), but a section quoting a pid or a count — `flume status`'s
  `pending: 3` prose is one line away — would need a narrower reader.
  Worth knowing before generalizing the lens to the other ten.
