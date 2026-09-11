# Red-on-base is vacuous over a suite that hosts its own subject

Observed at 03b7368: SPEC-TEST-CITE-NEEDLE-ROOTLESS shipped the widened needle and reverted on `vitest: already pass on the base`. Red-on-base lays the merged bytes of each file holding a named test over the base tree. The needle is a const in `tests/retired-narration.test.ts`, the same file that carries its test, so the fix travels with the copy and the line can never be red. ORPHAN-ID-SINGLE-LINE-BLOCK edits `orphanedBlocks` in the same file: same verdict at 442017a.

The class: every scanner grammar in that suite (3284 lines, 18 describes, ~50 top-level consts and functions) lives beside its tests. A behavior change there is provable green, never red, and moving the line to `pins[]` ships the test unproven.

Fix at the mechanism, not the gate: extract the grammars (needles, resolvers, corpus readers) into `tests/helpers/` modules the suite imports, so the copy leaves the subject behind. A pure move, `pins[]` only. Then re-key both entries `blockedBy` it with `tests[]` intact; the re-key lifts the quarantine. Both build notes were reverted with their commits; this record is the diagnosis's only surviving trace.
