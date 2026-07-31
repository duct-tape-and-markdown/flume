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

## 2026-07-31 — `.flume/last-tick.json` is a tracked-by-default runtime artifact (human, operator pass)

Trivial, routed rather than patched because `.gitignore` is build's lane.
The v0.7 §4 per-tick shipped/errored record writes to
`.flume/last-tick.json`, which no `.gitignore` pattern covers — its
siblings (`awake/`, `sessions/`, `prior-attempts/`, `worktrees/`) all
are. Every tick therefore leaves an untracked file in the tree.
One-line fix. Check `.flume/loop-*.log` at the same time.

## 2026-07-31 — win32 inline-exec fails on NON-ASCII, not on quoting (carto repro; SUPERSEDES the single-quote entry) (human, downstream crawl)

**Corrects the prior entry in this queue, which named single quotes and
was wrong.** Root cause isolated by controlled repro, then reproduced
here against HEAD in flume's own harness.

`execFile("sh", ["-c", cmd])` on win32 mangles any NON-ASCII byte in the
argv round-trip (`\200\224` observed for U+2014), so bash receives the
entire command as a program name and the span renders `<exec-failed>`.
Quoting is innocent: single quotes, double quotes, `$(...)` and
pipelines all pass with ASCII-only content, and fail with non-ASCII in
any of them. The minimal pair is one em dash.

Confirmed in this repo, not just downstream: `.flume/prompts/plan.md`
carried em dashes in exactly two inline-exec spans (`<last-plan>`,
`<spec-delta>`) and both rendered `<exec-failed>` on every Windows plan
tick, while the adjacent ASCII spans in the same file rendered
normally. ASCII-sweeping the two spans restored a fully-sighted render.
The bay-side evidence matches shape-for-shape: platform's plan.md had
three single-quoted blocks but exactly two non-ASCII ones, matching its
two observed failures — the quoting diagnosis explains one bay, the
non-ASCII one explains both.

`58be15d`'s fallback does not help and was built against the wrong
model: it retries only on win32 ENOENT, and this is not an ENOENT —
`sh` is found and runs, with mangled input.

Engine fix candidates: encode the win32 spawn argv correctly (UTF-8
codepage handling); pass the command via stdin or a temp script file
instead of argv; or — least — lint inline-exec for non-ASCII at render
and fail loud. **A fix here ships the repro as a test** (engineering.md,
"A fix ships the test that would have caught it"): the em-dash pair is
already reduced to a one-line case.

Harness-side mitigation is already applied in this repo (prompts
ASCII-swept, `.flume/PROTOCOL.md` "Inline-exec commands are ASCII-only",
marked interim and retiring on this engine fix). Severity: high — plan
orients blind on Windows, silently.

## 2026-07-31 — `<exec-failed>` renders and the prompt still sends: a specified silent degradation (human, operator pass)

Needs a **human/spec ruling before any code moves** — this is a
deliberate design affordance, not a slipped bug, and reversing it
deletes shipped tests.

`evaluateInlineExec` substitutes `<exec-failed cmd="...">stderr</exec-failed>`
for a failed span and the tick proceeds; `docs/CHAIN-AUTHORING.md` states
it outright ("the prompt still sends") and `tests/Prompt.test.ts` asserts
the degraded marker as correct behavior. The consequence, now measured:
a Windows plan tick oriented on a blinded digest for the life of a loop
with nothing surfacing it — the failure is invisible because the
rendered prompt looks well-formed.

This is the one place flume's shipped behavior contradicts
`.claude/rules/engineering.md`, "Loud or nothing" (no path proceeds over
an unresolved input). The doctrine is now filed; the mechanism is not,
because the fork is a product call:

1. **Fail the tick** on any unresolved span — simplest, loudest;
   a transient digest command failure now costs a tick.
2. **Render but refuse to invoke the agent**, surfacing the failed spans
   — preserves the rendered artifact for debugging; needs a new
   dispatcher exit path and a §6 no-commit classification.
