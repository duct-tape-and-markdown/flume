# The declaration's lane comment still claims a refusal nobody ships

`.flume/declaration.ts` (the `runner:` block, ~line 63) says the integration
lane's exclusion means "a named line homed there is refused at plan time
rather than reverted after a wave". No such refusal exists, and this entry is
the decision that none will: the cited spec section says the exclusions
**inform** authorship, since an entry's `files` is a prediction build is not
held to. The package-side copies of that claim are retired in this commit
(`harness/runner.ts`, `harness/vitestRunner.ts`); the declaration's is not —
`.flume/declaration.ts` is outside every phase's fence, so no build tick can
reach it. Expired narration whose only editor is an interactive session:
route it to a human, not to an entry.

Observed while wiring it: `Runner.lanes` had shipped with no reader at all,
so nothing downstream ever consumed the exclusions this repo has been
declaring.
