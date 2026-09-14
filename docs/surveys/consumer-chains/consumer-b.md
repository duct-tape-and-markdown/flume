# consumer-b — chain survey

Read 2026-09-14 against the consumer's working tree at its then-HEAD. Every
claim below was verified on disk at that read; `path:line` is relative to the
consumer repository root. Read-only: nothing in the consumer was modified.

consumer-b is a **sibling lineage** of consumer-a — same nested-manifest
layout, same `declaration.json` idiom, same seed-template shape, several
identical doc comments — that has since diverged substantially. Where the two
agree, this file says so rather than restating; where they diverge, the
divergence is the interesting part and is called out.

## 1. Identity and engine version

| | |
| --- | --- |
| Label | `consumer-b` |
| Primary stack | TypeScript / Node; the domain artifacts are YAML workflow graphs validated by a repo-local CLI |
| Package manager | pnpm, pinned `pnpm@11.1.2` (`.flume/package.json:2`) |
| Engine dependency | `"@dtmd/flume": "0.14.0"` — exact (`.flume/package.json:8`) |
| Lockfile resolved | `0.14.0` — manifest and lock agree |
| Install shape | Registry install into a **nested** manifest at `.flume/package.json`, identical to consumer-a. Not vendored, not path-linked. |
| State root | `.flume/`; **job mode** — live roots at `.flume/jobs/<name>/` |
| Jobs | Two at read time: `.flume/jobs/intake/` and `.flume/jobs/operability/`. `operability` is the live one (a `loop.pid` was present, and its plan subtree carries the most recent writes on the machine). `seedDir: "job-seed"` (`.flume/chain.ts:1078`) |
| **Tracking posture** | **Unique to this consumer.** The state root is excluded via `.git/info/exclude`, **not** `.gitignore` — per `.flume/README.md:8-9`, it *"never shows up in `git status`, is never committed, and is not part of any PR."* The README frames the whole bay as *"local to this checkout, not team-shared infrastructure"* (`:5`), adopted personally in a shared repo. This is a consumer whose harness is deliberately invisible to its own repository. |

## 2. Chain shape

Chain module: `.flume/chain.ts`, **1097 lines** (157 more than consumer-a).
Two prompt files (`.flume/prompts/build.md`, 44 lines — half consumer-a's;
`.flume/prompts/plan.md`, 189 lines). **Zero helper scripts under the state
root** — the job-seed carries only `brief.md`, `inbox.md`, `plan/`.

### Phases

| | `plan` | `build` |
| --- | --- | --- |
| Concurrency | `singleton` (`:1005`) | `fanout` (`:954`) |
| Prompt | `prompts/plan.md` (`:1004`) | `prompts/build.md` (`:953`) |
| `writablePaths` | getter (`:1009`): 4 literals + `planWritablePaths` + **`planBacklogPath`** + `frictionGlob` | getter (`:961`): declaration's `writablePaths` + `openQuestions` + `frictionGlob` |
| top-level dirs covered | `.flume/**` only | job-declared repo source + the `.flume/` channel paths |
| `entryChannelPaths` | not declared | not declared |
| `scopeWritesToEntry` | n/a | **deliberately undeclared** (`:955-957`) — same comment as consumer-a, minus the MIGRATING-0.10 §6 cite |
| `shouldRun` | **not declared** | **not declared** |
| `shipped` | n/a | yes (`:973`) — `touchedPaths.some(p => !isChannelPath(p))`. **No `channelOnly` escape hatch**, unlike consumer-a |
| `promptArgs` | yes (`:1037`) — 7 tokens | yes (`:983`) — 6 tokens |
| `setupWorktree` | not declared | yes (`:978`) — `setupDirs` installs only; comment (`:975-977`) notes this bay has *"no compiled project graph to restore"*, so consumer-a's PowerShell restore leg is absent |
| `teardownWorktree` | not declared | not declared |
| `handoff` | `:1056` | `:997` — **unconditional `() => ["plan"]`** |

