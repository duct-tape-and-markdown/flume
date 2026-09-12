# spec/prompt.md names `execGate`, which no longer exists

The three spellings now share `src/spawnShim.ts`
(`isWin32ShimSpawnFailure` + `execFileWithShimRetry`); `execGate` and
`execInstall` are gone.

`spec/prompt.md` §"No cmd.exe on the inline-exec path" still says
"`execGate` (module-private) retries through `shell: true` on a win32
ENOENT". The ruling is unchanged and still true — `runInlineExec` spawns
`sh` directly and does not share the retry — but the sentence names a helper
that no longer exists, and names a module-private symbol at all, which
`.claude/rules/spec-writing.md` says a spec sentence may not do. Build
cannot edit `spec/`; this wants a human edit (drop the symbol name, or name
the behavior).

Smaller: `.claude/rules/platform-facts.md` ("Node refuses to spawn a `.cmd`
shim without a shell") now has exactly one implementation site, if the page
ever wants to name one.
