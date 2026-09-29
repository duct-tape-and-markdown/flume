# The carry widened; the exit arm it needed is keyed on shape, not a new field

`waveReadRefusal` is now `waveSlotThrow` and wraps every cause, with
`WaveCarriedThrow` as the base class and `WaveLedgerRefusal` the subclass that
adds `refusalClass`. A non-ledger carry reports no ledger class, as the entry
asked.

Two things a plan tick should know.

1. **The exit class needed an arm, and it reads existing fields.** `failed`
   alone falls through to `EX_MOUNT_DEAD` (69), so returning instead of
   re-throwing would have moved the supervisor-child contract. Rather than add
   a `TickOutcome` narrowing field beside `ledgerRefusal`, the new
   `TICK_EXIT_ARMS` entry keys on `failed && verdict !== undefined &&
   ledgerRefusal === undefined` — the shape only this carry has. That is
   derived rather than restated (`engineering.md`, *Derived state is computed*),
   but it is also an arm whose subject has no name on the outcome. If a future
   outcome ever carries a verdict on a `failed` tick for some other reason, the
   arm silently widens. Worth a look if plan wants the fact named.

2. **The render arm that fires this is still an open gap.**
   `substitutePlaceholders` (`src/Prompt.ts`) throws a plain `Error` for a
   `{{KEY}}` `promptArgs` did not supply, and `runAttempt` catches only
   `InlineExecRenderError` — so a missing arg tears the whole wave down where
   an unresolved inline-exec span is a per-entry `render-refused`. The two are
   the same class of render failure with opposite blast radii. The new tests use
   this as the arming, so it is now pinned as *reachable*, not as *correct*.
   `spec/prompt.md` still states placeholder-failure semantics as an open gap
   (the entry's own note says so); this is the concrete asymmetry to decide on.