**The absence of `shouldRun` on both phases is the sharpest divergence from
consumer-a.** consumer-a's `planShapedHead()` / `jobRootDirty()` decline and
its zombie brake have no counterpart here; every dispatch runs. Correspondingly,
build's `handoff` is the unconditional `() => ["plan"]` (`:997`) rather than
consumer-a's five-way reading of `nothingPickable` / `noCommit`. **This chain
consumes none of `TickResult`'s no-commit reporting surface.**

### Gates

| Gate | `when` | Builtin / chain-authored | What it judges |
| --- | --- | --- | --- |
| `pendingGate` | engine default | builtin (`:1021`) | Same shape as consumer-a, including the `targetFence` getter, `fenceWhen`, and a near-identical `hint` |
| `per-paths-exist` | `afterCommit` | **chain-authored** (`:203`) | Same job as consumer-a's, but **improved**: it derives the queue's relative path from `ctx.pendingPath` rather than hardcoding `plan/pending.json` (`:222-225`), so a relocated `Chain.pendingPath` stays correct |
| `state-claims-true` | `afterCommit` | **chain-authored** (`:314`), original to this consumer | Checks two claims a plan tick writes *about itself* against the artifacts they describe: (a) "inbox drained" against the inbox's remaining paragraphs, (b) a `Queue: N open, M parked` line against the queue at the gated commit |
| `validate-pins-<plugin>` | **`afterMerge`** | **chain-authored** (`:784`), original | Runs a repo CLI's source-drift report against the merged tree **and against a throwaway worktree at `commitSha^`**, and fails only on *fresh* drift this entry introduced |

`validate-pins` is the most engineering-dense gate in any consumer surveyed.
It is a genuine **differential** gate — it provisions `git worktree add
--detach <tmp> <sha>^` (`:804-806`), reports both sides, subtracts the
inherited set (`:829-831`), and reports the inherited count in the *passing*
message too (`:857-859`). Its failure mode is deliberately loud: a baseline it
cannot read **fails** the entry rather than passing it (`:741-744`), *"A gate
that cannot judge must not wave work through."*

There is **no `skipChannelOnly` wrapper** here — gates are used raw (`:965`).

### Chain-level declarations

| Field | Value |
| --- | --- |
| `pendingPath` | not declared (engine default) — but `per-paths-exist` and `state-claims-true` both read `ctx.pendingPath` rather than assuming it |
| `seedDir` | `"job-seed"` (`:1078`) |
| `friction` | `"friction"` (`:1080`) |
| `humanOnly` | `[]` (`:1076`) |
| `entryExtension` | **5 fields** (`:164`): `summary` (≤300), `per`, `acceptance` (**uncapped** — consumer-a caps at 1600), `tests[]`, `notes` (≤800). **No `channelOnly`** |
| `supervisorPolicy.maxParallel` | **not declared** (engine default) — consumer-a sets 4 |
| `supervisorPolicy.partitionIgnore` | **not declared** |
| `supervisorPolicy.tickTimeoutMs` | **`40 * 60_000`, a flat constant** (`:1090`), not a getter and not job-overridable. The comment (`:1082-1089`) re-derives it from this bay's own `metrics.jsonl`: 64 invocations, median 2.7 min, p90 8.9, max 16.7 (a plan tick; build's own max 5.8) — 2.4× the observed max. It explicitly records that it *replaced* a 90-minute placeholder once real ticks existed to measure |
| Agent assignment | `agents.{plan,build}` selecting from `AGENTS` (`:695`); absent falls back to a single `TICK_AGENT` = sonnet (`:688`, `:930-933`) |
| **`autonomyLevel`** | **Original to this consumer.** `z.enum(["conservative","standard","autonomous"])` (`:490`), absent means `standard` |

### `handoff` shape

**build** (`:997`): `() => ["plan"]`, unconditional. Reads no `TickResult` field.

**plan** (`:1056`): reads `result.pickableAfter` → `["build"]`. Otherwise
**reads `state.md` off disk and regexes `/^Plan continues: yes/m`** (`:1065-1066`)
→ `["plan"]`; else `[]`. The comment (`:1057-1062`) records why `pickableAfter`
replaced a hand-rolled `gate.kind === "open"` test — the same quarantine
live-lock consumer-a documents, spending a plan agent per cycle until `--max`.

