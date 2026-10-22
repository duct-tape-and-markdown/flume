# What the suite is has three homes, and the run reads none of the one that shapes plan (downstream consumer report, class)

**Kind.** One fact about a consumer — which tests the running lane runs — is
stated in three places that never meet: the runner's `lanes` (rendered into
plan's `tests[]`/`pins[]` hints), the runner's `invoke` (what actually
runs), and the consumer's own test script. Plan is told one suite; the judge
runs another. `engineering.md`, *Derived state is computed, never restated
beside its source*.

**Members.**
- Field instance: the merged-tree run executed every vitest project,
  including `db` and `toolchain` that the consumer's `pnpm test` excludes;
  one merge 16 min, a toolchain case peaking ~11 GB. The consumer read this
  as "the runner can't be narrowed"; `invoke` can add `--project`, but
  nothing connects it to the lane the hints were rendered from.
- The ask "narrow `run` to `tests[]` and take a separate regression command"
  is not filed: the whole-suite merged run is the regression half of the
  judge by design (`spec/harness.md`, *The judges*), and a second command
  would be a fourth home for the same fact.
- Spec wording open: `run(names, cwd)` "run the tests whose full names
  contain each of `names`" reads as a narrowed run; the shipped runner runs
  the whole suite and reports per name. One of them is the defect.

**Owning artifact.** The lane declaration: a lane states what it runs, and
both the hints and the run derive from it, so they cannot disagree.

**Decision for the human.** Whether a lane carries its selection (args or
projects) as the one home, and the `run` spec sentence's intended reading.
