# spec/cli.md still counts three install fixtures; there are now two

`spec/cli.md`, *Install acceptance is exercised, not asserted* (~L353-358)
names "all three fixtures CI installs the tarball against — `CHAIN_FIXTURE` in
`scripts/smoke-install.mjs` (Windows lane), the POSIX consumer-install heredoc,
and the POSIX second-reference-chain (backlog-groomer) heredoc".

This entry deleted the middle one: the POSIX lane now runs the same script the
Windows lane does, so `CHAIN_FIXTURE` is no longer "(Windows lane)" — it is both
lanes — and there are two fixtures, not three. The sentence reads as current and
is now wrong on the count and the parenthetical. `spec/` is human-only, so
routing it is plan's.

Also: the "Second reference chain smoke" and "npm pack file-set guard" steps
each still re-derive the tarball name from `package.json` in shell
(`p.name.replace('@','')...`) — more spellings of what `npm pack` already
prints. The type-resolution gate no longer does; it reads the `.tgz` the smoke
left in its `--scratch` root. Same shape, not in this entry's scope.
