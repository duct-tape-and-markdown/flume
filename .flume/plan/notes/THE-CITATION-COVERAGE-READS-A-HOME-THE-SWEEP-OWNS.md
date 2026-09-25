# The slice toggle is green across the whole suite, and two tree domains still stand outside the declaration

Shipped: `declaredSweepTrees` moved to `tests/helpers/commentCitations.ts`
taking the slices declaration, folding an absent sweep to `[]` rather than
throwing; the coverage pin's vacuity guard now ties its subject size to
`declaration.slices.sweep?.domain.length ?? 0` instead of `> 0`, so it stands
under either toggle; `tests/chain.test.ts` derives its phase list from
`PLAN_SLICES.filter(enabled)`.

Measured, not assumed: with `.flume/declaration.ts` edited to
`enabled: ["plan-inbox", "plan-derive"]` and the `sweep` block dropped (the
dead-declaration rule forces the drop), `pnpm tsc --noEmit` and the full
vitest lane are green — 72 files, 1963 passing. Nothing beyond the three
files this entry touched reads the sweep slice as required. Restored before
committing.

Debt observed, not filed. Two repo tree domains are spelled by hand and read
no declaration:

- `PAGE_ARM_DOMAIN` (`tests/commentCitations.test.ts`) — `bin`, `examples`,
  `scripts`, plus `.flume/chain.ts`.
- `REPO_DOMAIN` (`tests/helpers/spawnCaps.ts`) — `bin`, `examples`,
  `harness`, `scripts`, `src`, plus both `.flume/` chain files.

They overlap, they differ, and both restate part of what `slices.sweep.domain`
declares. The coverage pin is what keeps the first from drifting off the
declared domain; the second has no such tie. Neither is correctness-adjacent
today — a drift reds the coverage pin rather than passing quietly — so this is
a shape note, one of a family worth counting rather than filing on sight.

Cohesion caveat on the fix: `declaredSweepTrees` now sits in the citation-scan
helper while reading `DeclarationInput["slices"]`, which is the first harness
import that file takes. That is the coverage pin's own fold, so the home reads
right, but if a second reader of the sweep domain appears in `tests/` the job
wants a file of its own rather than a second callsite here.
