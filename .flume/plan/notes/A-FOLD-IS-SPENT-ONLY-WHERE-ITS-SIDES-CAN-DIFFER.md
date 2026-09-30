# the fold's absence is measurable and nothing measures it

Shipped as filed: both `resolveStateDirs` comparisons short-circuit on raw
string equality, so the default invocation spends zero `realpathSync.native`.
Measured with a spy over the real function, not reasoned: default 0,
inherited-own-stamp 0, `FLUME_DIR=/mnt/state/.flume` 2. Full suite green,
tsc green, no message or published env value moved.

Two things for the next rotation.

**The spend is decidable and unpinned.** The entry claims no property by
design (`posture-sweep.md`, *Routing*), so nothing reds if a later edit
restores the unconditional fold — and the property is not prose-only: a spy
on `realpathSync.native` around `resolveStateDirs(env, root)` counts it in
three lines. Same instrument reaches the sibling folds (`cli.ts`'s bay-root
check, `worktrees.ts`'s stamp reads). If the family is worth a rung, it is
worth that pin; if not, this note is the record that the rung was available.

**One operand changed, and the tree holds its invariant nowhere.** The
cross-repo guard now folds `resolve(repoRoot)` rather than `repoRoot`, so the
skip is literally "equal strings fold equal" over the same pair the guard
compares and the write-back publishes — one spelling, one binding. Those two
folds differ only for a `repoRoot` carrying `..` across a symlink, where
`resolve` is lexical and `realpath` is the kernel's. No caller can hand that
in: `resolveRepoRoot` answers `process.cwd()` or a `dirname` chain off it,
both already normalized, and every test passes a normalized absolute. But no
type says `repoRoot` is normalized and no test pins it — the function's
signature takes a bare `string`. If plan wants that invariant held rather
than relied on, the rung is the parameter, not a comment.
