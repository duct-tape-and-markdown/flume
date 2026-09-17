# Three stale citations surfaced under the split

`tests/helpers/subprocess.ts`'s SPAWN_OUTPUT_CAP_BYTES roster was wrong at
three names, not one: `src/job.ts` never spawned anything, the 4 MiB cap it
puts at `src/Dispatcher.ts` lives at `src/tickAttempt.ts`, and
`src/setupWorktree.ts` declares 64 MiB — above the 16 MiB the comment calls
"the ceiling of that range". I corrected the roster and scoped the ceiling
claim to output a tick reads back, but the 64 MiB install cap vs. the
harness's 16 MiB is a real gap: a fixture that drives a worktree install
through this helper can overrun where the engine would not. Worth a look.

`src/chainLoad.ts` named "the CLI's job verbs (`src/job.ts`)" as one of its
three load surfaces; those verbs went in dc561b31. Re-pointed at
`src/cliChainLoad.ts`.

Two entry.files predictions were off: `src/cliHelp.ts` and
`tests/cliHelp.test.ts` carry no ignore-set reference at all.

`countFrictionFiles` now has no `src/` caller outside `src/friction.ts` —
its export is earned by `tests/friction.test.ts` alone.
