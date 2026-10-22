# Rulings: the child deadline, the undeclared install, the runner's `run` (operator, interactive session)

Operator rulings on the three decisions the 2026-10-22 class records left
open. Each record names the decision; this file settles it. Breaking
changes to consumer declarations are accepted under all three; the upgrade
doc guides consumers through them.

## Child deadline — from `a-spawned-child-cannot-fail-on-its-own.md`

- **stdin closed is mechanism, not policy.** Every spawn home ends stdin; no
  knob. The spawn-caps pin's per-site verdict widens to "declares its cap,
  its stdin, its deadline".
- **The deadline is one optional supervisor knob, no engine default** —
  `gateTimeoutMs`, read per tick beside `tickTimeoutMs`, which is unset by
  default for the same reason (`engine-boundary.md`, *Surface, not
  prescription*: a default is mechanism only when a tick cannot run without
  one). It bounds every child the engine runs on a gate's behalf, a runner's
  operations included. The harness package declares a default for its
  consumers (its opinion, opted into by adopting it): generous, a ceiling
  not a budget — its job is turning "forever" into "loud". 60 minutes; a
  measured merge here took 16.
- **A timed-out gate is a gate that threw** (`spec/chain.md`, *What a gate
  returns*): the process tree is killed under `killGraceMs`, the failure's
  message names the deadline and the command, and it rides the existing
  failure path. No new result field, and no `blamesSpan: false` — the engine
  cannot tell a span's runaway test from a gate's own stall, and attributing
  one would be inferred (`engine-boundary.md`, *Told, not inferred*). A gate
  that stalls on every span is the `abortThreshold` backstop's to stop.

## Undeclared install — from `a-worktree-resolves-its-environment-from-the-checkout-above-it.md`

Option (a), with the no-lockfile arm made loud; option (b) not taken.

- **One rule for every tree the harness provisions.** `setup` undeclared →
  the engine's lockfile-aware installer runs at the root of build worktrees
  exactly as it already does for the runner's base checkout. The asymmetry
  goes.
- **No lockfile and no `setup` is refused at chain load**, naming the fix,
  instead of each tree failing or proceeding on the parent's dependencies.
  A consumer that needs nothing provisioned says so in its declaration —
  vacuous-by-design is spelled, never inherited (`engineering.md`, *A green
  verdict is proven non-vacuous*). The spelling is build's to choose against
  the declaration schema.
- **(b), a resolves-from-outside check, is not built.** It is stack-specific
  (an upward walk is node's, prettier's, eslint's, each its own), and with
  every tree installed it guards nothing (tenet: subtraction first). Reopens
  if a consumer that declares `setup` is measured resolving from the parent.
- The worktree base staying inside the checkout is not reopened.

## The runner's `run` — from the suite-scope record

**Scope is the consumer's; the shipped runner choosing it is the miss.**
`run(names, cwd)` runs the consumer's suite as its runner declaration scopes
it and reports per name beside every failure; the merged-tree regression run
and the `base-red` re-run hold over that scope, whatever its size (`spec/harness.md`, *The runner interface*).
The target shape is `the-runner-owns-a-scope-that-is-the-consumers.md`.

## Trunk moves only by fast-forward — from `trunk-holds-ungated-commits-so-undoing-one-rewrites-history.md`

**Adopted.** Picks and `afterMerge` gates run on a candidate at the trunk tip;
trunk fast-forwards to a judged candidate carrying the span and its ledger
commit, in one move, and is never rewound. The spec carries it as of the
commit that files this text: `spec/worktrees.md`, *Per-entry `afterMerge`
revert isolation* and *Batched merges*; `spec/loop.md`, *The ship lock and
the worktree lock*, *Crash equals stop*, *Tip verify*; `spec/chain.md`, the
`afterMerge` gate's `cwd`. What it retires, for plan to cut as deletions:
the merge marker and its exit-78 start refusal, the shared-checkout
`reset --keep` and the cherry-pick handling on the primary checkout, the
bystander checkpoint and the verdict's `bystanderCheckpointSha`, the
foreign-tip guard before a rewind, and the `afterMerge-revert-refused` fate.
Comments and test titles that quote the retired passages move with the
deletions. Docs that describe the marker (`docs/CLI.md`) follow.

`one-spans-merge-throw-walls-every-sibling.md` is unblocked: re-read its
wall list against this shape first, since the marker and rewind causes go.
