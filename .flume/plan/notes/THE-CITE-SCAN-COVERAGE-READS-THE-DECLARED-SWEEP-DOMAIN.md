# The coverage pin now tracks the declaration, and `tests/` left it with the domain

`SWEEP_DOMAIN` in `tests/commentCitations.test.ts` is now derived from
`declaration.slices.sweep.domain`, folding each `<tree>/**` glob to the prefix
the scans report modules under, and refusing loudly (at collection) on a
domain entry that names anything but a whole tree or on a `sweep` the
declaration stopped carrying. The coverage assertion moved out of the
page-name test into its own case, since `pins[]` matches a full test name.

Consequence worth plan's eye: the pin now covers exactly the five trees the
declaration names, so `tests/` is no longer asserted there. It is still
judged — `repoScan` opens it and the `src/`, `harness/`, `tests/` pins name it
explicitly — but the union coverage claim no longer reaches it. If the intent
was ever "every tree either scan is expected to open", the declaration is not
the whole source for that, and the gap is `tests/`-shaped by construction.

Verified the derivation discriminates by adding `docs/**` to the declared
domain locally: the pin reds with `docs/ -> false`, and the declaration was
reverted before the commit.
