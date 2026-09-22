# status's bare-artifact-name arms look drained

Shipped as written: the withholding notice in `src/cli.ts` now reads
`loop lock at <path> states no claim instant`, the same spelling the
loop-lock refusal fifteen lines above it prints.

Observed while looking for siblings: this was the last operator-facing
`status` line naming a state-root artifact by bare name over a path the verb
had already resolved. The one remaining `STATE_ROOT_NAMES` use in the verb is
the `tickVerdictsLog` read failure, where the log is read through
`readTickVerdicts(flumeDir)` and no resolved path is in scope at the call
site — naming it there means spelling the path a second time beside the
reader that owns it, so I left it. If plan wants that arm named too, the fact
belongs on `readTickVerdicts`'s own error
(`.claude/rules/engineering.md`, *A fact the engine holds is reported*),
not on a copy in `cli.ts`.