## 3. Engine facts the chain re-derives

| # | Site | What it re-derives | Covered by 0.15.0? |
| --- | --- | --- | --- |
| 1 | `.flume/chain.ts:40,43,44` | State root and repo root resolved at **module scope** from `FLUME_DIR` / `import.meta.url` | **Covered** — `FlumeApi.paths`. Same module-scope lifecycle gap as consumer-a, but **undocumented here** — consumer-a carries a 15-line comment naming the gap; consumer-b just does it. |
| 2 | `.flume/chain.ts:62-67` | `git rev-parse --git-common-dir` → `FLUME_WORKTREES_DIR`, same block as consumer-a | **Uncovered as a hook** — env-var-only, must run at module scope. |
| 3 | `.flume/chain.ts:89-101` | `costUsd()` splits raw stdout and finds the `result` event line to recover `total_cost_usd` | **Partially covered.** Same gap as consumer-a #6, and the comment (`:84-88`) states it precisely: *"The one `result`-event field `AgentUsage` does not carry. The engine decodes the rest of that event for us, so this is the whole remaining reason to look at raw stdout."* Two independent consumers hand-parsing the same one field is the strongest single signal in this survey. |
| 4 | **`.flume/chain.ts:131`** | **`/"tag":\s*"([^"]+)"/.exec(opts.prompt)` — regexes the entry tag out of the RENDERED PROMPT TEXT** | **Covered, unreachably.** The comment (`:109-115`) is unusually candid: the tag *"is first-class on `TickContext.assignedEntry`, but this decorator is composed in `agentFor` from a phase getter that holds no `TickContext`, and `AgentInvocation` carries no tag field. The engine's tick verdict does carry one per invocation, which is the path off this regex if the row moves there."* **This is the cleanest missing-surface finding in the survey**: a chain parsing prompt text it authored, to recover a fact the engine holds, because `AgentInvocation` has no field for it. |
| 5 | `.flume/chain.ts:324-328` | `state-claims-true` reads files at the gated commit via hand-rolled `git show <sha>:<path>` | **Covered** — `FlumeApi.git.readFileAtRef`. Not adopted (chain is on 0.14.0). |
| 6 | `.flume/chain.ts:239-240` | `per-paths-exist` does the same `git show` | **Covered** — same surface. |
| 7 | `.flume/chain.ts:514-519` | `nodeCensus`'s own `show(ref, path)` helper — a third hand-rolled `git show` in one module | **Covered** — same surface. Three call sites, one missing adoption. |
| 8 | `.flume/chain.ts:526-532` | `git ls-tree -r --name-only <pin>` to enumerate files at a ref | **Uncovered.** `FlumeApi.git` exposes `showNameOnly` and `readFileAtRef`, but nothing enumerates a tree at an arbitrary ref. |
| 9 | `.flume/chain.ts:623-624` | `briefDelta` reads `state.md` off disk and regexes `/^- Brief derived through:\s*([0-9a-f]+)/m` to recover the plan cursor | **Genuinely absent.** There is no engine notion of a chain-owned cursor. The comment (`:608-618`) is a designed workaround, not an oversight — see §7. |
| 10 | `.flume/chain.ts:630-634` | `git log --reverse --format=%h %s <cursor>..HEAD -- brief.md` | **Uncovered.** No engine surface computes a commit window. |
| 11 | `.flume/chain.ts:1065-1066` | `plan.handoff` reads `state.md` off disk and regexes `/^Plan continues: yes/m` to decide continuation | **Genuinely absent** — this is a chain-owned continuation signal with no engine field. It is also **pattern-matching prose an agent authored**, the shape flume's own `engine-boundary.md` names under *Told, not inferred* — but committed *by the chain about itself*, which is the sanctioned side of that line. |
| 12 | `.flume/chain.ts:804-806` | `validate-pins` provisions its own `git worktree add --detach` at `commitSha^` | **Uncovered.** The engine provisions fanout worktrees but exposes no way for a gate to ask for a base-tree checkout, so a differential gate builds its own — including the `finally` cleanup (`:817-826`). |

