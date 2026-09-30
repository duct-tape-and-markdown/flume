# withPlatform is spelled four ways, and its one home is named for something else

The pin landed as written: a cross-lane `describe` in `tests/git.test.ts`
driving `pinLongPaths` with `process.platform` swapped to win32, over a temp
dir outside any working tree. `src/git.ts` untouched; verified directional by
replacing the `throw err` at `:417` with `return undefined` — the case then
reds naming `git config core.longpaths true`, the write's argv, instead of
the probe's.

Two things for the next rotation.

1. `withPlatform` has four spellings: hand-rolled in `tests/spawnShim.test.ts`
   and `tests/setupWorktree.test.ts`, and exported from
   `tests/helpers/fakeAgentChild.ts`, which `tests/claudeCode.test.ts` and now
   `tests/git.test.ts` import. I reused the export rather than adding a fifth,
   but the home is wrong twice over: that module's header declares its job as
   "the spawned child every provider case drives", and a git test reaching
   into a fake-agent-child module for a host swap reads as an accident.
   `engineering.md`, *A module is one job* — a helper spelled in three modules
   has one home. Target shape: the host swap (async and sync arms both) in its
   own helper, the two hand-rolled copies deleted, `fakeAgentChild.ts` left
   holding only the child.

2. The case measures `git config --local --get`'s exit outside a working tree
   in its own body (asserting it is neither 0 nor 1) rather than citing a
   platform fact, because no section of `platform-facts.md` states it and a
   build tick cannot add one. If that number is worth owning — it is the
   boundary the whole rethrow arm turns on — it wants a section, and the
   case's two `not.toBe` lines shrink to a cite.
