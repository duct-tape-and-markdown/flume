# consumer-c — chain survey

Read 2026-09-14. Every claim verified on disk at that read; `path:line` is
relative to the consumer repository root. Read-only: nothing modified.

## 1. Identity and engine version

| | |
| --- | --- |
| Label | `consumer-c` |
| Primary stack | TypeScript / Node, plus a .NET leg and a tree-sitter/WASM leg; a self-contained bundled CLI is the product |
| Package manager | npm (the gates invoke `node node_modules/…` directly rather than a package-manager shim) |
| Engine dependency | `"@dtmd/flume": "^0.12.0"` (`package.json`) — a **range**, not a pin |
| Lockfile resolved | **`0.11.0`** (`node_modules/@dtmd/flume/package.json`). **The manifest and the installed tree disagree**: the range asks for ≥0.12.0, the tree holds 0.11.0. Whatever this bay has been ticking under is 0.11.0, one minor behind what it declares. This is the only consumer surveyed where the two disagree by more than a patch. |
| Install shape | Registry install at the **repo root** manifest — not the nested `.flume/` manifest consumer-a and consumer-b use |
| State root | `.flume/`, **default root**. No `flume job`, no `jobs/` directory. |
| Liveness | `.flume/awake/` empty; idle since early September |

## 2. Chain shape

Chain module: `.flume/chain.ts`, **619 lines**. Two prompts
(`prompts/build.md` 34 lines, `prompts/plan.md` 84 lines). No helper scripts
under the state root — but the chain and prompts reach **outside** it to
`scripts/plan-gates.mjs` and `scripts/audit-gate.mjs` in the repo proper.

### Phases

