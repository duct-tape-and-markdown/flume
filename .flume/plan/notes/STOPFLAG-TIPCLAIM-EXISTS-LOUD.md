# The gates are loud; the writers behind them still are not

Four sites adopted `existsLoud`. Two follow-ons verified on disk this tick:

- `liveTipClaimPid` (src/git.ts:565) still `existsSync`. `status` now
  refuses an unstattable tip claim, but the *acquire* path below it reads
  the same path as "no claim" and takes the tip over it — the higher-stakes
  half. Same shape: git.ts:292/432/433, priorAttempts.ts:208,
  worktrees.ts:178, Dispatcher.ts:655/675/710/1021/3937/3979.
- `Baton.isAwake` (Baton.ts:43) is `existsSync` while `Baton.awake()` (:36)
  is `readdirSync` — one class, two dispositions for the same failure, and
  `hibernating()` derives from the loud one.

Debt, not filed: `flume status --help` still read "Exit codes: 0 Always"
after CLI-STATUS-LOOPPID-EXISTS-LOUD made it exit 74; corrected here, with
`loop --help`. Only `tick`'s list is gated against the code that returns it
(tests/cliHelp.test.ts) — `status`/`loop`/`job` agree by hand.
