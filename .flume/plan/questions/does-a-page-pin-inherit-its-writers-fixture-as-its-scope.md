# Does a page-against-writer pin inherit its writer's fixture as its scope?

Off note THE-README-INIT-PIN-ADOPTS-INTO-A-REPO-WITH-A-COMMIT, item 1.

## What happened

`tests/harnessPackaging.test.ts:864` claims "the README adoption section
names every file `flume-harness init` writes". It drives the real producer
(`harnessInit`) through the real consumer (the README list) — exactly what
`engineering.md`, *A seam gate reads what the real writer wrote* asks for.
It was still green over a README missing two of the seven paths, because the
fixture adopted into a repository with **no commit**, so the producer
legitimately wrote a 5-path skeleton and the pin's "every file" was every
file *that fixture could produce*. The fix (shipped) moved both cases onto a
repository carrying a commit and asserted `planState.kind === "seeded"`
first.

The class: **a pin whose subject is a producer's whole output is bounded by
the input the fixture hands that producer, and the title never says so.**
`n > 0` does not catch it — the set was populated, just narrower than the
claim. The neighbouring case at `:910` was the only reason the gap was
visible at all.

Sibling shape, unswept: `docs/CLI.md`'s `flume-harness init` section already
named both plan-state files, because that page is judged per-arm against
measured facts rather than against a writer. So the exposure tracks *how a
page is pinned*, not what it says.

## The fork — where does this live, if anywhere?

1. **A bullet under `engineering.md`, *A seam gate reads what the real
   writer wrote*.** The section already rules "the real producer runs"; this
   adds "…over an input that can produce its whole output — a pin claiming a
   producer's full set asserts the fixture reached it." Closest to the
   defect: the seam was real, the input was not representative. Cost: one
   more clause on a section whose scope sentence is already carefully
   fenced.
2. **A bullet under `engineering.md`, *A green verdict is proven
   non-vacuous*.** Frames it as the vacuity bar's next rung — populated is
   not complete. Reads where someone already looks for false greens; but the
   section's whole vocabulary is `n > 0`, and a completeness bar is a
   different instrument wearing its name.
3. **A standing lens under `posture-sweep.md`, *Standing lenses*.** Makes it
   a thing the sweep reads for rather than a phrase build holds to. Catches
   existing pins, which (1) and (2) only reach through a phrase delta —
   which, being a phrase delta, arms the whole domain anyway. Cost: a lens
   that closes quiet on most neighborhoods.
4. **Nothing.** The case was caught, and the general form may not recur
   often enough to price a standing read.

I lean **(1)**: the defect is an input-representativeness defect on a seam
gate, and that is the section a reader reaches for. (3) is the only option
that reaches the pins already on the tree without a phrase delta, so (1)+(3)
together is coherent if the recurrence is judged real — but I would not file
both on one instance.

Not a plan entry either way: all four options edit a human-authored page.
