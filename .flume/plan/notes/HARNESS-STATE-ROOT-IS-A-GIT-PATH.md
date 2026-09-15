# node:path re-dialects a normalized state root

The entry predicted normalizing at `repoRelativeStateRoot` would let
`harness/chain.ts` drop its pending-path conversion. It cannot:
`resolvePendingPath` composes with `node:path`, so on win32 it turns the
slash-joined root straight back into backslashes. The call site stayed,
now reading the engine's exported rule.

The pattern generalizes and is worth a lens. Paths under a state root are
composed two ways in `harness/`: by template literal (`records.ts`,
`planState.ts`, `prompts.questionsPath`), which preserves whatever dialect
the root arrived in, and by `node:path` (`resolvePendingPath`), which
imposes the host's. Normalizing the root once only covers the first kind —
any new composer reaching for `join`/`resolve` needs `gitPath` again, and a
posix run cannot see the difference. Nothing mechanical holds this yet; a
type distinguishing a git path from a host path would, but that is a wider
change than this entry.

Also renamed: `src/git.ts` had a private `gitPath(repoRoot, relPath)` that is
`git rev-parse --git-path` — now `revParseGitPath`, freeing the name for the
separator rule.
