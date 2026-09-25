# The README was the only page the seeded half was missing from

Shipped: the two README list pins now read one `harnessInit` over a
repository carrying a commit (a `beforeAll` fixture), so `written` is the
7-path set a real adopter gets rather than the 5-path skeleton, and both
cases assert `planState.kind === "seeded"` before judging it — the fixture's
completeness was the thing nothing held.

Two observations for the next tick:

1. `docs/CLI.md`'s `flume-harness init` section already named
   `.flume/plan/state/plan-derive.json` and `plan-sweep.json`, sample
   transcript included. So the gap was README-only, and the reason is the
   shape of the pin: the CLI page is judged per-arm against measured facts,
   the README list against a writer whose fixture could not produce the
   files. A page pinned against a writer inherits that writer's fixture as
   its scope — worth a lens if the sweep wants one.

2. `tests/harnessPackaging.test.ts`, "the flume-harness bin adopts an empty
   repository against the published emit" still adopts into a bare mkdir and
   enumerates, by hand, "the artifacts *Adoption and upgrade* names". Plan
   state is not among them. Its subject is the shipped bin reaching disk
   through the emit, not the write set, so nothing is wrong today; but the
   comment claims the spec's set while the fixture cannot write half of it.
   Shape, not correctness — filed here rather than as an entry.

The fixture helper moved: `commitInto` left `tests/harnessInit.test.ts` for
`tests/helpers/scratchRepo.ts`, and `makeScratchRepo` now delegates to it —
one git sequence with two callers, rather than a second copy for the second
suite (`engineering.md`, *A module is one job*).
