# Posture sweep

Administering the engineering postures. A posture page states a shape
standard; the sweep is what applies it to code that already exists. Without
it a newly-ratified phrase governs only code written after it.

Binds on plan's **Sweep** dimension.

## The pages are the authority as they read this tick

The sweep domain is `src/`, `tests/`, `bin/`, `examples/`. The posture pages
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
frontier module the neighborhood read is recorded **covered** in state.md.

Covered is settled for the window. A later tick never re-sweeps or re-draws
it, even where fresh judgment would cut the boundary differently — the cursor
decides coverage, never re-derivation.

## The sweep yields to pickable work

An open rotation never holds the baton. While `<pending-now>` carries a
pickable entry, plan hands off to build and sweeps nothing — the frontier
and cursor persist untouched in state.md, and coverage is deferred, never
lost. A neighborhood is swept only on a tick where nothing is pickable.

**Why:** the sweep is insurance; shipped entries are the product. Insurance
scheduled ahead of the product inverts the loop's economics.

## The rotation closes when the frontier empties

Untouched modules never enter the frontier, so a quiet tree closes in one
tick, never one tick per skip. **Quiet-on-clean is the normal verdict**,
recorded by advancing the stamp alone.

An armed or open rotation is a live plan job: it carries `Plan continues:
yes` on ticks where it may advance (queue drained, above), and rides
silently in state.md otherwise. Hibernation is the empty frontier's verdict
alone.

## A violation counts only when verified on disk this tick

Cited by symbol and line. A finding read off a remembered impression, a
commit message, or a prior tick's note does not count.

Beyond the pages' own sections, standing sweep lenses: a module carrying jobs
that want separate homes; dead plumbing (unconstructable branches, vacuous
result paths); embedded provider knowledge (documented external facts — tool
names, path layouts, payload shapes — as literals outside the surface that
owns them); and **expired narration** — prose whose stated scope has closed
or whose revisit condition has fired: a comment scoped to a shipped release
line, an `interim` marker whose retiring change has landed, a "revisit when
X" whose X is observable now. The sweep domain for this lens includes
`.flume/chain.ts` and `.flume/PROTOCOL.md`, which carry decisions no other
lens reads.

A further lens reads the engine from the consumer's side: **consumer
restatement** (`engineering.md`, *A fact the engine holds is reported*). The
consumers this repo carries are `examples/` and `.flume/chain.ts`; a
decorator parsing agent output, a constant mirroring a gate's command, a
copied path rule, or a predicate inferring engine state from commit shape is
filed against the engine surface that should have reported the fact.
Downstream chains outside this repo are the interactive session's to read,
and their findings enter through the inbox.

An **absence verdict never rests on a bare text search**: proving a symbol is
*un*referenced needs LSP references (`code-navigation.md`), never a plain
no-hits.

## Routing

The filing bar is **correctness-adjacency**: a finding becomes a queue
entry only when the defect can change behavior, hide a failure, or leave a
vacuous verdict over load-bearing machinery.

- Correctness-adjacent, purely mechanical fix → a **pending entry**, `per`
  citing the owning section of the posture page.
- Pure shape — duplication, narration drift, style, a vacuity whose subject
  is not load-bearing → an **accepted-debt line in the plan commit body**,
  never an entry. A later rotation re-noting the same debt is cheaper than
  a queue that grows faster than build drains it.
- Needs a design decision → an **open question**, naming the section and the
  fork.

Never file against a divergence the site declares and cites as deliberate.

## The stamp

State.md carries `Posture swept through: <sha>` — the sha the frontier was
derived from, never a HEAD that moved mid-rotation. It is **copied forward
verbatim** on every plan tick and advanced only when a rotation closes.

The job re-arms when commits past the stamp touch the sweep domain or a
posture page.
