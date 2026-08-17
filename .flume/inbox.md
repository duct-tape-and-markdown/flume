# Inbox — findings queue

Transient queue of findings awaiting triage by the plan phase. Append-only by external reviewers; drained-only by plan.

## Who writes here

- Humans dropping observations to be routed.
- Future review skills (e.g. multidim-review, security-review) when added.

**Plan does not write here.** Plan-tick self-audit findings go directly to `.flume/plan/pending.json` (file as entry), to `.flume/plan/open-questions.md` (parked for human input), or live only in the `plan:` commit message body (narrative + dispositions).

## Who reads here

The plan phase reads inbox.md every tick and drains each entry into one of three outcomes:

1. **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant spec section).
2. **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
3. **Accept as debt** — note the disposition + one-line reason in the `plan:` commit message body.

After routing, the inbox entry is **removed**. The queue is meant to drain; it is not a log. Narrative history lives in git.

## Format

Each entry is a markdown subsection:

```
## YYYY-MM-DD — <short label> (<source>)

<finding body — observations, file:line cites, severity if known>
```

`<source>` is the writer (e.g. `human`, `multidim-review`). One subsection per finding cluster; group related items under one `##` to keep routing atomic.

---

<!-- entries below this line; newest first -->
## 2026-08-17 — `tick` accepts and silently ignores a positional phase argument (human, gh#1)

Reported v0.2.0, confirmed current-surface: `flume tick plan` with build awake runs build —
the positional is neither honored nor refused. `spec/cli.md` defines `tick` with no phase
argument and routes usage-shaped failures to exit 2 ("unknown command or job verb, a missing
`<phase>`…"), but a stray positional on `tick` is not in that refusal set. The silent
divergence from the operator's mental model ("I asked for plan, plan ran") is the defect;
either resolution (documented override or loud exit-2 refusal) closes it, and the refusal is
the smaller change. Sweep the other subcommands for the same hole while there: any verb that
ignores unexpected positionals shares it. Fix ships the test that fails pre-fix (`tick
<phase>` exiting 0 having run a different phase).

## 2026-08-17 — cherry-pick conflict parks gated-green work; issue asks for 3-way merge first (human, gh#3)

Reported v0.2.0 with cost data: two append-append conflicts, each discarding 800–1500s of
gated agent work (~$5–8). The recovery half is already answered by the durability contract
4/4 (verdict records each span's head sha; refused spans re-cherry-pickable, spec/loop.md
*The tick verdict*). The remaining fork is merge strategy: the contract deliberately keeps
plain `cherry-pick` conflict as the arbiter of content (spec/loop.md *Tip verify* — "let
git fail the merge"); the issue argues for a 3-way/ort retry (or rerere) before parking,
which would auto-land the append-append class. This is a design decision, not a mechanical
fix — a merge strategy the engine picks is the engine deciding content-compatibility
questions the afterMerge gates currently own. Likely an open question naming the fork:
plain-pick-then-park (current) vs. ort-retry-then-park (issue), with the issue's cost data
and the afterMerge-gates-own-semantics argument as the two sides. Issue's suggestion 3
(planner-declared overlap hints serializing entries across waves) is chain-side batching
policy, not engine.

## 2026-08-17 — intake gate for under-specified job specs, as a chain capability (human, gh#8)

Issue proposes rejecting/escalating thin job specs before task derivation (motivating
incident: one-line spec → keyhole read → ineffective fix → poisoned shared knowledge base).
As proposed it is convention-shaped: spec-completeness is semantic judgment over prose the
engine never reads. The boundary-clean shape, already posted back on the issue: a
chain-declared intake predicate/phase at job acceptance — engine supplies the refusal
mechanics and a provenance field on the job record (human-authored vs. agent-completed
spec), chain owns the bar. Wants a design pass against spec/jobs.md (where does an intake
phase sit relative to `job new`/seed/baseline) before anything is derivable; likely an open
question with the capability sketch attached.

## 2026-08-17 — self-upgrade livelock: entry ordering shipped refusal semantics before their claim-inheritance dependency (human+session, live derivation)

Observed live this run: `tip-verify-claim-arbitration` shipped mid-loop, so fresh tick
children (new code) began refusing merges on the live claim held by their own still-running
supervisor (old code, predating `FLUME_TIP_CLAIM_HELD`), reading parent as concurrent
engine. Guaranteed refusal per wave, full agent spend each — resolved by killing the stale
supervisor (claim released; the in-flight orphan tick's merge then absorbed and shipped
`shared-checkout-keep-reset`) and driving bare ticks to drain. Two findings for triage:
(1) plan's derivation ordered the refusal semantics before `tip-claim-per-run-scope`, the
entry that ships the mechanism making them safe under a live supervisor — a dependency
that only manifests when the engine upgrades itself under a running old supervisor; worth
asking whether pending's dependency surface can express "must ship with/after" for
same-derivation couplings, or whether this is a plan-prompt/PROTOCOL lesson. (2) the
general fact: under `flume loop`, tick children re-read HEAD's code while the supervisor
stays frozen at launch — any entry changing the supervisor↔child contract is unsafe to
ship under a live old supervisor. Candidate homes: spec/loop.md (a stated
supervisor-upgrade rule: the loop finishes the run on the contract it started with — e.g.
child pins, or supervisor self-restarts at a version fence), or accepted-operational-fact
(operator restarts the loop after contract-touching ships). Needs a design pass, not a
mechanical fix.
