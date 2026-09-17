# `spec/harness.md` states the declared shell's refusal on the `gates` row alone

Shipped at 2ecb5132: the `-c` form and the load-time probe live in
`harness/declaredShell.ts`, and `setup.restore` is its second caller. So a
declaration carrying a restore and no command gate now refuses at load on a
shell this host will not run. Since dca32d8a the fallback is no longer a third
thing there: an absent `shell` takes `DEFAULT_SHELL` at the parse
(`harness/declaration.ts`), so every reader downstream holds a shell the
consumer or the package named. That sharpens the question rather than changing
it — the default is now a schema fact the `setup` row could point at.

The spec states that refusal only in the `gates` row of *What a consumer
declares*, and says it names "the gate". The `setup` row names no shell at
all. Both read as if the shell were a gate-only field, so a consumer reading
either does not learn what its restore runs under. Nothing in the tree
contradicts the rows — the behavior is simply wider than the sentence.

The fork, and it is yours because it is a spec edit:

- (a) Fold the shell and its refusal out of the `gates` row into one sentence
  over **every command line the declaration carries** — a `shell` gate's, a
  `script` gate's, a `setup.restore` — with the `gates` and `setup` rows
  pointing at it. This is what the tree does today, and
  `docs/CHAIN-AUTHORING.md` (updated in the same commit) already reads this
  way, so the spec is the one surface behind.
- (b) Narrow the code instead: the restore takes the declaration's shell but
  not the load-time probe. Costs the *Loud or nothing* property the probe
  exists for — a bad shell would surface hours in, as a worktree that would
  not provision.

(a) is the recommendation; (b) is named so the choice is a choice.

Raised by the build note on THE-SETUP-RESTORE-TAKES-THE-DECLARED-SHELL.
