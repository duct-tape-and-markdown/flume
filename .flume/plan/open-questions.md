# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Does `.flume/declaration.ts` annotate `DeclarationInput`?

**Status: NEEDS AMENDMENT** — a `.flume/` edit, outside every autonomous
phase's fence. `spec/harness.md`, *What a consumer declares*.

Raised by build's note on A-DECLARED-COMMAND-GATE-NAMES-ITS-SHELL, verified
on disk: `.flume/declaration.ts` annotates `Declaration` — the parse's
*output* side — so a schema field carrying `.default()` becomes **required**
in that file the moment it lands. `shell` therefore shipped as `.optional()`
with `DEFAULT_SHELL` folded in once at `constructGate`
(`harness/declaredGates.ts`), not as the `.default("sh")` the spec row reads
like. Every future defaulted field inherits the same constraint: build cannot
add one without breaking this repo's own declaration, and build cannot fix
this repo's own declaration.

`DeclarationInput` exists for exactly this and documents itself as the
annotation a consumer writes. This repo — the package's reference consumer —
does not use it.

**Options.**

- **(a) Annotate `DeclarationInput`.** One line in `.flume/declaration.ts`.
  The reference consumer then exercises the surface every other consumer is
  told to use, and a defaulted field becomes a shape build can add.
- **(b) Keep `Declaration`, and rule that a schema default is never a shape
  build may add.** Costs nothing today and turns every future default into
  the fold-at-the-consumer pattern `shell` took — a mechanism spelled at each
  site instead of once at the schema.

**Recommended: (a).** It is the annotation the type was written for, and the
dogfooding argument runs the same direction: a surface this repo does not use
is a surface nothing proves. The edit is the human's; plan's fence stops at
the plan artifacts and build's at `src/`, `harness/`, `tests/` and the docs.

## Do flume's own CI lanes declare a `titles` reader?

**Status: NEEDS AMENDMENT** — a `.flume/declaration.ts` edit, outside every
autonomous phase's fence. `spec/harness.md`, *CI lanes as a findings source*.

Raised by build's note on A-LANE-STAMP-CARRIES-THE-FAILING-TITLES-IT-WOKE-ON,
verified on disk: the lane stamp now carries `{ run, titles }` and a lane's
wake compares the failing titles its declared reader reports against the set
stamped for it — but `.flume/declaration.ts` declares `windows` and `posix`
with `name`, `workflow` and `job` only. With no reader, every stamp is
`titles: []` and a lane that stays red at a *new* run wakes the inbox slice
again with nothing new in it. The feature the last wave shipped is
unexercised in its own reference consumer.

The grammar is not in doubt. vitest prints one line per failing case as
`` FAIL  <file> > <title>``, so the reader is a pattern over the shed log —
roughly `/^\s*FAIL\s+\S+ > (.+)$/gm`, the capture being the title. This tick's
run is the illustration: three titles, all three already fixed at the tip, and
nothing about the run identity said so.

**Options.**

- **(a) Declare the pattern on both lanes.** A red that persists unchanged
  stops re-waking; a red that gains a title wakes once for that title. Costs
  one field per lane and makes flume's own lanes exercise the surface every
  consumer is pointed at.
- **(b) Declare it on `windows` alone.** `posix` carries the integration lane
  and the publish-acceptance steps, whose failures are not vitest titles, so
  a vitest pattern there reads nothing and the lane keeps waking per run —
  which is the honest behavior for a lane whose failures have no title
  grammar.
- **(c) Leave both undeclared.** Every failing run wakes the slice once. That
  is today's behavior and it is not wrong, only noisier; the cost lands on
  ticks, not correctness.

**Recommended: (b).** The win32 lane is the one whose reds recur across ticks
while a fix is in flight, and it is pure vitest. Declaring a vitest pattern on
`posix`, whose job also runs steps that fail without printing a title, would
stamp an empty title set over a real red and read as "already drained".

## Does `platform-facts.md` carry *win32 spawns no shebang script*?

**Status: NEEDS AMENDMENT** — a `.claude/rules/` edit, inside the spec locus
but outside build's fence and plan's writable paths.

Raised by build's note on THE-DECLARED-SHELL-CASES-DECLARE-THE-HOST-THEY-NEED.
Verified on disk: `platform-facts.md` has `## chmod denies nothing on win32`,
which covers the exec-bit half alone. The other half — no win32 loader reads a
`#!` line, and libuv resolves an extensionless target by appending `.exe` — is
load-bearing at four sites and homed at none. Each states it in its own words:

- `tests/helpers/host-declarations.json`, the two rows f2818fbd added for the
  declared-shell cases (each citing the *chmod* section for the bit, then
  restating the shebang fact itself);
- the same ledger's `tests/bin.test.ts::bin/flume symlink walk` row;
- its `tests/harnessRunner.test.ts::resolves a command carrying a path
  separator against the tree it runs in` row.

That is the shape CLAUDE.md sends to this page: an external fact no test pins
and no type holds, copied at each site that leans on it. The next fixture
reaching for a shebang recorder will restate it a fifth time or, worse, reach
for a `.cmd` recorder and move its assertions onto cmd.exe's re-parse.

**Recommended: add the section**, beside the `chmod` one, so the ledger rows
shrink to a cite. Roughly: *a shebang script is not an executable form on
win32 — no loader reads the `#!` line, and libuv resolves an extensionless
spawn target by appending `.exe` — so a case whose subject is the spawn of a
fixture-authored script declares posix; a `.cmd` substitute is a different
subject, since cmd.exe re-parses the argv.* No fork here — the fork would be
whether to keep restating it, and that is the defect.
