# Branch deletion now needs `worktree list -z` too — does the floor's "reclamation and nothing else" bound move, or does the read?

From the sweep, frontier module `src/git.ts` (commit `41ce1209`, in this
window). Section: `.claude/rules/engineering.md`, *Loud or nothing* — "a
degraded-but-proceeding path is declared and cited at the site, with the
refusal that bounds it named". The declared bound is stated in the spec, so
one arm of the fix is a human's.

## What the tree is, verified this tick

`deleteBranch` (`src/git.ts:579`) stopped running `git branch -D` and now
deletes the ref with `update-ref -d`. `update-ref` does not refuse a
checked-out branch, so that refusal is kept by reading the worktree registry
first — `worktreeListPorcelain` (`src/git.ts:548`), which is
`worktree list --porcelain -z`.

**`-z` is the git 2.36 feature the engine declares a floor for**, and the
declaration states its own scope three times:

- `spec/chain.md`, *The package a chain loads through*: "on an older git
  worktree reclamation degrades loudly **and nothing else does** … because the
  degrade is **bounded to reclamation** and the loop is otherwise a working
  one."
- `src/cliLoop.ts:46` (`gitFloorWarning`'s own doc): "reclamation — **and
  nothing else** — degrades. That bound is what makes proceeding a **declared**
  degrade rather than a silent one (`.claude/rules/engineering.md`, *Loud or
  nothing*)."
- The operator string it renders (`src/cliLoop.ts:59`) names only "worktree
  reclamation degrades". `README.md:38` and `src/git.ts:1495`
  (`WORKTREE_LIST_Z_FLOOR`, which names `readWorktreeRegistry` as *the* read
  the floor is for) say the same.

The bound no longer holds. Below the floor `worktreeListPorcelain` rejects
(`-z` is an unknown option, exit 129) before `update-ref -d` is reached, so
**no branch is ever deleted**: `teardownWorktreeInstance`
(`src/worktrees.ts:699`) and the startup sweep's reap (`src/worktrees.ts:951`)
both catch and `log.warn` per branch, and every tick's `flume/<checkout>/<slug>`
ref leaks. Fail-safe in direction — nothing is deleted that should not be —
but a second thing stops working and the run's one declared degrade list does
not say so. `deleteBranch`'s own doc comment does not name the dependency
either.

Pre-`41ce1209`, `branch -D` worked on every git, so this is new.

## (a) Widen the bound: the degrade names branch deletion too

`gitFloorWarning`'s string, its doc, `WORKTREE_LIST_Z_FLOOR`'s doc,
`README.md`'s prerequisite line, `tests/cli.test.ts:6596`'s assertion and
`tests/harnessPackaging.test.ts:806`'s claim all widen — **and so does
`spec/chain.md`**, which is yours, not a build tick's. The code does not move.

- For: honest about what the engine actually needs, and keeps one registry
  dialect. Mechanically small on the code side.
- Against: it is a capability regression on old gits ratified after the fact.
  An operator below the floor now loses branch reaping as well, for a safety
  refusal that `branch -D` used to enforce on any git — and the entry cannot
  be filed at all until the spec sentence moves, because an entry whose
  `acceptance` contradicts its own `per` cite is not a clean entry.

## (b) Restore the bound: `deleteBranch`'s refusal reads the non-`-z` form

`worktree list --porcelain` without `-z` exists since git 2.7. It is unfaithful
only about the **path** field (newline-separated records, path never escaped) —
and `deleteBranch` reads the path for its error message alone. The field its
refusal turns on is `branch refs/heads/<name>`, and git's ref grammar forbids a
space and every ASCII control character in a ref, so that line is exact and
unmanglable under either form.

- For: the spec's bound becomes true again with no spec edit, and the floor
  stays what it was declared to be — one read, one degrade. Entry-filable today
  with a clean `per` into `spec/chain.md`, *The package a chain loads through*.
- Against: a **third** porcelain decode and a second dialect at a site that
  already duplicates one (see below). A worktree path containing a newline
  could in principle split into a record whose continuation reads as a `branch`
  line; the engine composes those paths itself, so it is pathological rather
  than reachable, but it is the thing `-z` exists for.

## (c) (b), but the decode gets the module it is a job for

`src/worktrees.ts` already owns this decode — `WORKTREE_FIELD`,
`BRANCH_FIELD`, `readWorktreeRegistry` (`src/worktrees.ts:167`, `:333`) — and
`deleteBranch` re-spells both field literals inline (`src/git.ts:592-593`).
`deleteBranch` cannot import it: `worktrees.ts` imports `git.ts`, so the shared
decode wants a file of its own, which is the shape `engineering.md`, *A module
is one job* calls "a job the tree gives no file to". With one home, the dialect
is decided once.

- For: fixes the duplication and the bound in one move, and the next consumer
  of the registry inherits whichever dialect is chosen.
- Against: a new module and two call sites rewritten for a bound that (b) fixes
  in one function. More than the finding costs.

## My read

**(b)**, and file (c)'s decode move separately as the cohesion debt it is.
The spec states the bound in two sentences that are load-bearing for an
operator's install decision; making the code honour them is cheaper than
re-ratifying them, and the field `deleteBranch` actually reads is one the
non-`-z` form cannot mangle. I did not take it, because (a) is a legitimate
answer — "the engine needs 2.36 for two things now" — and that call is a
product one about what an old-git host is promised, not a shape one.

Whichever arm you take, `src/worktrees.ts:945` goes with it: that comment
still justifies reaping after the prune with "`git branch -D` refuses a branch
git still has registered against a worktree", naming a command `deleteBranch`
no longer runs. The ordering it argues for is still required — `worktree list`
names a prunable record until the prune clears it — so only the reason is
stale.
