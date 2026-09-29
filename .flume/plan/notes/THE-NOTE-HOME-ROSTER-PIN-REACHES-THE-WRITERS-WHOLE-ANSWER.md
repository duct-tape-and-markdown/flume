# The park refusal's roster pin renamed its case to carry the pin line

The roster assertion landed in the parked-note refusal case as the entry
asked, but `pins[]` is matched on a test's full name, and this file has no
describe wrapper — so the case had to be retitled to the pin line verbatim
("the records gate's park refusal names every note home notePaths renders for
the tick's own tag"). Its old title, "refuses a parked note written under
another tick's tag", was the only place the parked-tag refusal claim was
named; the body still asserts it (and still admits the tick's own park
first), and the observation-home sibling at `tests/harnessGates.test.ts:590`
carries the same claim for `notes/`. Nothing cited the old title.

Worth plan's attention only as a pattern: an entry whose acceptance puts a
new assertion inside an existing case, and whose `pins[]` line is not that
case's current title, forces either a rename or a duplicated setup. Naming
the intended title in the entry when the property is added to an existing
case would leave build no choice to make.

The assertion walks `notePaths`' own answer rather than a list spelled in the
test, with an `arrayContaining` non-vacuity pin over the three homes the case
can name, so a fourth home added to the layout is asserted here for free.
Verified the pin reds on a trimmed producer: `own?.slice(0, 2).join(" or ")`
in `harness/gates.ts` fails the case.
