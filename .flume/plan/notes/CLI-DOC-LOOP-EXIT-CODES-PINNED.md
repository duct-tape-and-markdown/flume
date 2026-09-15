# `flume job --help` is the last loop-range copy still drifted

The driven range this entry pinned both `docs/CLI.md` sections against is
`{0,1,2,69,74,78}` (`loopExitCode` over a `SuperviseResult` space, plus the
start-up set `{2,74}`). Checked by hand this tick, not pinned: `flume loop
--help` lists exactly that set; `flume job --help` lists `0,1,2,78` — missing
`69` (a child tick's mount-dead) and `74` (stop flag or merging dir
unreadable), both reachable through `job run`'s `cmd = "loop"` rewrite. The
entry scoped the four `--help` blocks out ("stay unheld"), so both were left
alone. `driveLoopExitCodes` / `LOOP_PROCESS_LEVEL_EXIT_CODES` now sit at
module scope in `tests/cliHelp.test.ts`, so pinning either block is a short
describe against `documentedExitCodes`.

Also worth knowing before editing `docs/CLI.md`: `namedExitCodes` now reads a
backticked integer as a code only when the word "exit" introduces it in the
same clause. That is what lets the sections keep backticking `--max`'s
default `50` as a value; a code written without that word is invisible.
