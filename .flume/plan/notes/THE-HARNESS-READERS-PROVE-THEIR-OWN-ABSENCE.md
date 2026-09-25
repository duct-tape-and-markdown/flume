# The absence-proof family has three engine-side readers left, and two hold no root

Both harness readers now descend through `isDirectoryOrAbsentUnder`
(`src/fsProbe.ts`). Verified on disk this tick, the same single-stat ENOENT
arm still stands at three `src/` sites:

- `Baton.token` (`src/Baton.ts:100`) — holds `this.dir`, so it has a root to
  descend from. Mechanical, same shape as the two this entry shipped: a
  baton token read as "no token" over an obstructed baton dir sleeps a phase
  that was never woken.
- `frictionNotes` (`src/friction.ts:95`) — returns `[]` on ENOENT, but its
  param is a whole `dir` with no root beside it; the caller composes state
  root + `chain.friction`. The composer needs a root, so this is a signature
  question (pass the root, or have the caller prove the descent), not a
  one-line swap.
- `livePidClaimAt` (`src/pidClaim.ts:120`) — same: it takes a whole path.
  `null` here is "no live claim", which is what a loop lock and a worktree
  guard both key on, so an obstructed state root reads as unlocked.

The last two are the interesting half: the composer's contract is "a root
the caller answers for", and these two readers were handed a leaf instead.
Filing them as one entry naming the target signature would beat three.

Two notes on this entry's own shape, for the next derive:

- `entry.files` named `tests/harnessPrompts.test.ts` for the prompt pin, but
  `buildPromptArgs` is exercised by `tests/harnessBuildArgs.test.ts`; the pin
  landed there.
- Both pins assert the refusal names the obstructed rung as a *substring*,
  never the whole message. Posix already reaches a refusal through ENOTDIR,
  so a message-shape assertion would be red on the base and no longer a pin.
  The win32 lane is what actually distinguishes the two trees.
