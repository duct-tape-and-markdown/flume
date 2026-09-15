# Two facts found while sharing the name-only decode

**The quoting fact was wrong, not merely unmeasured.** `nameOnlyPaths`' doc
comment claimed git quotes any space-bearing path, and rested its rejection of
`core.quotePath=false` on that. Measured, git 2.43: a space is never quoted;
`quotePath=false` un-quotes the non-ASCII case but leaves a control character
quoted, and a newline-bearing path then splits in two under the default line
separator. Corrected at src/git.ts and at the same stale claim in
tests/git.test.ts's `commitNonAsciiPath`. External toolchain fact, no home in
`.claude/rules/platform-facts.md`; build cannot write there.

**`readFileAtRef` re-spells the path it is handed.** `gitPath` rewrites `\` to
`/`, and the `ls-tree` existence probe passes the result as a *pathspec* — a
committed path carrying `*`, `?`, `[` or a leading `:` is globbed, not matched
literally. Inert for its OS-path callers; `snapshotReverted` now feeds it
paths git spelled, so those spellings are reachable. `--literal-pathspecs` on
the probe is the candidate fix.
