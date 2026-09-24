# Arming the subject rule on both trees widened src/'s own verdict too

Measured on this tick, `tests/engineMessages.test.ts`:

- `trees: ["src/"]` — 51 modules, 159 spans, **10** judged, 10 resolved.
- `trees: ["src/", "harness/"]` — src/ slice: same 159 spans, **20** judged,
  20 resolved. harness/ slice: 39 modules, 52 spans, 20 judged, 20 resolved.
  No findings either side.

So the src/ half of the judged set doubled without a literal changing. The
subject rule reads the declarations of the trees it judges, and ten spans in
`src/` messages name functions only `harness/` declares — citations the
src-only pin collected as spans and then dropped as naming nothing. The pin's
reach was a function of its `trees`, not of the tree it claimed to judge, and
the same is true in reverse: a `harness/`-only scan would have passed over
every harness message naming an engine function. One scan over both trees is
why the two pins share it rather than each building its own.

Worth plan's attention where a third judged tree is ever considered: adding a
tree to a scan's `trees` silently re-verdicts every tree already in it.

`tests/` is still unjudged and should stay so — 281 findings, its literals
naming internal helpers by design (entry's own measurement, unchanged here).

Detector confirmed on disk this tick: a literal naming `stateFileFor` appended
to `harness/cursorWindow.ts` reds the harness/ pin and leaves the src/ pin
green; reverted before commit.
