# Does "git records a worktree's realpath, whatever spelling `add` reached it through" get its own platform-facts section?

From a build note (THE-WORKTREE-REGISTRY-ANSWERS-MEMBERSHIP-ITSELF). The fold
that note shipped — `worktreeAt` deciding membership through `canonicalDir`
rather than at each caller — rests on a git behavior whose only trace in the
tree is three test cases that exercise it and a doc comment that states its
*consequence*. `CLAUDE.md` says the fact's home is
`.claude/rules/platform-facts.md`, and that page is yours, not any autonomous
phase's, so this needs your ruling before anything moves.

## The fact

Measured this tick, git 2.43.0 on linux (the note measured the same on git 2.x):

- `git worktree add <path>` resolves `<path>` and stores the **realpath** in
  `.git/worktrees/<name>/gitdir`, whatever spelling the add reached it through.
  Adding `/tmp/p/alias/wt` where `alias -> real` records `/tmp/p/real/wt/.git`.
- `git worktree list --porcelain` then prints only that realpath — including for
  the main worktree, and **including when `list` itself is invoked through the
  second spelling** (`git -C /tmp/p/alias/repo worktree list` still prints
  `/tmp/p/real/repo`).
- `git worktree remove <path>` **accepts either spelling**: removing
  `/tmp/p/alias/wt` succeeds against the entry recorded as `/tmp/p/real/wt`.

So git resolves paths on the way in and reports resolved paths on the way out,
and its own write verbs forgive the second spelling. The asymmetry is visible
only to a caller that compares a path it composed against the path git printed.

That is the whole defect the note's fix closed: any state root reached under a
second name (a `FLUME_DIR` typed through a link, a linked checkout) composes
worktree paths git will never print, and only the removal half forgave it.

## What the tree already leans on it, by hand

- **The consequence, stated without the fact.** `src/worktrees.ts:104`-`:115`
  (the `worktreeAt` doc) says a caller matching a composed key "is instead
  asking whether git's spelling of a directory is the engine's", and that a
  second on-disk spelling "makes every path that run composes a directory git
  disclaims". True, and it never says why git's spelling differs.
- **Three cases that exercise it and state nothing.**
  `tests/worktrees.test.ts:533`, `:576`, `:1534` (plus `:1572`) plant a symlink
  alias and assert `realpathSync.native(alias) === resolve(...)`. The assertion
  *is* the fact, spelled as a fixture precondition.
- **The consumer-facing prose.** `docs/CHAIN-AUTHORING.md:1536` and the
  `FlumeApi.worktreeRegistry` hover (`src/flumeApi.ts:359`) both tell a chain
  that one directory has many names — again the consequence, not the behavior.

## The fork

**(a) Its own section.** Recommended. It is git's behavior, host-independent
(the realpath resolution is not a win32 accident), and it retires when git stops
resolving at `add` — one expiry predicate.

**(b) A paragraph inside *`tmpdir()` can return an 8.3 short path git never
spells*,** which is the page's existing "git prints a spelling you did not
compose" section and already ends with "canonicalize with `realpath` on both
sides before comparing". Cheaper, and the advice is identical. But that
section's claim is win32's and expires when win32 changes its short-path
behavior, while this one expires on a git change; two expiry predicates in one
section is a section the sweep's expired-narration lens cannot retire by halves.

Either way nothing pins it — an external tool's behavior lands as prose by
construction, like every other section on that page.

## What your ruling unblocks

Once a heading exists, the doc comment at `src/worktrees.ts:104` shrinks to a
pointer at it and the three fixture preconditions gain a cite for why they
symlink. All are in `src/` and `tests/`, which build can write, so that is a
queue entry the next drain files — it cannot be written before the heading it
has to name, because the citation pin resolves the `*Section*` half against the
page's real headings.

## Not part of this question

The same note flagged that `registry.worktrees` is still keyed by git's spelling
(two `-z` fidelity pins want that), so a downstream chain can still spell
`worktrees.has(resolve(p))` and get the pre-fix bug one package boundary out.
That was accepted as debt this tick, not filed: no in-tree consumer does it, and
both consumer-facing prose sites now name it as the bug and steer to
`worktreeAt`. It re-files through the inbox when an external chain arrives
holding the composed key.
