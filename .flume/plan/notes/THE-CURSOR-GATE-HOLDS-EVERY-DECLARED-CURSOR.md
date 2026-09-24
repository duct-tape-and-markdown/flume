# The cursor gate is renamed, which is consumer-visible

`derive cursor` -> `plan cursors` in `harness/gates.ts`. A gate name reaches a
consumer through tick verdicts, exit logs and the `<harness>` block a prompt
renders, so this is a surface rename, not an internal one. Two roll calls moved
with it (`tests/harnessChain.test.ts`, `docs/CHAIN-AUTHORING.md`); the
`docs/CHAIN-AUTHORING.md` pin caught the page automatically, so nothing else in
the tree names it. `CHANGELOG.md:219` names the old spelling in a shipped 0.x
entry and was left alone as history — the release cut wants a line saying the
gate renamed and widened.

Two things the sweep may want, neither filed:

1. The gate holds each cursor's **value** and nothing else about the artifact
   it rode in on. Sweep's state carries `rotation.covered` beside
   `sweptThrough`, and a tick that advances the cursor while leaving a covered
   set describing a frontier nobody drew is still green here. That is
   judgement (which modules were read), not direction or reachability, so it
   stays in the slice's prompt — but the pairing is stated in
   `planState.ts`'s `SweepStateSchema` doc as if one fact in two halves, and
   only one half is gated.

2. `CURSOR_FIELDS` is `Object.keys(CURSORS)`, so a fourth slice's cursor joins
   the gate with no edit here. The cost scales with it: each moved cursor is
   two at-ref reads plus up to two `isAncestor` spawns, and the gate already
   trails the set for being the one that spawns git. Two cursors moved in one
   commit is four spawns worst case. Fine today; worth a look if a slice adds
   a third.
