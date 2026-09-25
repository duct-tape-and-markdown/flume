# The shim retry has two spawn sites, and a third that cannot import the predicate

Shipped: `wordShimRetryWouldRewrite` and `shimRetryRefusal`
(`src/spawnShim.ts`), read by `execFileWithShimRetry`, by `claudeCode`'s
streaming branch, and — past the entry's `files` — by `captureSync`
(`harness/exec.ts`), the synchronous half of the same retry. Its callers were
the same exposure the entry names: `runnableShell`'s probe hands
`["-c", "exit 0"]` and `gitRange` hands `--format=%H<sep>%s`; both are single
words `cmd.exe` rewrites rather than forwards.

Behavior change a chain can hit: `claudeCode` no longer keys the refusal on
`budgetArgs.length`. The settings JSON is refused for carrying quotes, like
any other word, so chain-authored `extraArgs` carrying a space or a `%` now
refuse the win32 fallback too. Loudly, with the word named — but it is a
retry that used to be attempted.

For THE-SMOKE-SHELL-REFUSES-AN-ARGV-IT-WOULD-REWRITE: `scripts/smoke-install.mjs`
runs under plain `node` (`package.json`, `smoke:install`), so it cannot import
this predicate from `src/`. That entry forks — duplicate the rule in the
script, or move the script under tsx — and the fork is worth settling before
build reaches it.

The character set is `cmd.exe`'s alone (whitespace, quote, `^&|<>()%!`, and
the empty word the join drops). A posix `shell: true` spawn quotes just as
little, but no retry in this package takes a posix shell, so nothing here
states a rule for one.
