# The wave width's third half is still unguarded, on the public API

1. The refusal is now one predicate — `assertPositiveCount` and
   `WAVE_WIDTH_FLOOR_REASON` (`src/counted.ts`) — called by the chain load and
   by the dispatcher's constructor. The load held the only copy; a second one
   beside it is the re-derivation `engineering.md`, *The fix lands at the
   mechanism* fences.

2. `partitionByFileOverlap` (`src/partition.ts`) is the third surface carrying
   this width, and it ships on the public surface (`src/index.ts`, and the
   chain API a consumer's `order` hook calls). A `maxParallel` of zero refuses
   nothing there: `batch.entries.length >= opts.maxParallel` is always true, so
   every entry opens its own batch and the helper hands back a full
   serialization of a queue the chain asked to partition four wide — the same
   silent degradation this entry closed one rung up, and now the only
   unguarded half. Candidate entry under the same `per`.

3. The pin title landed as a **rename** of the existing case "a chain
   declaring nothing gets maxParallel: 4" (`tests/Dispatcher.test.ts`), not as
   a new case: that one already drives five disjoint entries with no chain
   `supervisorPolicy` and no `DispatcherOptions.maxParallel` and asserts a peak
   of four, so a second copy would have been the duplicated sequence
   `engineering.md`, *A module is one job* names. So the pin gains a title
   rather than a check. Both `tests[]` lines are new, and red on the pre-fix
   tree — verified by removing the constructor's assert and re-running them.
