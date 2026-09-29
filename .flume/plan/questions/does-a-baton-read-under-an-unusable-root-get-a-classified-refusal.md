# When the constructor's `mkdir` leaves, what classifies a baton *read* — and which `74` rows survive?

From the park of READING-THE-BATON-CREATES-NOTHING. `spec/loop.md`, *Baton —
presence wakes, absence hibernates* has already ruled the head ("The directory
is created by the first `wake`; until then its absence is the empty baton, so
reading the baton creates nothing"), so the entry's cite is sound and the
narrowing is not in question. What the corpus has not ruled is what the
narrowing knocks over on its way past.

## What the constructor `mkdir` is load-bearing for today

`new Baton` calls `mkdirUnderStateRoot(flumeDir, "awake-flag directory", …)`
(`src/Baton.ts:87`), so it is the **first write every baton verb makes**, and
that one call is the seam every verb's `74` row is proven through. Measured on
the tree in the parked attempt: mkdir moved to `wake`, `awake()` given an
ENOENT arm, nothing else changed, run over the denial fixture
`tests/cliHelp.test.ts` already owns (a plain file at `awake/`, a directory at
`stop`):

    status 1, tick 1, sleep 1   — raw ENOTDIR stacks
    loop 1                      — "stop flag present"
    wake 74, stop 74            — the write refusal
    render 0, log 0, check 0, friction 0

Exit 1 on a raw stack is what `src/cli.ts:316` calls "the one exit these verbs
may not take", and `status` has no exit-1 row at all. So the narrowing cannot
land as the entry is written.

## The forks

1. **Does a *read* under the root get a classified refusal?** `awake()`
   (`src/Baton.ts:92`) `readdirSync`s the dir, and it is what `status`, `tick`
   and `loop` die on once the mkdir is gone. Either a sibling of
   `StateRootWriteError` (`src/stateRootWrite.ts`) with its own arm in
   `main()`, or one access class covering both directions. Absence is already
   the empty baton per the spec sentence; this fork is only about ENOTDIR and
   EACCES.
2. **Does `Baton.sleep`'s unlink go through the write refusal?** After the
   narrowing it is the only thing left in that verb that can fail.
3. **Which `docs/CLI.md` `74` rows state it afterwards.** `render` clearly
   drops it. `loop` keeps it — its supervisor reads the baton — but the fixture
   can no longer drive it there: the stop-flag denial that `stop` needs refuses
   `loop` at exit 1 first. So the gate's one pass stops reaching every verb's
   first access: either two denial passes, or a weakened equality.

## Two prose sites that move whichever way this goes

Both cite the constructor `mkdir` as the reason a probed directory is not
state, and the second-root arithmetic needs a different example once it is
gone:

- `holdsState`'s doc (`src/cliStateDirs.ts:96`) — "constructing a baton mkdirs
  `awake/`, so one read-only look at the default root leaves an empty directory
  behind".
- `docs/CLI.md:23` (*State-root and config-dir resolution*) — "a read-only
  `flume status` creates an empty `awake/` in the default root on its way to
  reading it".

`docs/CLI.md:33` (the `status` `74` row) likewise names "the awake-flag dir
this verb creates under it".

I lean 1 as a read-side sibling class: `main()` already dispatches one write
refusal, the two directions report different causes to an operator, and
collapsing them makes the `74` prose say less than it says today. But the
exit-code contract is the corpus's, and no autonomous phase can rule it.
