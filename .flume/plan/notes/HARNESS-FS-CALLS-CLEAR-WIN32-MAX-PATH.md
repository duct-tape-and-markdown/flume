# The harness fs surface was wider than the filed count, and src/ spells the idiom differently

Filed: 4 bare calls (planState x3, prompts x1). The tree-wide scan found 11
bare path arguments across 5 modules — also gates.ts:141, init.ts:349, and
vitestRunner.ts:95/272/292/293, whose copy into a `checkoutAt` worktree is
the deepest path the package builds. All fixed. `copyFile` takes a path in
argument 1 too, so 293 counted twice; the scan carries that family
(`SECOND_PATH_ARG`, tests/helpers/namespacedFsScan.ts).

Pointing the same lens at `src/` is the obvious next rotation, but needs a
rule decision first: `src/` mostly spells the idiom as
`toNamespacedPath(<already-joined>)` (git.ts, priorAttempts.ts,
worktrees.ts), which the scan reds as written — it demands the shared
`namespacedJoin`, per the fact's own instruction. Beyond that spelling,
these look genuinely bare and are unverified: Agent.ts:416/418,
Prompt.ts:496, builtinGates.ts:359, cli.ts:543/1149, job.ts:167/177,
selfPackage.ts:47/73.
