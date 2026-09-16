# The tree-wide fixture-root pass is 150 sites, and wants a pin not a sweep

Shipped: `onDiskIdentity` answers `{ identity, unresolved? }`, the junction
case compares records (`toEqual`), and its one root folds via the existing
`mkTempDir`. The windows junction red now prints what `realpathSync.native`
threw beside both spellings.

For EVERY-FIXTURE-ROOT-FOLDS-AT-ITS-MAKER: `mkdtemp(join(tmpdir()` is 150
sites across 34 test files. Converting each by hand is a wave of churn that
nothing holds afterwards — the next test written goes back to bare
`mkdtemp`. `tests/fixtureRoots.test.ts` pins the seam property over one
self-planted link, not the idiom tree-wide. Cheaper shape: a suite scanning
`tests/**` for `mkdtemp` outside `tests/helpers/subprocess.ts`, plus the
conversions it forces. Two exemptions to spell rather than discover:
`mkTempDir`'s own body, and cases whose subject is an unfolded spelling.

Unswept, not filed: `src/` carries 25 further bare `catch {}` legs (grep
`catch {`). Which of those proceed over an unresolved input, and which are
inert probes whose failure is the answer, is a judgment per site that this
entry's scope did not cover.
