# May the harness package's comments cite this repo's rule pages?

`harness/` ships to consumers. Its comments cite `.claude/rules/engineering.md`
(175 times), `engine-boundary.md` (45), `platform-facts.md` (12) and
`collaboration.md` (1) — pages no consumer's tree holds. The citation pin resolves
cites against *this* repository's disk, so nothing catches it, and a consumer
reading a shipped module follows a reference that resolves nowhere.

The tick that shipped the sweep procedure drew a line at behavior and added a pin
for one page only (`no module under harness/ cites posture-sweep.md`): a module
citing a rule page for the **shape of its own code** is explaining itself to this
repo's authors, which is what a rule page is for; one citing a page for a
**mechanic the package implements** names a file the consumer does not have. That
line is defensible and it is also one tick's judgment, unratified.

- **(a) Ratify the behavior/shape line and pin it per page.** Each rule page gets
  the same treatment `posture-sweep.md` got where it states a mechanic the package
  ships, and shape cites stay. Needs a rule-level sentence saying which pages are
  which; the pin can only be written once that sentence exists.
- **(b) Every warrant a shipped module carries moves into `spec/`.** Honest for a
  consumer — everything a module cites is in the package's own contract — and a
  large entry: 233 cites, and `spec/` would absorb shape doctrine it does not
  carry today.
- **(c) Leave it; the cites are for this repo's authors.** Consumers read `.d.ts`
  hover text and the `docs/` pages, not module comments, so a dangling reference
  in a comment costs them nothing. Cheapest, and it leaves the package shipping
  references to files that are not in it.

A ratified answer also decides a smaller thing already standing: whether
`.claude/rules/posture-sweep.md`'s trim to *Standing lenses* is the end of that
class or the first of several.

## What the trim leaves, measured 2026-10-07

The procedure cites have landed on the package: 13 moved across 5 test files,
and what still names `.claude/rules/posture-sweep.md` from `tests/` is
*Standing lenses* and its lens bullets alone — plus the fencing pin's own
string literals. Three facts the trim's author needs:

- **One section of the page has no package counterpart.** *The sweep runs
  beside build, never ahead of it* finds no bullet under `spec/harness.md`,
  *The sweep procedure*; its claim is stated one section up, at *The phases*
  ("Product outranks insurance through the declared phase order above …
  never through the queue"), which is where `tests/harnessWindows.test.ts`
  now cites. So the trim either leaves that section with its claim homed
  elsewhere in the corpus, or the procedure section absorbs the bullet —
  a spec edit nobody has made.
- **Two cites now land on a section that names no tree.** The domain cites
  (`tests/commentCitations.test.ts`, `tests/pageAnchors.test.ts`) name *The
  sweep procedure*, whose lead says the **consumer** declares the domain;
  the values are at `.flume/declaration.ts:135`. If the trim keeps a heading
  over this repo's own domain list, those two could point back at the page —
  today they point at the package's ruling, not at this repo's list.
- **The fencing pin's vacuity half reads this page.** `no module under
  harness/ cites .claude/rules/posture-sweep.md`
  (`tests/commentCitations.test.ts:2459`) asserts the page heads at least one
  *section* cite somewhere in the scan before reading the harness-side
  emptiness. After the trim that rests on *Standing lenses* alone. It reds
  loud rather than hollowing out, so nothing is broken — but a pass that
  moves the lens cites too makes the guard unsatisfiable, and its subject
  should then become the **declared posture pages**, not this one page.
