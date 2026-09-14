# A test title can contradict its body and every gate stays green

The retitled case (tests/Baton.test.ts, formerly "awake() and isAwake agree
on the same unreadable dir: both throw") asserted `expect(() =>
baton.awake()).not.toThrow()` under a title claiming it throws, and passed.
vitest judges the body; `judgeVitestReport` matches a `pins[]` line against
`fullName` only; neither reads the two against each other. A title is the
one claim in the suite nothing checks — and a title is exactly what a
`pins[]` line buys, so a mislabelled one is a pin that reads as covering a
property it never touched.

No mechanical fix suggests itself (title-vs-body is prose against code), so
this looks like a Sweep lens candidate, not an entry: a title naming a
subject the body never exercises in the asserted direction is vacuous in
engineering.md's sense with no `n > 0` to catch it. Worth deciding whether
it joins the standing lens list.
