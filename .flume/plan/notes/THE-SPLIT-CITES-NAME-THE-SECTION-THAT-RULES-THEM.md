# Thirteenth site: the same wrong-door cite in tests/helpers/docSections.ts

The entry named twelve sites; the tree held thirteen. `tests/helpers/docSections.ts:459`
carries the lens spelling verbatim ("a set read off all of it turns on whatever the
neighbouring arms happen to quote") under the same wrong section. Its wrap differs
by one trailing clause, so a search keyed on the two-line block the other four share
misses it. Fixed here with the rest.

Two residues left standing, both outside this entry's ruling:

- `tests/harnessChain.test.ts:1588` cites the lens as `(..., a negative assertion over
  a whole rendered artifact)` — lowercase, unemphasized, so it is not a pair the
  citation reader resolves at all. Right door, unpinned spelling. Two other sites use
  the quoted form (`tests/cli.test.ts:2223`) and the italic form
  (`tests/harnessJudge.test.ts:593`); three spellings for one lead.
- Several sites cite `*Standing lenses*` — the container heading — where the bulleted
  lead itself is now resolvable (`tests/harnessBuildArgs.test.ts:600`,
  `tests/harnessPrompts.test.ts:1255,1404`, `tests/cli.test.ts:4689`,
  `tests/helpers/repoChain.ts:96`, `tests/examples.test.ts:2736`,
  `tests/harnessWindows.test.ts:2021`). Green, but a cite at the page's coarsest door:
  the pin cannot tell which lens the site is under.

Neither can change behavior; both are the same family this entry is the sixth body of.