**Prompt inline-exec spans: 5, all in `plan.md`** (none in `build.md`):

| Line | Command | Reads what |
| --- | --- | --- |
| `prompts/plan.md:13` | `cat "$FLUME_DIR/plan/state.md"` | chain-owned artifact |
| `prompts/plan.md:17` | `cat "$FLUME_DIR/plan/open-questions.md"` | chain-owned artifact |
| `prompts/plan.md:21` | `cat "$FLUME_DIR/inbox.md"` | chain-owned artifact |
| `prompts/plan.md:25` | `grep -E '^#{1,3} ' "$FLUME_DIR/brief.md"` | chain-owned artifact (headings only) |
| `prompts/plan.md:29` | `grep -E '^#{1,4} \|^Row count' "$FLUME_DIR/plan/register.md"` | chain-owned artifact (headings only) |

**None reads an engine-owned artifact** and **none computes a git window off a
cursor** — the cursor window was deliberately moved *out* of a span and into
`briefDelta()` (`:611-618`), precisely because *"an unresolvable cursor must not
be fatal. A span that exits non-zero aborts the whole render
(`render-refused`) and the agent is never invoked."* This is the same conclusion
consumer-a reached by banning spans outright; consumer-b kept spans for reads
that cannot fail and moved the fallible one to `promptArgs`.

**Pickability / quarantine re-derivation: none** — `result.pickableAfter` is
read directly (`:1063`) with a comment recording the live-lock that a
hand-rolled version caused.

**Agent-output re-parsing:** #3 and #4 above. **Gate-message text matching:**
none. **Filename/slug rule copying:** none; but note the chain **never uses
`priorAttemptPath`** and never reads a prior-attempt record at all — it has no
zombie brake to need one.

