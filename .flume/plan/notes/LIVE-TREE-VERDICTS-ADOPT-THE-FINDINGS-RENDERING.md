# The empty-array verdict family is wider than these three scans

**Two more in the named files.** `exportConsumers.test.ts` carried a *fourth*
live-tree verdict past the three cited — the `isProperty` arm, now at :587 —
and `pageAnchors.test.ts` asserted its page-coverage list empty at :250. Both
read the rendering now; leaving them would have made "every live-tree
findings verdict" false in the same files.

**A formatter over an empty list is never exercised.** `formatAnchor` and
`formatSectionRef` (`tests/helpers/pageAnchors.ts`) would have printed a site
name never, the live-tree lists being empty by construction. So this entry
also routed pageAnchors' *fixture* verdicts through them — object literals
before, rendered lines now. A follow-on entry adopting the rendering for a
scan whose sites are objects needs that second half, or it ships a site
vocabulary no case has printed (`engineering.md`, *A green verdict is proven
non-vacuous*).

**The rest of the family, unfiled.** Eight more verdicts over the live tree
assert an array empty and would report `[ ...(n) ]` on revert:
`hostDeclarations.test.ts:49,:70` (and the reason arm at :58),
`spawnCaps.test.ts:318`, `namespacedFsPaths.test.ts:136,:144`,
`Baton.test.ts:207,:208`. All but one already map through a formatter, so
those are an import. The exception is `Baton`'s `scan.uncalled`, a bare
string set with no site spelling at all. I checked the others that grep
turns up — `hostDeclarations:113`, `fixtureRoots:423`,
`subprocessHelper:1024`, `namespacedFsPaths:192,:319,:321` — and every one
is a fixture verdict over a known list, which is not this defect.

Now that `expectNoFindings` has one home (`tests/helpers/repoProgram.ts`)
each is mechanical — one entry per scan, or one wave.