| | `plan` | `build` |
| --- | --- | --- |
| Concurrency | `singleton` (`:470`) | `fanout` (`:527`) |
| Prompt | `prompts/plan.md` (`:469`) | `prompts/build.md` (`:526`) |
| Agent | **`pinned("opus")`** (`:471`) | **`pinned("sonnet")`** (`:538`) — with a 9-line justification (`:528-537`): build executes one pre-specified entry behind six reverting gates, *"mechanical work under verification, which is the case Sonnet is for … Judgment under ambiguity stays on Opus"* |
| `writablePaths` | 4 literals, flat array (`:478`) | `buildFence.writablePaths` (`:539`) |
| `entryChannelPaths` | not declared | **deliberately removed** — `:546-548`: before 0.10 the same effect was bought by declaring it equal to the ceiling; *"0.11 refuses that declaration on an unscoped phase, and deleting it changed no path"* |
| `scopeWritesToEntry` | n/a | **deliberately undeclared** (`:540-549`), with the fullest rationale of any consumer: *"`entry.files` is plan's guess and build expands to whatever acceptance needs inside the fence — so the entry has no business governing the fence"* |
| `shouldRun` | not declared | not declared |
| `shipped` | n/a | not declared |
| `promptArgs` | yes (`:495`) — **1 token**, and it is a *patched* schema (see §3 #1) | yes (`:562`) — 4 tokens |
| `setupWorktree` | yes (`:477`) — `installDepsSetupWorktree` | yes (`:561`) — same function |
| `teardownWorktree` | not declared | not declared |
| `handoff` | `:502` | `:576` |

### Gates

| Gate | `when` | Builtin / chain-authored | What it judges |
| --- | --- | --- | --- |
| `pendingGate` | default | builtin (`:492`) | Core + `entryExtension`, `targetFence: buildFence` |
| `state ledgers within cap` | `afterCommit` | **chain-authored** (`:119`) | Line-counts `plan/state.md` (cap 120) and `plan/open-questions.md` (cap 220) and **reverts** over-cap commits |
| `tsc` | `afterCommit` | `shellGate` (`:314`) | |
| `bundle builds` | `afterCommit` | `shellGate` (`:386`) | Ordered **before** vitest (`:552-554`): tests that drive the bundled CLI need a fresh bundle matching the just-merged tree |
| `vitest` | `afterCommit` | `shellGate` (`:342`) | |
| `cartograph audit (zero drift)` | `afterCommit` | `shellGate` (`:400`) | Domain audit must report zero drift |
| `dotnet build` | `afterCommit` | `shellGate` (`:357`) | |
| `bundle runs without node_modules` | `afterCommit` | **chain-authored** (`:162`) | Copies the bundle + WASM into a fresh `tmpdir` with no ancestor `node_modules` and runs `help`; an un-inlined runtime require surfaces as a hard error |

Six gates on build, all `afterCommit`. **No `afterMerge` gate anywhere.**

`state ledgers within cap` is a **budget-as-gate**: the cap reverts the
commit, and the failure message (`:143-151`) names what may stay and what must
move to the commit body. The rationale (`:108-112`): *"Both files are injected
into every plan prompt, so growth is a tax the loop pays forever — and the
growth is narrative, which the commit body holds better (dated and diffable)."*
Its line-counting carries a scar comment (`:127-129`): counting like `wc -l`
rather than a bare `split("\n")`, because the naive version *"reverted two
legitimately-at-cap commits."*

### Chain-level declarations

`entryExtension` (`:73`). `humanOnly: []` (`:601`). **`capabilities` and
`supervisorPolicy` both deliberately undeclared** (`:602-607`), with the reason
stated: no entry is environment-gated (the .NET and tree-sitter toolchains are
*"gate-time facts, not pickability facts"*), and the loop has never hit a
provisioning-failure storm, so the engine defaults are *"the behavior this bay
has always run under."* No `seedDir`, no `friction`, no `pendingPath`.

The factory returns `{ chain, agent: pinned("opus") }` (`:616`) — a chain-level
backstop *"so a phase added later without a pin still names a model instead of
inheriting the CLI default"*, and returned rather than named-exported because
*"a named export can no longer reach the engine (MIGRATING-0.10 §2)"* (`:613-614`).

### `handoff` shape

**plan** (`:502`): reads `state.md` off disk, regexes `/^Plan continues:\s*yes\b/im`
(`:511`) → `["plan"]`. Otherwise `result.pendingAfter.some(e => e.gate.kind === "open")`
(`:516`) → `["build"]` or `[]`.

**build** (`:576`): reads `result.shippedTags`, `result.gateResults`, and
`result.noCommit`. Hibernates only when all three say nothing happened. The
comment (`:577-586`) records the history: *"before 0.8 it was indistinguishable
from a genuine no-op, which is why this handoff woke plan unconditionally."*

## 3. Engine facts the chain re-derives

| # | Site | What it re-derives | Covered by 0.15.0? |
| --- | --- | --- | --- |
| 1 | `.flume/chain.ts:275-291` | **Patches the engine's own rendered prompt schema.** `renderPendingSchema` string-replaces the engine's scoped-fanout `files` clause with a corrected one, guarded by an `assert` that throws if the engine's wording changes | **This is not a re-derivation — it is a correction, and it is the single most important finding in this consumer.** See §4. |
| 2 | `.flume/chain.ts:41` | `CHAIN_DIR` from `import.meta.url` at module scope; used by `handoff` to resolve `plan/state.md` (`:507-509`) | **Covered** — `FlumeApi.paths`. Same module-scope lifecycle gap as consumer-a/b, undocumented here. |
| 3 | `.flume/chain.ts:511` | `handoff` reads `state.md` and regexes `/^Plan continues:\s*yes\b/im` | **Genuinely absent** — a chain-owned continuation signal with no engine field. Identical in kind to consumer-b #11 and consumer-d's, and cited to a local `PROTOCOL.md` §"Plan continuation marker" (`:504`) |
| 4 | `.flume/chain.ts:516-518` | `result.pendingAfter.some(e => e.gate.kind === "open")` — **the hand-rolled pickability test** | **Covered** — `TickResult.pickableAfter`. **Not adopted, and this is the live-lock both consumer-a (`:891-895`) and consumer-b (`:1057-1062`) independently hit and wrote down**: an entry quarantined for the run stays `open` on disk, so build wakes to pick nothing and wakes plan straight back, spending an agent per cycle to `--max`. consumer-c still carries the pre-fix form. Since its plan agent is Opus, the cost per cycle here is the highest of any consumer. |
| 5 | `prompts/plan.md:4,8,12` | **`git log --grep='^plan:'` — finds the last plan commit by matching its commit-message prefix**, then windows `$LAST..HEAD` for commits, stats, and a `spec/` diff | **Uncovered, and it is an inference.** The chain reconstructs "which commit was plan's" from commit-message text it authored. This is the same conclusion consumer-a reaches by touched-path shape (`planShapedHead`) — two consumers inventing two different unreliable answers to *"where did the last plan tick leave off?"* Neither is a fact the engine hands out. |
| 6 | `prompts/plan.md:16` | A `node -e` one-liner re-parsing `.flume/plan/pending.json` to print a queue digest | **Covered** — `TickContext.pending`. This is the *exact* re-derivation consumer-a records having retired into `promptArgs` (consumer-a `:866-867`). consumer-c still pays a per-render node spawn for it. |
| 7 | `prompts/plan.md:22` | `awk '/^---$/{found=1; next} found' .flume/inbox.md` — re-implements the inbox's own header/body split in awk | **Uncovered.** The inbox format is a chain convention with no engine reader. |
| 8 | `prompts/plan.md:34` | `node node_modules/typescript/bin/tsc --noEmit \| tail -10` inside a prompt span | **Uncovered**, and a distinct hazard: a live typecheck inside a render span. Guarded with `\|\| true` so it cannot abort the render. |
| 9 | `prompts/build.md:12,18` | `cat {{PER_PATH}}` and `git log -n 5 --oneline` | **Uncovered** and harmless — chain-owned reads. |

**Inline-exec spans: 10 total** (8 in `plan.md`, 2 in `build.md`) — the most of
any consumer surveyed, and the only consumer whose spans compute a git window
off a cursor (#5). **None reads an engine-owned artifact** (no
`prior-attempts/`, no `tick-verdicts.jsonl`, no `awake/`).

**Agent-output re-parsing:** none. **Gate-message text matching:** none.
**Filename/slug rule copying:** none. **Reading a file at a sha by hand:**
none in `chain.ts` — but the plan prompt's spans do the equivalent in shell.

> **§3 verdict: 9 re-derivations (excluding #1, which is a correction rather
> than a re-derivation). 3 are already covered by a 0.15.0 surface (#2, #4, #6)
> — and #4 is the known live-lock two sibling consumers already fixed. 6 are
> genuinely absent: a continuation signal (#3), a "where did plan leave off"
> cursor (#5), an inbox reader (#7), and three chain-owned shell reads (#8, #9).**

## 4. What 0.15.0 breaks

| Check | Result |
| --- | --- |
| **`renderSchemaForPrompt` clause assert** | **BREAKING, and total.** `.flume/chain.ts:275-276` pins the engine's exact wording: `"Enforced on fanout: the build tick may write ONLY these paths ∪ the phase's channel paths; an under-declared entry is a plan defect."` flume 0.15.0 emits (`src/PendingSchema.ts:513`): `"Enforced on fanout: a scoped tick may write ONLY these paths ∪ the phase's channel paths; an under-declared entry trips the write guard."` **Two independent changes** — `the build tick` → `a scoped tick`, and `is a plan defect` → `trips the write guard`. The `if (!rendered.includes(SCOPED_FILES_CLAUSE)) throw` (`:282-288`) therefore fires, `plan.promptArgs` throws, and **every plan tick renders-refused**. Plan is the only phase that can rewrite the queue, so the bay is bricked until a human re-anchors the string. **This is the assert working exactly as designed** (`:271-273`: *"if a flume upgrade rewords the clause, the render fails loudly at the next tick instead of silently passing the stale sentence through"*) — and the upgrade it is catching is the one this chain asked for: the engine now says **"a scoped tick"**, i.e. the sentence has been conditioned on scoping, which is precisely the fix `:286-287` names as the trigger to *drop* `SCOPED_FILES_CLAUSE` entirely. The migration action is deletion of the whole `renderPendingSchema` mechanism, not re-anchoring. |
| `voluntary-bail` string | **1 hit — breaking.** `.flume/chain.ts:590`: `result.noCommit !== "voluntary-bail"`. Under 0.15.0 the mode is `clean-exit`, so the condition is always true, and a wave that shipped nothing, fired no gates, and **cleanly bailed will hibernate instead of waking plan** — the exact case `:577-580` says must reach plan: *"the build prompt tells a bailing tick that plan re-derives next, so plan must actually see it."* Silent: a `string` comparison against a union member, no type error. |
| Direct `writablePathsGate(...)` call | **No hits.** |
| `ctx.priorAttempts` keyed by a raw tag | **No hits** — the chain never reads prior-attempt records. |
| `JobStatus.awake` as `string[]` | **No hits.** |
| `.flume/rendered-prompts/` / `.flume/merging/` ignored | **Absent.** `.gitignore:37-44` carries `.flume/sessions/`, `.flume/worktrees/`, `.flume/awake/`, `.flume/prior-attempts/`, `.flume/tick-verdict*` — five engine directories, and neither new one. Both will show as untracked on 0.15.0. No `shouldRun` here reads dirtiness, so the cost is cosmetic rather than behavioral (unlike consumer-a). |
| Imports no longer exported by 0.15.0 | **None break.** `chain.ts` imports types plus `Gate` (`:51`) and takes runtime values from the injected `flume` parameter (`:301-308`), per the MIGRATING-0.10 §2 discipline the file cites twice. |
| Typecheck against 0.15.0 | **Not run** — would require a scratch install; survey is read-only. Note the bay is currently 0.11.0-installed against a `^0.12.0` range, so it has an *existing* unvalidated version gap independent of 0.15.0. |

> **§4 verdict: 2 breakages. One is total and loud (the schema-clause assert
> bricks every plan tick, by design, and its correct resolution is to delete the
> patch because the engine adopted the fix); one is silent (`voluntary-bail`
> suppresses the wake plan needs after a clean bail). Typecheck NOT run.**

## 5. What this chain does that flume's own chain does not

**Has, that flume's lacks:**

- **A ledger cap enforced as a reverting gate** (`:119`), with caps chosen per
  file (120 / 220) and a failure message that enumerates what may stay. Flume's
  own chain states register discipline in prose; consumer-c has it a rung up.
- **A per-phase model pin with a written justification for each** (`:471`,
  `:528-538`) — Opus for derivation, Sonnet for verified execution, plus a
  chain-level backstop so a later phase cannot silently inherit the CLI default.
- **A self-containment gate that runs the shipped artifact in a hostile
  environment** (`:162`) — fresh `tmpdir`, no ancestor `node_modules`.
- **Gate ordering as a declared concern** (`:552-554`) — bundle before vitest,
  with the reason.
- **An explicit non-declaration of `capabilities` and `supervisorPolicy`**
  (`:602-607`) that states why the defaults are right here. Most consumers omit
  silently; this one omits on the record.
- **A guarded correction of the engine's own prompt output** (`:281-291`) —
  unique across all consumers, and the mechanism that caught 0.15.0's wording
  change.

**Flume's own chain has, that this lacks:** plan slicing; records as one file
each (single `.flume/inbox.md`, read by an awk span); a `tests[]`/`pins[]`
judge (`tests[]` is declared in `entryExtension` and, as in every other
consumer, **nothing runs it**); a `per`-cite gate (the `per` path is `cat`-ed
into the build prompt at `prompts/build.md:12` but never checked to exist —
consumer-a and consumer-b both added exactly that gate); a clean-tree gate; a
records gate. Also absent relative to its siblings: any `shouldRun`, any
`afterMerge` gate, any friction channel, any telemetry.

**Same notion of "done" as flume's:** no `shipped` predicate, so the engine's
default governs.

**Same spec locus as flume's:** a human-curated `spec/SPEC.md`, which neither
phase may write (`:483-484`), with ambiguity surfaced through
`open-questions.md`. Of all five consumers this is the closest to flume's own
spec→plan→build shape.

## 6. Harness copies

| Artifact | Present? | Verbatim / adapted / original |
| --- | --- | --- |
| `.flume/PROTOCOL.md` | **Yes** | **Adapted.** Cited twice from the chain as a contract — §"State ledgers" (`:112`) and §"Plan continuation marker" (`:504`), and §"Build method" for the `scopeWritesToEntry` position (`:543`). This is the one consumer whose PROTOCOL is load-bearing in chain code rather than prose alone. |
| Plan-slice prompts | No — one `plan.md` (84 lines) | Original |
| `.claude/rules/*` | **Directory absent entirely** | — |
| `.claude/rules/engineering.md` / `engine-boundary.md` / `spec-plan-build.md` | **No** | — |
| `.flume/inbox.md` | Yes, single file (pre-0.15 shape) | Adapted |
| `open-questions.md` | Yes, capped at 220 lines by gate | Adapted |
| `state.md` with cursor lines | Yes — carries `Plan continues:`, read by `handoff` (`:511`); capped at 120 lines by gate | Adapted |

**Verbatim blocks shared with consumer-d** (the two are clearly one lineage):

1. **The plan prompt's first three spans** — `git log --grep='^plan:'`, the
   `$LAST..HEAD` commit/stat window, and the `$LAST..HEAD -- spec/` diff — are
   **character-identical** between `consumer-c/.flume/prompts/plan.md:4,8,12`
   and `consumer-d/.flume/prompts/plan.md:4,8,12` (modulo one em-dash). This is
   the single most-copied block in the survey and it encodes an inference the
   engine could state outright.
2. The inbox awk split (`plan.md:22` ≡ consumer-d `:20`).
3. The `state.md` / `open-questions.md` cat spans.
4. `handoff`'s `Plan continues:` regex + `pendingAfter.some(open)` pair
   (`:502-520` ≡ consumer-d `:943-968`) — including the identical comment
   *"Plan re-wakes itself when state.md ends with `Plan continues: yes`"* and
   the identical `PROTOCOL.md §"Plan continuation marker"` cite.
5. The `writablePaths` comment block explaining that plan does not touch
   `spec/` and that the inbox IS writable because plan drains it.
6. `humanOnly: []` with the identical trailing comment *"no spec phase; SPEC.md
   is edited via normal commits"* (`:601` ≡ consumer-d `:974`).
7. The `per`-narrowing comment in `build.promptArgs` (*"`per` is a declared
   extension field … narrow it through the same schema the gate validated it
   with"*, `:566-567` ≡ consumer-d `:886-888`).

## 7. Operator signal

- **The engine's rendered schema states a fence the engine does not enforce**
  (`:263-273`). The fullest complaint in the survey, and it is costed: the
  unconditional clause *"argues plan into over-declaring `files` defensively,
  which is the exact behavior 0.10 measured costing fanout wave width (3.17 ->
  1.99 at maxParallel 4)."* Shape: *a prompt sentence the engine emits
  unconditionally is false for chains that leave `scopeWritesToEntry`
  undeclared, and the falsehood has a measured throughput cost.* The chain
  corrects it **on the same path** rather than contradicting it in prose,
  because *"the schema block is rendered from one declaration, so the
  correction belongs on the same path"* — and guards the correction with an
  assert so a reword fails loudly. 0.15.0 has since conditioned the sentence
  (`a scoped tick`), which retires the workaround; §4 is where that lands.
- **`entryChannelPaths`-as-ceiling was a load-bearing idiom that 0.11 refused**
  (`:546-548`). Shape: *a pre-0.10 way of buying unscoped behavior stopped
  being accepted, and the migration was to delete it — which changed no path.*
  Recorded as a no-op migration, which is the useful part.
- **`noCommit` made a bail distinguishable from a no-op** (`:580-582`): *"before
  0.8 it was indistinguishable from a genuine no-op, which is why this handoff
  woke plan unconditionally."* An engine surface that demonstrably retired a
  chain workaround — and the one 0.15.0's rename now silently breaks.
- **A gate's line-counting must match the tool agents verify with** (`:127-129`)
  — a bare `split("\n")` *"reverted two legitimately-at-cap commits."* Shape:
  *a budget gate and the agent it governs must count the same way, or the gate
  reverts correct work.*
- **A singleton tick now runs in a worktree too** (`:472-476`, citing
  MIGRATING-0.12 §2). The consequence: plan's prompt shells out to `tsc` and a
  repo script, both needing gitignored `node_modules` absent from a fresh
  worktree — so `setupWorktree` had to be added to the **plan** phase. Shape:
  *a change in where a singleton runs turned prompt spans that always worked
  into spans that need provisioning.*
- **Version drift, unflagged**: `^0.12.0` declared, 0.11.0 installed. Nothing
  in the repo records this, and no gate would catch it. Worth naming to the
  operator independently of the survey.
