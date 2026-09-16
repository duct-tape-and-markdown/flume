# Three first-contact surfaces a new consumer hits before anything works (pilot report from a win32 consumer on node 22, relayed by the operator)

- `flume help` is not a verb (`unknown command: help`). Ruled at
  `spec/cli.md`: it is `--help`'s answer.
- `flume-harness init --help` errors: ```init` takes no arguments``.
  Ruled at `spec/harness.md` *Adoption and upgrade*.
- git 2.33 on the host; the floor is 2.36 for `worktree list --porcelain -z`.
  The README says reclamation degrades loudly — true, but discovered mid-wave.
  Open: `flume loop` / `job run` name the git version at start when it is
  below the floor (`spec/chain.md`, the floor bullet), warn or refuse.
- `runner` ships `vitestRunner()` alone; a dotnet or PowerShell consumer
  authors a `RunnerFactory` over `run`/`runAtBase`/`lanes`. Declarable,
  not a gap — but the adoption table reads as a one-liner and this is the
  largest single piece of work. Docs: say so where the runner is declared.
