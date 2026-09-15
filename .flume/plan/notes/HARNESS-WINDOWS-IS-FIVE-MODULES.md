# windows.ts split into seven homes, not five

The entry named five new modules; the split needed seven. `windows.ts` cannot
hold the shared vocabulary *and* import the three window modules — that is the
cycle *A module is one job* names — so `sliceWindow.ts` takes the vocabulary
(`TickFacts`, `WindowContext`, `PlanSliceWindow`, `SLICE_DATA_KEYS`, the
budget) and `cursorWindow.ts` takes the derive/sweep body the entry called
`cursorWindow`. `windows.ts` is 62 lines of assembly.

`tests/harnessCi.test.ts` drives `laneLeg` throughout, bar one case titled as
the wiring it pins: the inbox window's `CI_LANES` arg is the lane leg's own
render. Nothing else held that seam for a populated lane — the no-lanes arm
alone sits in `tests/harnessWindows.test.ts`.

Nine comment citations naming `harness/windows.ts` for a fact that moved were
re-homed (`src/git.ts`, `harness/gates.ts`, `harness/handoff.ts`,
`harness/ci.ts`, `harness/prompts.ts`). The citation scan resolves a path, not
a claim, so a stale pointer at a file that still exists reds nothing — worth a
sweep lens.
