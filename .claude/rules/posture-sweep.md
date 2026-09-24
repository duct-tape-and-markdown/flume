# Posture sweep

Administering the engineering postures. A posture page states a shape
standard; the sweep is what applies it to code that already exists. Without
it a newly-ratified phrase governs only code written after it.

Binds on plan's **Sweep** dimension.

## The pages are the authority as they read this tick

The sweep domain is `src/`, `harness/`, `tests/`, `bin/`, `examples/`, `scripts/`
(build surface that no typecheck reads, so the sweep is its only lens). The posture pages
are `.claude/rules/engineering.md` and `.claude/rules/engine-boundary.md`.

Every section of those pages, as written at this tick, is in scope. Nothing
is swept from a remembered list. A ratified phrase change applies from the
next rotation forward — it never reopens a stamped window.

## The frontier is decidable; the neighborhood is judged

Three delta kinds arm the sweep. The first two are read off `git log
--name-only` forward from the stamp — no file reads:

- A **code delta** puts the window's touched modules in the frontier.
- A **phrase delta** — the window touched a posture page itself — puts
  **every module across the sweep domain** in the frontier, because a changed
  phrase has been applied to nothing yet.
- A **retired-claim delta** — the window touched `spec/` — is read off the
  spec diff's *deleted* lines. A sentence the spec no longer states is a
  claim every doc comment, `docs/` page, and README section may still
  assert. For this delta alone the domain widens to `docs/` and `README.md`,
  and the frontier is every site a search for the deleted claim's key
  phrases turns up — a text search is the right tool here, because the
  finding is prose, not a symbol. No hits closes the delta in one tick.

Each tick sweeps at most **one neighborhood**: one frontier module read
together with its immediate imports. That is the context bound. Every
frontier module the neighborhood read is recorded **covered** in the plan state.

Covered is settled for the window. A later tick never re-sweeps or re-draws
it, even where fresh judgment would cut the boundary differently — the cursor
decides coverage, never re-derivation.

## The sweep runs beside build, never ahead of it

The sweep is its own worker: an armed or open rotation makes the slice live,
and it runs whenever the supervisor's budget has room, while build ships
beside it. Nothing about pickable work stops a neighborhood being swept, and
nothing about a sweep holds build — the entry claim and the ship lock are what
keep the two off each other (`spec/harness.md`, *The phases*). Declared phase
order is the tiebreak when the budget is short, and the sweep is declared last
among the plan slices for exactly this reason.

**Why:** the sweep is insurance; shipped entries are the product. Insurance
that costs the product nothing is scheduled; insurance scheduled ahead of the
product inverts the loop's economics.

## The rotation closes when the frontier empties

Untouched modules never enter the frontier, so a quiet tree closes in one
tick, never one tick per skip. **Quiet-on-clean is the normal verdict**,
recorded by advancing the stamp alone.

An armed or open rotation is a live plan job: the chain keeps the sweep
slice live while the plan state's rotation is open or commits
past the stamp touch the domain; when it runs is the budget's (above).
Hibernation is the empty frontier's verdict alone.

## A violation counts only when verified on disk this tick

Cited by symbol and line. A finding read off a remembered impression, a
commit message, or a prior tick's note does not count.

## Standing lenses

Beyond the pages' own sections, the sweep reads every neighborhood through
these. Each is a bulleted lead so a cite can name it.

- **A module carrying jobs that want separate homes** — the cohesion read
  `engineering.md`, *A module is one job* administers.
- **Dead plumbing** — unconstructable branches, vacuous result paths.
- **Embedded provider knowledge** — documented external facts (tool names,
  path layouts, payload shapes) as literals outside the surface that owns
  them.
- **Expired narration** — prose whose stated scope has closed or whose
  revisit condition has fired: a comment scoped to a shipped release line,
  an `interim` marker whose retiring change has landed, a "revisit when X"
  whose X is observable now. The sweep domain for this lens includes
  `.flume/chain.ts` and `.flume/PROTOCOL.md`, which carry decisions no
  other lens reads.
- **A negative assertion over a whole rendered artifact** — a `not.toMatch`
  or `not.toContain` whose subject is an entire rendered prompt, log, or
  verdict turns on whatever else that artifact happens to quote — a stack
  trace carrying the worktree path, and so the entry tag — rather than on
  the arm the case is about. Green by accident today, red for any tag
  spelling the forbidden phrase tomorrow. The assertion reads its own block.
- **A repo-relative path composed with `node:path`** — a value the engine
  reports in git's alphabet (`stateRootRel`, a pathspec, a name-only line)
  joined or resolved through the host's separator before it reaches git
  again. Correct on posix by accident, wrong on win32 silently; the fold
  belongs at the one reporter, never at the composer.
- **Consumer restatement** — the engine read from the consumer's side
  (`engineering.md`, *A fact the engine holds is reported*). The consumers
  this repo carries are `examples/` and `.flume/chain.ts`; a decorator
  parsing agent output, a constant mirroring a gate's command, a copied
  path rule, or a predicate inferring engine state from commit shape is
  filed against the engine surface that should have reported the fact.
  Downstream chains outside this repo are the interactive session's to
  read, and their findings enter through the inbox.
- **An absence verdict never rests on a bare text search** — proving a
  symbol is *un*referenced needs a search that resolves symbols — LSP
  references (`code-navigation.md`) — never a plain no-hits. A host without
  the instrument leaves the finding unmade and says so (`engineering.md`,
  *An export earns its consumer*).

## Routing

The filing bar is **correctness-adjacency**: a finding becomes a queue
entry only when the defect can change behavior, hide a failure, or leave a
vacuous verdict over load-bearing machinery.

- Correctness-adjacent, purely mechanical fix → a **pending entry**, `per`
  citing the owning section of the posture page.
- A cohesion finding — a module carrying a second job, a job with no file,
  a helper or vocabulary spelled three ways, a sequence copied across legs
  (`engineering.md`, *A module is one job*) → a **pending entry** naming the
  target shape, on that section's own terms.
- Pure shape — duplication, narration drift, style, a vacuity whose subject
  is not load-bearing → an **accepted-debt line in the plan commit body**.
  A later rotation re-noting the same debt is cheaper than a queue that
  grows faster than build drains it — until the re-note is itself the
  recurring cost. **A shape family accepted as debt in three plan commit
  bodies of one rotation is filed once**: a single entry `per` this section
  that claims no property (no `tests[]`, no `pins[]`), names every site in
  `files`, and ships in a wave of its own. The count is read off `git log`
  from the rotation's cursor, never estimated; below it, shape stays out of
  the queue.
- Needs a design decision → an **open question**, naming the section and the
  fork.

Never file against a divergence the site declares and cites as deliberate.

## The stamp

The plan state carries the sweep cursor. While a rotation is open the
frontier is re-derived each tick from that cursor against the live tip, so
a commit landing mid-rotation joins the frontier at the next tick rather than
waiting for the next rotation; a module already covered stays covered for the
rotation, whatever lands on it after. The rendered window names the tip it
was drawn from, and the tick that closes the rotation stamps exactly that
tip — never a sha it rediscovered itself. The cursor is **copied forward
verbatim** on every other plan tick.

The job re-arms when commits past the stamp touch the sweep domain or a
posture page.