3. **Chain-declared per-span tolerance** (`optional` inline-exec) —
   most flexible, passes the second-implementation test cleanly, most
   surface.

Option 3 is the only one that lets a chain keep a genuinely optional
digest, and the engine-boundary rule leans that way (the engine reports
the fact, the chain owns the interpretation). Not filing an entry:
whichever lands, it needs a spec home and it deletes or rewrites the
tests that currently defend the opposite.

## 2026-07-31 — renderSchemaForPrompt and PendingSchema are an ungated agreement seam (human, operator pass)

Both sides of the "what plan is told" / "what the gate enforces" seam are
hand-authored, and drift ships green — the failure class
`.claude/rules/engineering.md` ("A seam gate reads what the real writer
wrote") now names. Two known live instances, both previously parked for
want of a spec home: `TAG_PATTERN`'s `[a-z0-9]+` paren-slice constraint
is enforced but never rendered, and the `notes` ~500-char cap is
enforced but never rendered. Each was discovered by a plan tick burning
a revert.

The fix that generalizes past both: a test that drives the **real
writer through the real reader** — generate entries conforming to
`renderSchemaForPrompt`'s stated constraints, feed them through
`parsePending`, and assert agreement in both directions (rendered-legal
parses; rendered-illegal refuses). That closes the class rather than the
two instances, and it is the shape the posture page asks for.

Needs a spec home — this is `src/` behavior with an API-visible surface.
Note the two parked open questions (TAG-PATTERN-SLICE-CONSTRAINT,
PENDING-NOTES-CAP-VISIBILITY) are instances of this entry and should
close into it rather than be solved separately.

## 2026-07-31 — CHANGELOG omits five post-0.8.0 fixes; published 0.9.0 section incomplete (human, downstream crawl)

Downstream bays following the changelog keep workarounds they no longer
need. Operator-verified at HEAD: 171a163 reopened `[Unreleased]`
covering only the two ships before it ("self" handshake outcome,
`fenceWhen`); the five later ships added no lines — 480b81c
(pendingGate lazy targetFence read), 9f4e62f + 1a67d1c
(renderSchemaForPrompt separator fixes), 58be15d (win32 inline-exec
shell fallback), 3170113 (shellGate `env`) — and 0722b70's 0.9.0 roll
carried the gap into the published section. Fix is a docs-lane amend of
the `[0.9.0]` section (pre-1.0; the published npm tarball's copy stays
stale, acceptable). Second note: this is the second breakage of the
every-ship-gets-a-line convention (first: a0e3236, restored by
171a163, broken again the same day) — recurring, so consider a
chain-side guard (dogfood-chain gate asserting a build commit touching
`src/` also touches CHANGELOG); that is convention, so it belongs in
`.flume/chain.ts`, not the engine.

**Update (operator, same day): the guard is shipped** — `changelogGate`
in `.flume/chain.ts`, afterCommit on build, with `CHANGELOG.md` added to
`entryChannelPaths` so it needs no per-entry declaration. That closes
the recurrence going forward. **What remains to route is the backfill
only**: the five omitted post-0.8.0 ships still have no lines in the
published `[0.9.0]` section, and no gate can retroactively add them.
Docs-lane amend.

## 2026-07-31 — pendingGate violation message lost chain-authored operator guidance (human, downstream crawl)

A bay that replaced its hand-rolled pendingGate fork with the builtin
(per the 0.9 follow-up prompt) lost the fork's failure-message guidance
("park the entry with the glob it needs, never re-scope it to fit") —
the builtin's generic message carries no chain voice, and the guidance
was load-bearing for their crawl. Reporter marks it minor. Boundary
pre-triage: chain-supplied text appended to the violation report is an
injection point, not a convention — e.g. `pendingGate({ ..., hint?:
string })` echoed verbatim on failure. Passes the second-implementation
test (engine mechanism prints, chain supplies meaning). Alternative is
"wrap the builtin's run() chain-side," which works today but rebuilds
report plumbing — weigh before filing.
