# namespacedJoin's assertions were vacuous on every platform, not just POSIX

Shipped as written. One refinement to the entry's premise: the four
assertions were not merely identities *on linux* — each spelled
`namespacedJoin(x) === toNamespacedPath(join(x))`, which is src/paths.ts's
function body verbatim. They were tautologies on win32 too, so no runner
could ever have turned them red. The retirement is unchanged, but a future
sweep reading the old rationale would find the linux framing narrower than
the defect.

Adjacent, not filed: tests/git.test.ts:869 carries a similar
"toNamespacedPath is identity on POSIX" comment, but that assertion compares
a mock call *argument* against the wrapper, not the wrapper against itself —
it still pins which path the fallback's `rm` ran on, and goes red if the
fallback targets a different one. Different class; left alone. Worth a glance
if a rotation sweeps tests/git.test.ts under this lens.
