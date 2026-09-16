# One exemption, and a platform fact with no page

171 bare sites over 40 files (entry measured 166/39; this count is off the
parse). Every one was `join(tmpdir(), X)`, so the rewrite was uniform.

**One exemption, not two.** The entry predicted a second - "a case whose
subject is an unfolded spelling". None exists: the scan reads call and import
nodes, so `mkdtemp` in prose, in a doc comment, or inside a fixture source
handed to another scan is not a site. `tests/helpers/fixtureRoot.ts` is the
only spelled exemption.

**A fact no page carries.** Node's JS `realpathSync` rebuilds its answer from
the components it was handed, so it resolves a link but leaves win32's 8.3
alias as found; only `realpathSync.native` asks the OS. platform-facts.md has
the 8.3 fact and the JS/native split separately, never their intersection, so
`mkTempDirSync`'s `.native` choice is held by a doc comment at the site. A
candidate line for the human's surface.

**No sync `mkFixtureRoot`.** No sync site needed a planted bay - all 16 were
unrooted before.
