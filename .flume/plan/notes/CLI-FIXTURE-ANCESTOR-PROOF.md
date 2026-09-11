# One CLI fixture cannot be rooted; two residues beside it

Measured: a `.flume` at `TMPDIR` red-lines exactly 8 tests, all in the two
declared files. Every other suite was already immune (plants its own bay or
sets FLUME_DIR), so the entry's file list was exact.

**Un-rootable (acceptance's named exception).** `resolveRepoRoot — §9 bay
discovery walk-up > no .flume anywhere above cwd: falls back to cwd
unchanged` (tests/cliJobResolution.test.ts). Its subject *is* the walk
reaching the filesystem root without meeting a `.flume`; planting one deletes
the behavior. Left on plain `mkdtemp` with a comment saying a red there means
a littered host, not a regression. Only a cwd the process cannot reach past —
a container or chroot — would close it; not worth the machinery.

**Residue, not filed.** (1) `makeJobRepo` is duplicated verbatim in
tests/cli.test.ts and tests/cliJobResolution.test.ts — the rooting edit had
to land twice, identically. (2) Both new pins go red on the base by missing
symbol (`mkFixtureRoot` undefined), not by assertion — sanctioned by
`judgeRedOnBase`'s doc, but the red is shallow.
