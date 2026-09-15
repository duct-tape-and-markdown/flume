# git's quoted path form still reaches three readers this entry did not scope

Fixed here: `src/git.ts`'s two `--name-only` readers. The identical decode is
still wrong at three siblings, each verified on disk this tick:

- `snapshotReverted` (`src/priorAttempts.ts:417`) splits `git show
  --name-only` on newlines, then feeds each path back into `git show
  <sha>:<rel>`. A non-ASCII path arrives quoted, that second `show` throws,
  and the enclosing try swallows it — the revert snapshot silently loses
  every file, which is the artifact's whole point.
- `bootstrap` (`harness/windows.ts:640`) filters `git ls-files` through
  `matchesAny`; a quoted path matches no glob, so a tracked non-ASCII file
  never enters a bootstrap window.
- `commitsPast` (`harness/windows.ts:844`) reads `--name-only` inside a
  custom `--format` record, so `touches()` misses a commit whose only path
  is non-ASCII and the sweep never arms on it.

The third is not a straight `-z`: that flag also reterminates the format
fields the record parser splits on, so it needs its own shape.
