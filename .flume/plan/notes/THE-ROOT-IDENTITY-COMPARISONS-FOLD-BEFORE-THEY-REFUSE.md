# The fourth root-identity comparison is the registry membership test, and it does not fold

The three comparisons named in the entry now fold through `canonicalDir`. A
fourth in the same family does not: worktree-registry membership. Every
caller asks `registry.worktrees.has(resolve(path))`, and
`readWorktreeRegistry` (`src/worktrees.ts`) keys its map by `resolve` of the
path git printed — git's real spelling on one side, a path the engine
composed from `ctx.flumeDir` on the other.

Measured this tick on a scratch fixture: one state root, provisioned through
its real name, then reached under a symlinked spelling with **no declared
worktrees base** (so the base composes from the aliased root):

- `sweepStaleWorktrees` left the residue standing — not even reported, since
  a path the registry disclaims takes the silent `continue` arm, not the
  `unstamped` warning;
- `createWorktree` refused with "occupied by a directory git does not
  register as a worktree of <repo>".

So the stamp fold this entry ships is reached only where the base is
identical on both sides — a chain-declared `worktreesBase`, which is exactly
how the two new tests isolate it. Without that, the aliased run still fails
one step earlier.

Not filed here because it is not the same mechanism and it touches package
surface: the fold would have to move into `readWorktreeRegistry`'s keys (and
every lookup), and that map is handed to chains as
`FlumeApi.git.readWorktreeRegistry`, whose consumers compare their own
composed paths against it. Folding the keys changes what a chain's
`has()`/`get()` sees; leaving them and folding only in `src/` leaves the same
split one boundary out. Plan's call which side owns it.

Also: `worktreesBase(flumeDir)` itself composes from whatever spelling the
state root arrived in, so two spellings of one root name two bases for every
reader that does not get a declared one — the upstream suspect for the whole
family.
