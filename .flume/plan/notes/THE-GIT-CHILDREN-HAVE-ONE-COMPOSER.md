# Five git children now compose through `spawnGit`

- Plan's file map predicted `worktreeAdminDir` (`src/worktrees.ts`) would
  stay and call the new leg. It is gone instead: once its body was
  `return git.absoluteGitDir(x)`, its doc comment restated the leg's
  verbatim ("asked of git rather than composed from the base name git
  derives"), so one fact was stated twice. The doc moved to
  `absoluteGitDir` (`src/git.ts`) and both callers name the leg.
- `spawnGit` gained exactly one narrowable option, `maxBuffer`, defaulting
  to `DEFAULT_CAPTURE_CAP` (16 MiB); cwd and `literalPathspecEnv` stay the
  composer's. Each leg spells its cap at its own signature —
  `absoluteGitDir` 64 KiB, `COMMIT_TEXT_CAP` 4 MiB for `commitMessage` and
  `showDiffStat` — so the bound rides the leg, not the call, and every
  caller of a leg inherits it.
- `src/` now spawns no git outside `src/git.ts`: a search for the literal
  binary name finds that module alone. The one other git composer in the
  tree is `git()` (`harness/gitRange.ts`), the package's sync spawn through
  `captureSync` (`harness/exec.ts`) — declared and cited at the site, and
  it imports the dialect from `src/git.ts`, so it is not this family.
- The citation pin reds on a backticked git config key in a new comment:
  it read the key as a declaration those trees should hold. Reworded to
  prose. No backtick spelling of an external tool's config key passes that
  pin, which is worth knowing before a comment reaches for one.
- Claims no property, as filed: this is a pure re-composition and the
  suite is unchanged. The legs are covered by the existing tests that
  already drive the revert path and the worktree sweep.
