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

## 2026-07-31 — win32 inline-exec: single-quote commands fail under the shell fallback (human, downstream crawl)

Downstream Windows bay reports inline-exec commands containing single
quotes fail even after 58be15d's ENOENT→shell-retry fallback landed.
Operator pre-triage at HEAD confirms the mechanism without needing the
bay's exact commands (their report doc is on another machine; exact
commands + error text unavailable):
`src/Prompt.ts:196` hardcodes `execGate("sh", ["-c", cmd])`. On win32
there is no `sh` → direct spawn ENOENTs → `execGate` retries with
`shell: true`, which is **cmd.exe**, and cmd.exe treats single quotes
as literal characters — so any sh-idiom command (`--format='%h %s'`,
quoted globs) runs mangled instead of failing loudly. The fallback
fixed the blind-tick symptom but left sh-flavored quoting silently
broken on the retry path.
Boundary note: the hardcoded `sh` is the upstream defect — a win32
implementation cannot choose its shell, failing the
second-implementation test. Candidates: platform-aware shell selection
in evaluateInlineExec, or a chain-declared inline-exec shell knob with
platform default. Severity high for Windows bays (silent wrong output
feeds the prompt).

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
