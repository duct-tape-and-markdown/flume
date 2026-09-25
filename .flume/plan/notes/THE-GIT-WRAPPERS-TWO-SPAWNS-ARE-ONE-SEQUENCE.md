# The dialect now has one composer in src/, and a second one in harness/

`src/git.ts` spawns git at one site (`spawnGit`); `run` is that site plus
`trimEnd`, and `readFileAtRef`'s content leg takes `spawnGit` directly. The
options — cwd, `literalPathspecEnv()`, the 16 MiB cap — are composed once.

Two things the next plan tick may want.

**The harness still hand-spells the dialect.** `harness/gitRange.ts:95` spawns
its own git and re-spells `env: literalPathspecEnv()` and its own cap beside
it. It imports the composer for the *env* but not for the invocation, so the
engine's "one spelling, applied at the invocation" is one composer in `src/`
and one hand-copy in `harness/`. The pin this entry named is scoped to
`src/git.ts`, so that leg is unjudged. Candidate finding against
`engineering.md`, *A fact the engine holds is reported, never rediscovered*:
the window reader wants the engine's composed child options, not a second
spelling of them. Not filed here — it is outside this entry's `per` and its
fix is a surface decision (does `src/git.ts` export the options composer, or
does the reader go through a `src/` verb?).

**The pin's machinery is a second copy, watch for a third.** The structural
read in `tests/git.test.ts` (import-binding read, `promisify` alias fixed
point, identifier-callee-only rule) is the same shape as
`tests/helpers/spawnCaps.ts`'s per-module arms, judging a different option key
(`env` vs `maxBuffer`). Two copies, deliberately: spawnCaps' scans are
repo-wide with their own fixture suite, and generalizing them over an option
key would widen a helper whose whole doc is the cap. A third option-key read
is the condition that should move the walk into `tests/helpers/`
(`engineering.md`, *A module is one job*). Accepted debt, not a queue entry.

Unrelated: `tests/git.test.ts` was already prettier-dirty at HEAD (three
call-wrapping sites, none touched here); `src/git.ts` was clean and stays
clean.