> **§3 verdict: 12 re-derivations. 5 are already covered by a 0.15.0 surface
> (#1, #5, #6, #7 — three of those the same unadopted `readFileAtRef` — and
> #4, which is covered but structurally unreachable from where it is needed).
> 7 are genuinely absent: the worktree-base hook (#2), a cost field on
> `AgentUsage` (#3), a tree-listing git helper (#8), a chain cursor (#9), a
> commit-window helper (#10), a continuation signal (#11), and a base-tree
> checkout for differential gates (#12).**

## 4. What 0.15.0 breaks

| Check | Result |
| --- | --- |
| `voluntary-bail` string | **No hits** anywhere in `chain.ts` or either prompt. The chain reads no prior-attempt record. |
| Record's `constraint` → `finalMessage` | Not read. Inert. |
| Direct `writablePathsGate(...)` call | **No hits.** |
| `ctx.priorAttempts` keyed by a raw tag | **No hits.** |
| `JobStatus.awake` as `string[]` | **No hits.** |
| `.flume/rendered-prompts/` / `.flume/merging/` in an ignore file | **Named in neither `.gitignore` nor `.flume/.gitignore`** (the latter carries `node_modules/`, `sessions/`, `metrics.jsonl`, `tick-verdicts.jsonl`, `tick-verdict.json`). **But this consumer is immune**: the whole state root is excluded through `.git/info/exclude` (`.flume/README.md:8`), so nothing under `.flume/` reaches `git status` regardless. This is the one consumer where the 0.15.0 seeded directories cost nothing — and it is immune by an unrelated decision, not by having ignored them. |
| Imports no longer exported by 0.15.0 | **None.** Type-only imports, all still exported; runtime values arrive through the injected `FlumeApi`. |
| Typecheck against 0.15.0 | **Not run.** Same reason as consumer-a: it would require a scratch install, and the survey is read-only. Import surface checked by reading flume's `src/index.ts` instead. |

> **§4 verdict: 0 breakages. Typecheck NOT run.** consumer-b is the only
> consumer surveyed that 0.15.0 does not break — and the reason is telling: it
> breaks nothing because it *consumes* almost nothing. It reads no prior-attempt
> record, no `noCommit`, no `nothingPickable`, no `awake`. Its one engine-state
> read (`pickableAfter`) is the field 0.15.0 did not touch.

### A live defect found while checking §4 — not a 0.15.0 breakage

`state-claims-true`'s queue-count half is **vacuously passing on both live
jobs**. The gate matches `/Queue:\s*(\d+)\s+open,\s*(\d+)\s+parked/i`
(`.flume/chain.ts:297`). The two state files on disk read:

- `.flume/jobs/intake/plan/state.md:5` — `- Queue: empty`
- `.flume/jobs/operability/plan/state.md:24` — `- Queue: 1 open, 0 blockedBy, 5 parked`

Neither matches: the second inserts `0 blockedBy,` between the two captures, so
`claimed` is `null`, the `if (claimed && pending)` branch (`:298`) never runs,
and the check silently returns "no findings". The gate's *inbox* half still
works; its *count* half has not judged anything on either job. The prose the
plan prompt actually produces grew a third count, and the gate's regex did not.
This is exactly the class flume's own `engineering.md` names under *A green
verdict is proven non-vacuous* — and it is a chain-side instance of the same
root cause as §3 #4 and #9: **a chain reading a fact out of prose because it
has no structured place to read it from.** The queue counts are derivable from
`ctx.pending`, which the chain already holds.

## 5. What this chain does that flume's own chain does not

**Has, that flume's lacks** (beyond what it shares with consumer-a — the
per-job declaration layer, lazy `decl()` reads, phase getters, mount-time
refusal, the multi-model agent registry, `metrics.jsonl` telemetry, and a
`tickTimeoutMs` derived from that corpus):

- **An autonomy dial rendered as prompt prose** (`:371-447`). Three levels
  (`conservative` / `standard` / `autonomous`) × two phases = six declared
  blocks, selected by the job's `autonomyLevel` and rendered into an
  `{{AUTONOMY}}` slot both prompts carry. The dial governs *judgment* — whether
  an ambiguity becomes an entry or an open question (plan), whether an ambiguous
  acceptance criterion is resolved or returned (build). Every one of the six
  blocks ends on the same `FENCE_LINE` constant (`:380`), *"Autonomy is a dial
  on judgment, never on the fence"*, repeated deliberately (`:376-378`) so a
  reader who sees only one block still sees the boundary. **This is the single
  most transportable original in the survey** and has no counterpart in flume's
  own chain or in consumer-a.
- **`state-claims-true`** (`:314`) — a gate that checks a tick's claims *about
  itself* against the artifacts those claims describe. Provoked by a specific
  commit: *"Both were false at `013f10e5`: the tick reported a drained inbox
  over a file it never touched, and carried the previous tick's queue counts
  forward without re-reading the queue"* (`:267-269`). `stateClaimFindings` is
  **exported** (`:274`) so it can be exercised against a commit without running
  a tick.
- **`validate-pins`** (`:784`) — the differential `afterMerge` gate described
  in §2. Its `GATES` registry has exactly two entries, one per plugin (`:864`).
- **`nodeCensus`** (`:513`) — a ~95-line coverage report computed every plan
  tick and rendered into a `{{NODE_CENSUS}}` slot. **Deliberately not a gate**
  (`:503-506`): *"It reports a non-zero delta today, and a check that cannot
  pass is a check the work routes around — the whole-plugin pin validator
  taught that at the cost of four reverted waves. Coverage becomes a gate once
  the delta is zero, to hold it there."* A staged promotion up the ladder, with
  the trigger stated.
- **`briefDelta`** (`:620`) — a cursor-windowed delta of the brief, with a
  designed failure mode (see §7).
- **`planBacklogPath`** (`:480`) — a declared standing-work-order file merged
  into plan's fence, for work *"an inbox-style one-shot note can't carry (a
  multi-tick census, a multi-phase walk)"*. Live on the `operability` job as
  `plan/backlog.md` (332 lines).
- **A `register.md`** — a 1203-line plan-owned domain ledger, fenced in via
  `planWritablePaths` and read (headings only) by an inline-exec span.

**Flume's own chain has, that this lacks:** plan slicing (one `plan` phase
here, described as *"Take the first live plan input … as one job"*, `:1003`);
records as one file each (single `inbox.md`, `:1014`); a `tests[]`/`pins[]`
judge (`tests[]` is declared at `:180` and, as in consumer-a, **nothing runs
it**); a `per`-cite gate that checks the *section* resolves, not just the file;
a clean-tree gate; a records gate. Also absent relative to **consumer-a**: any
`shouldRun`, the zombie brake, `skipChannelOnly`, `channelOnly`,
`partitionIgnore`, `maxParallel`, and a worktree restore leg.

**Different notion of "done":** `shipped` is the same "any non-channel touch"
policy as consumer-a but **without the `channelOnly` opt-in** — so an entry
whose whole acceptance is a channel edit can only park here.

**Different spec locus:** as with consumer-a, no `spec/`. `per.path` names a
per-job brief. `.claude/rules/` holds exactly one file, a domain authoring
guide — no flume harness rules.

## 6. Harness copies

| Artifact | Present? | Verbatim / adapted / original |
| --- | --- | --- |
| `PROTOCOL.md` | **No** | — |
| `.flume/README.md` | Yes, **40 lines** (consumer-a's is 275) | **Original, and deliberately thin.** Opens with the same `<!-- flume: static — hand-authored -->` marker as consumer-a — that one line is verbatim across both. But where consumer-a's README re-documents install/mount/run in full, consumer-b's `:11-14` **points at the package's own docs instead**: *"For how a flume bay actually operates (install, mount, run, fanout worktrees, cleanup, prompt authoring) see `@dtmd/flume`'s own docs — `docs/CLI.md`, `docs/CHAIN-AUTHORING.md` — in the flume source. This file only covers what's specific to this bay."* Two sibling consumers, same lineage, opposite choices about whether to restate the operator manual. |
| Plan-slice prompts | **No.** One `plan.md` (189 lines) | Original |
| A plan discipline file | **No** separate file | — |
| `.claude/rules/engineering.md` | **No** | — |
| `.claude/rules/engine-boundary.md` | **No** | — |
| `.claude/rules/spec-plan-build.md` | **No** | — |
| `.claude/rules/*` | One file, a domain authoring guide | Original, not flume-derived |
| `open-questions.md` | Yes — seed template + live on both jobs (203 lines on `operability`) | Adapted |
| `state.md` with cursor lines | Yes. Carries **two** cursors: `- Brief derived through: <sha>` (read by `briefDelta`, `:624`) and a `Plan continues: yes` flag (read by `handoff`, `:1066`) | **Adapted, and load-bearing in two directions** — consumer-a's `state.md` is load-bearing as an unforgeable *signature*; consumer-b's is load-bearing as a *parsed data source* |

**Verbatim blocks shared with consumer-a** — each one a candidate config field
rather than a copied block:

1. The `FLUME_WORKTREES_DIR` module-scope side effect (`:62-67` ≡ consumer-a
   `:70-78`).
2. The `flumeDir` / `repoRoot` / `flumeDirRel` / `frictionGlob` /
   `openQuestions` preamble (`:40-47` ≡ consumer-a `:50-58`).
3. The `entryExtension` record — `summary`, `per`, `acceptance`, `tests`,
   `notes` with **character-identical `hint` strings** (`:164-193` ≡ consumer-a
   `:160-193`, which adds `channelOnly` and a cap on `acceptance`).
4. `per-paths-exist` — same gate, same rationale comment, consumer-b's version
   improved (`ctx.pendingPath`-derived rather than hardcoded).
5. The `pendingGate` block including `targetFence` getter, `fenceWhen`, and a
   near-identical `hint` (`:1021-1033` ≡ consumer-a `:850-862`).
6. `commitFence()` and its doc comment (`:938-945` ≡ consumer-a `:698-701`).
7. The `decl()` lazy-read guard and its `flume job new` rationale (`:871-877` ≡
   consumer-a `:589-594`).
8. The `scopeWritesToEntry`-stays-undeclared comment (`:955-957` ≡ consumer-a
   `:711-713`).
9. `withTickMetrics`'s row shape and its swallow-everything contract.
10. The `// singleton: pending.json/state.md are shared, one writer at a time.`
    line (`:1000` ≡ consumer-a `:829`) — verbatim, including the comment marker.
11. The `<!-- flume: static — hand-authored -->` README marker.

## 7. Operator signal

**No `flume#` issue references anywhere** — unlike consumer-a, which annotates
four. This consumer's signal is carried entirely in workaround comments, and
each names the engine behavior it is routing around:

- **`render-refused` is too blunt a failure for a fallible prompt input**
  (`:608-618`, the `briefDelta` doc comment). The full shape: *"A span that
  exits non-zero aborts the whole render (`render-refused`) and the agent is
  never invoked — and the cursor is a raw sha in `state.md`, which stops
  resolving the moment the job's branch is squash-merged or rebased, both of
  which `README.md` recommends. Plan is the only phase that can rewrite
  `state.md`, so a bad cursor used to brick the one phase able to fix it."*
  The workaround moves the computation out of the prompt span into `promptArgs`,
  where the failure renders as **an instruction to re-stamp** (`:638-642`)
  rather than as a dead tick. Two facts are stacked here: the engine offers no
  per-span failure policy, and a raw-sha cursor is fragile under the branch
  workflow the consumer's own README recommends. **This is the highest-value
  operator signal in the survey** — a self-inflicted deadlock the consumer
  found, diagnosed, and engineered around, with the engine behavior named.
- **`AgentInvocation` carries no entry tag** (`:109-115`). The chain regexes it
  out of prompt text and states the exit: *"The engine's tick verdict does carry
  one per invocation, which is the path off this regex if the row moves there."*
  An identified fix, not adopted.
- **`AgentUsage` carries no cost** (`:84-88`) — *"the whole remaining reason to
  look at raw stdout."* Same complaint as consumer-a's `flume#10`, filed
  nowhere here.
- **A gate cannot ask the engine for a base-tree checkout** (`:798-826`). The
  differential gate provisions and tears down its own detached worktree in
  `tmpdir()`, with a `finally` that swallows cleanup failure: *"A worktree left
  behind is work for `git worktree prune`, never a verdict on the entry."*
- **A gate that cannot judge must fail, not pass** (`:741-744`) — stated as
  policy, with the cost accepted: *"the price is that an infrastructure failure
  stops a build tick, which is the louder failure and the recoverable one."*
- **A check that cannot pass is a check the work routes around** (`:503-506`),
  priced at *"four reverted waves"* from a whole-plugin pin validator. This is
  why `nodeCensus` reports instead of gating. Shape: *the engine's gate
  mechanism is all-or-nothing; there is no "report, don't revert" rung between
  a gate and a prompt slot.*
- **The `pendingAfter` → `pickableAfter` live-lock** (`:1057-1062`), recorded
  independently of consumer-a in near-identical terms — *"build woke to pick
  nothing and woke plan straight back, spending a plan agent per cycle until
  `--max`."* Two consumers hit the same trap and both wrote it down.
- **A repo CLI that exits non-zero on drift and still writes its report**
  (`:754-760`) — handled by treating a throw as ordinary and an *empty stdout*
  as the real failure. Not a flume complaint, but the same class of problem the
  engine solves for gates generally.
- **The 90-minute placeholder that asked to be re-derived** (`:1082-1084`) —
  and was, once the bay had 64 measured ticks. An expiry predicate that
  actually fired.

**Tracking posture as signal** (`.flume/README.md:5-9`): the harness is
excluded through `.git/info/exclude` because the repo is shared and flume is
adopted *personally* here. Shape: *a per-developer harness in a team repo has
no sanctioned place to live.* That is a packaging question the chain package
will meet directly — it is the difference between a bay a team declares and a
bay one engineer runs.
