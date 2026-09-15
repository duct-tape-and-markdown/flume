# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## The release publish is hand-run, and `spec/cli.md` ratifies that (PARKED — needs a spec amendment)

Drained from the inbox (2026-09-08, human via flume-main). 0.14.0's publish
stalled a day on a dead token: CLAUDE.md named a key `.env` did not hold, the
key it did hold had expired in May, and `pnpm publish` ignored the env-var auth
form and read `~/.npmrc`, surfacing as a 404 on the PUT. Tag and commit were
already pushed, so the registry lagged the tag by a day.

**Not derivable as filed.** `spec/cli.md` *Versioning policy* currently states
"The version bump and `npm publish` are human-performed at cut time." A tagged
CI publish contradicts that line, so the line moves first.

Shape the finding proposes, carried here so the answering session need not
re-derive it — temper's `.github/workflows/release.yml`: `on: push: tags:
["v*"]`, publish with `secrets.NPM_TOKEN` through `setup-node`'s
`registry-url`, **idempotent** (skip when `npm view <pkg>@<version>` already
resolves), and a post-publish smoke that installs the published tarball from
the registry and runs the shim — `scripts/smoke-install.mjs` already does this
against a local pack; the job points it at the registry.

Two things are the operator's regardless of the ruling: setting the repo
secret, and whether release automation is wanted at all for a package whose
cut is deliberately hand-curated (changelog mining, `smoke:install`).
`.github/**` is already inside build's fence, so the work ships the moment the
spec line moves.

## `platform-facts.md` wants the two stat facts the denial primitive rests on (NEEDS AMENDMENT — a rule-page edit)

Drained from `.flume/plan/notes/DENIAL-IS-STRUCTURAL-NOT-A-PERMISSION-BIT.md`.
Two external facts were measured on the Windows lane while the structural
denial primitive landed, and both currently live only in a doc comment
(`tests/helpers/denial.ts`):

1. `statSync(path, { throwIfNoEntry: false })` returns `undefined` for
   **ENOTDIR as well as ENOENT** — re-measured on linux this tick:
   `statSync('<plain-file>/child', { throwIfNoEntry: false })` is `undefined`
   where `statSync` alone throws `ENOTDIR`.
2. win32 reports a path *through* a non-directory as not-found outright,
   rather than as not-a-directory.

CLAUDE.md puts these on `.claude/rules/platform-facts.md` by name — "a code
comment carrying one is a copy the harness should own instead, seen only by an
agent that already opened that file". That bites hardest for (1): it is now
the root of an engine defect (`EXISTSLOUD-REFUSES-AN-OBSTRUCTED-ANCESTOR`, ~25
existence gates), and an engine author touching those gates never opens a test
helper. (2) is what `MERGING-MARKERS-PROVE-ABSENCE-FROM-THE-PATH` exists for.

**Why this is parked rather than filed:** `.claude/rules/**` is outside build's
fence — the rule pages are the human's surface. No entry can ship it.

Recommendation: two short sections on the page, in the register of the
neighbouring *`chmod` denies nothing on win32* — say the behaviour, say what it
costs (an existence gate takes its absent arm over an unresolved path; an
obstructed store reads as "nothing written"), say the idiom (prove absence by
descending the path, never from an errno). The `tests/helpers/denial.ts`
comment then shrinks to a pointer, which the build tick that adopts the page
can do inside its own fence.

## A lane that wakes the tick and then renders unread (PARKED — needs a ruling, then a spec line)

Drained from `.flume/plan/notes/INBOX-SLICE-IS-LIVE-ON-A-RED-UNDRAINED-LANE.md`.

`spec/harness.md`, *CI lanes as a findings source* ends: "unread renders only
when the slice is live for another reason." The two legs read different
amounts of the forge, so that sentence can be false. Liveness
(`undrainedRedLane`) reads the run and the declared job's conclusion; the
render (`withMaterial`) additionally fetches the failing job's log and, by its
own declared rule, degrades the whole reading to `unread` when that fetch
fails. A forge that answers the first two questions and fails the third wakes
the tick *on that lane* and then tells it the lane is unread — so the tick
files nothing, stamps nothing, and is woken into the same state next tick. One
agent invocation per tick, for as long as the forge stays half-available.

Both halves are individually declared and defensible, which is why this is a
ruling rather than a defect:

- **(a) Keep the render as it is, amend the spec sentence.** Cheapest. Costs
  the operator legibility: the tick is woken for a reason its window denies,
  and nothing on the page says so.
- **(b) A failing lane whose log could not be fetched renders as failing —
  naming the run and saying the log was unavailable — and is not stampable.**
  The spec sentence stands unchanged, the livelock becomes visible and
  correct (the lane genuinely cannot be drained), and `CiLaneReading` gains a
  third shape.
- **(c) Liveness fetches the log too, so the two legs can never disagree.**
  Rejected on its face: `ci.ts` states that putting a multi-megabyte read on
  the selection path is what the status/reading split exists to avoid.

Recommended: **(b)**, with the mechanism being that the render is handed the
liveness verdict instead of re-deriving it — one forge read per lane per tick,
and the two legs cannot disagree by construction
(`.claude/rules/engineering.md`, *Derived state is computed, never restated
beside its source*). Either ruling moves a line in `spec/harness.md`, so it is
yours.
