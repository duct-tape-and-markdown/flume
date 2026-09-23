# base-red ships; two adjacent gaps stay open

Shipped as ruled (option 2): `JudgeRequest.footprint`, outcome `base-red`,
`JudgeVerdict.ownFailingFiles` + `baseFailures`, and `verdict: "base-red"` on
the gate refusal. `src/` untouched.

Three things the next plan tick should see.

1. **`spec/harness.md`, *The judges* now understates the judge.** That section
   says only "`tests[]` green on the merged tree and red on the base". It does
   not mention that a red merged suite is re-run at the base, nor the
   `base-red` verdict a refusal carries. Not a build tick's to fix, but it is a
   sentence the section is missing.

2. **The overlay-is-a-no-op premise is still prose.** The ruling rests on
   `runAtBase`'s overlay being harmless for a file the span never touched.
   What the suite now pins over real vitest is the *call shape* — a base run
   asked about no named line at all, one file selection, failures read off it
   (`tests/harnessRunner.test.ts`). The premise itself is pinned only over the
   stand-in runner, because a real-vitest base-red arm needs a fixture whose
   merged suite is red, and that fixture's every other case asserts green. A
   second fixture in that file is the fix if plan wants the agreement arm.

3. **`suspectFlake` and `base-red` now read the same fact two ways.** The
   engine derives `suspectFlake` from `failingFiles`-vs-footprint
   disjointness; a base-red refusal is by construction disjoint, so both fire
   together on every base-red. The question file
   (`gate-revert-attribution-over-a-red-base.md`) already asks whether the
   inference retires with the declared field; this commit makes the overlap
   live rather than hypothetical.

Also: a red suite the span *did* cause in a file it never declared now reads
`suite-failed` with "green at <sha>" in the message — a third arm the prior
code could not distinguish, pinned in `tests/harnessJudge.test.ts`.
