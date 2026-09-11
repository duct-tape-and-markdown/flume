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

## 2026-09-11 — build's handoff and the inbox slice's liveness disagree on what a refusal is (human)

Observed in the 2026-09-11 loop. LOG-TAGLESS-SPAN-ROW ended its wave with
`mergeOutcomes[].outcome: "cherry-pick-conflict"`. `build.handoff`
(`.flume/chain.ts` ~742) reads that entry as refused — `committed &&
!shipped && !reverted` — and wakes `plan-inbox`. `plan-inbox.shouldRun`
(`reconcileDue`, ~518) reads the same verdict and counts only
`"not-shipped"` and a voluntary-bail record, so it declined. One tick spent
to do nothing, and the comment above `refused` ("a refusal only plan can
resolve") is false for a conflict: a conflict is retried by the next wave
from the new base, nothing for plan to reconcile. Two predicates deriving
"did build refuse" from different facts (`engineering.md`, *Derived state
is computed, never restated*). One predicate, over the verdict, used by
both; and `cherry-pick-conflict` is not in it.

## 2026-09-11 — open-questions.md is a shared write surface across a fanout wave (human)

Same wave. The three entries' code footprints were disjoint, which is what
let them fan out together. Two of the three agents also appended to
`.flume/plan/open-questions.md` (the cross-tick scratch file
`collaboration.md` tells them to use). The second cherry-pick conflicted on
that file alone, and a correct code change for LOG-TAGLESS-SPAN-ROW lost
its merge to a prose collision. Any wave wider than one has this exposure,
and the `files` fence cannot see it because the file is outside every
entry's declaration. Options: build's fanout writable set excludes the
scratch file and an observation rides the build commit body, where plan
already reads git; a per-entry notes path (`plan/notes/<tag>.md`) that
plan-inbox drains and deletes; or the ship step merges the prose file
append-wise. The first is the smallest. Decision is chain/protocol, not
engine.

## 2026-09-10 — a named behavior is proven by a test that also passes on the base (human)

The vitest gate (`.flume/chain.ts` `vitestOnCode` → `.flume/vitestJudge.ts`
`judgeVitestReport`) judges each `tests[]` line by finding a passing test
whose title includes it. It never asks whether that test *fails* on the
span base. A build that titles an existing green test with the line, or
writes a test that is green before its fix, passes the gate having proven
nothing — the false-green `engineering.md` *A fix ships the test that would
have caught it* exists to close.

The gate has `ctx.baseSha` and `ctx.entry` (both engine-reported). What it
lacks is a way to run the named tests at the base: a throwaway worktree at
`baseSha` with dependencies resolvable, or the engine surface that provides
one. Whether that is a chain concern (the gate provisions its own worktree
through `api`) or a missing engine surface is the routing question.
Severity: correctness-adjacent — the acceptance gate is the review now.

## 2026-09-10 — the chain re-reads the queue at a sha the engine already read (human)

`.flume/chain.ts` `perResolvesGate` reads `pending.json` at `ctx.commitSha`
through `api.git.readFileAtRef` (chain.ts ~299). `src/builtinGates.ts`
`pendingGate` performs the same read (~390) for the same commit. Two readers
of one fact; the chain's copy is consumer restatement (`engineering.md`, *A
fact the engine holds is reported*). The queue as of the gated commit —
parsed entries, or the bytes — belongs on `GateContext`, and the chain's
read goes in the adopting commit.

## 2026-09-10 — the loop spec and the dispatcher disagree on what a singleton decline costs (human)

`spec/loop.md` *Declining a tick before the invocation*: "A singleton
decline costs a `rev-parse` and the pending read, nothing else."
`src/Dispatcher.ts` `runSingleton` provisions the worktree and runs
`setupWorktree` (dependency install included, ~1845) before consulting
`shouldRun` (~1904). Every declined plan slice today paid a worktree and an
install. One of the two is the defect: either `shouldRun` moves ahead of
provisioning (its `ctx.cwd` would then be the repo root, which the spec
would need to say), or the spec sentence is corrected to state the real
cost. The first is an engine change; the second is a human spec edit.
Route accordingly.

## 2026-09-10 — the runtime ignore list reaches the default state root only through the repo's own .gitignore (human)

The engine writes `RUNTIME_IGNORES` into a `.gitignore` under a job's state
root (`src/job.ts`), but for the default `.flume/` root the repo's committed
`.gitignore` has to carry each runtime directory by hand —
`.flume/rendered-prompts/` was added that way this week. A downstream repo
that adopts flume and forgets one line commits tick artifacts. Options: the
engine writes `.git/info/exclude` entries for its runtime dirs at the default
root; or `flume init` writes them into `.gitignore` once; or the spec states
that the default root's ignores are the repo's responsibility and the
pending gate refuses a commit that adds a runtime path. Needs a decision on
which layer owns it — park if unclear.

## 2026-09-10 — the shipped examples trail the reference chain's shape (human)

`examples/{minimal,cascade,backlog-groomer}-chain.ts` and
`examples/prompts/*` are what a newcomer receives from npm (`package.json`
`files`). They load and run one tick cycle under
`tests/examples.integration.test.ts`, so they are not broken — but none
shows a plan split into slices with `shouldRun` computed from disk, a
dependency-ordered handoff ladder, `tests[]` lines judged by a reporter-fed
gate, or `GateContext.entry`/`baseSha` in use. The chain that demonstrates
those is `.flume/chain.ts`, which does not ship. Either `examples/` gains a
chain that carries the current shape (kept honest by the same integration
test), or `docs/CHAIN-AUTHORING.md` points at `.flume/chain.ts` as the
reference and says the examples are deliberately minimal. The second is
cheaper; the first is what a user would want. Decision needed on which.

