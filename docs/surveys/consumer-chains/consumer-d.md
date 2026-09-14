# consumer-d — chain survey

Read 2026-09-14. Every claim verified on disk at that read; `path:line` is
relative to the consumer repository root. Read-only: nothing modified.

consumer-d and consumer-c are **one lineage** — the plan prompt's cursor spans,
the `handoff` shape, and several comment blocks are character-identical between
them (enumerated in §6). consumer-d is the more elaborate of the two.

## 1. Identity and engine version

| | |
| --- | --- |
| Label | `consumer-d` |
| Primary stack | TypeScript / Node; a Postgres-backed service with a bundled CLI, a client package, a design system, and an eval harness |
| Package manager | pnpm |
| Engine dependency | `"@dtmd/flume": "^0.12.0"` (`package.json`) — a range |
| Lockfile resolved | **`0.12.0`** — satisfies the range; manifest and tree agree |
| Install shape | Registry install at the **repo root** manifest |
| State root | `.flume/`, **default root**. No `flume job`. |
| Liveness | `.flume/awake/` empty since mid-May; **cold**. The chain is the most engineered of the five and the loop has not run in months — read the findings below as a snapshot of a mature chain rather than a live one. |

## 2. Chain shape

Chain module: `.flume/chain.ts`, **988 lines**. Two prompts
(`prompts/build.md` 43 lines, `prompts/plan.md` 144 lines). No helper scripts
under the state root.

### Phases

| | `plan` | `build` |
| --- | --- | --- |
| Concurrency | `singleton` (`:913`) | `fanout` (`:764`) |
| Prompt | `prompts/plan.md` (`:912`) | `prompts/build.md` (`:763`) |
| Agent | **Opus** (`:914`, *"derivation + judgment"*) | **Sonnet** (`:765`, *"mechanical implementation under gates"*) |
| `writablePaths` | 4 literals (`:916`) with a 14-line comment explaining why `spec/` is excluded and the inbox included | A **long, commented, category-grouped list** (`:774-863`): source, migrations, tests, examples, scripts, eval, package metadata, config-file globs, and `.claude/skills/**` |
| `entryChannelPaths` | not declared | not declared |
| **`scopeWritesToEntry`** | n/a | **`true` (`:773`) — the only consumer in the survey that scopes writes to the entry.** The rationale (`:766-772`) is the strongest argument for it anywhere: *"build's fanout disjointness is computed from declared `files` — without narrowing, two entries the partition treats as disjoint could write the same file inside the wide ceiling. An under-declared entry reverts, which is the honest failure."* consumer-a and consumer-c both explicitly decline this with the opposite argument. |
| `shouldRun` | not declared | not declared |
| `shipped` | n/a | not declared |
| `promptArgs` | yes (`:940`) — 1 token | yes (`:882`) — 4 tokens |
| `setupWorktree` | yes (`:915`) — `planSetupWorktree` | yes (`:880`) — `buildSetupWorktree` |
| **`teardownWorktree`** | not declared | **yes (`:881`) — the only consumer declaring one** |
| `handoff` | `:943` | `:897` — unconditional `["plan"]` |

### Gates

| Gate | `when` | Builtin / chain-authored | What it judges |
| --- | --- | --- | --- |
| `pendingGate` | default | builtin (`:939`) | `targetFence: build`, `extension: entryExtension` |
| `tscGate` | `afterCommit` | builtin (`:872`) | |
| `biome check` | `afterCommit` | **chain-authored** (`:615`) | Changed files formatted + lint-error-free |
| `ds:lint` | `afterCommit` | **chain-authored** (`:666`) | Design-system adherence, via `ast-grep` |
| `bin/<cli> runs without node_modules` | `afterCommit` | **chain-authored** (`:135`) | Bundle self-containment — the same gate consumer-c carries |
| `worktree node_modules resolves vitest` | `afterCommit` | **chain-authored** (`:481`) | A **sentinel gate**: fails loud when a dependency stops resolving from the worktree root |
| `vitest` | **`afterMerge`** (`:877`, `{...vitestGate, when: "afterMerge"}`) | builtin, `when` overridden | |
| `client: tsc + vitest` | `afterCommit` | **chain-authored** (`:529`) | The client package's own typecheck and suite |

Seven gates on build. The `afterMerge` override on vitest carries the survey's
most specific performance finding (`:864-870`): *"N concurrent build worktrees
each running the full suite saturates CPU and bcrypt-cost tests … time out at
vitest's 5s default, reverting commits that aren't actually broken. Post-merge,
one serial vitest run validates the whole wave; failure reverts the wave as a
unit. The cheap structural checks … stay `afterCommit` for fast per-job
feedback."* A deliberate two-tier gate schedule, reasoned from a measured
failure.

### Worktree lifecycle — unique to this consumer

`buildSetupWorktree` (`:231`) links `.env` into the worktree and then
**provisions a per-worktree Postgres database** (`:249-251`), named by
sanitizing the entry tag (`:312-313`). `buildTeardownWorktree` (`:262`) drops
it. There is additionally a **reaper** (`:426-470`) with a `REAPER_SAFELIST`
that walks `.flume/worktrees/` and cleans databases orphaned by worktrees that
no longer exist.

`planSetupWorktree` (`:292`) exists for the same reason consumer-c's does: the
plan prompt shells out to `tsc`, `biome`, and `knip`, all needing
`node_modules` absent from a fresh singleton worktree.

`loadPgPool` (`:364`) carries a platform scar worth quoting: it builds a
`createRequire` from `import.meta.url.split("?")[0]` because otherwise the
specifier carries a `tsx` namespace query string and *"fail[s]
setup/teardownWorktree on every"* run (`:361`).

### Chain-level declarations

`entryExtension` (`:64`) — **5 fields**: `summary` (≤200 — the tightest cap of
any consumer), `per`, `tests[]`, `acceptance`, `notes` (≤500, optional).
`humanOnly: []` (`:974`). **`capabilities: []` (`:980`)** — declared empty on
purpose, with a four-line comment (`:975-979`) explaining that the one
`requiresCapability: docker-host` entry stays skipped and that asserting the
capability *"would only make it a failing pick"* because the entry also needs
credentials the loop lacks. No `supervisorPolicy`, no `seedDir`, no `friction`.

Factory returns `{ chain, agent: planAgent }` (`:985`) — the same
chain-level backstop idiom as consumer-c.

### `handoff` shape

**build** (`:897`): unconditional `["plan"]`, reading **no `TickResult` field
at all** (the parameter is `_result`). The comment (`:898-903`) argues this is
correct rather than lazy: *"Even no-op build waves may have uncovered surface
that plan should know about … plan reads the delta itself and decides."*
This is the opposite conclusion from consumer-c's sibling handoff, which added
a hibernation path off `noCommit` — and it means consumer-d is the one consumer
0.15.0's `voluntary-bail` rename cannot break in `chain.ts`.

**plan** (`:943`): `state.md` regex for `Plan continues: yes` → `["plan"]`;
else `result.pendingAfter.some(e => e.gate.kind === "open")` → `["build"]` or
`[]`. Character-identical to consumer-c's.

## 3. Engine facts the chain re-derives

| # | Site | What it re-derives | Covered by 0.15.0? |
| --- | --- | --- | --- |
| 1 | `.flume/chain.ts:49` | `CHAIN_DIR` from `import.meta.url` at module scope; used by `handoff` (`:953-955`) | **Covered** — `FlumeApi.paths`. Same module-scope lifecycle gap as every other consumer. |
| 2 | `.flume/chain.ts:957` | `handoff` reads `state.md` and regexes `/^Plan continues:\s*yes\b/im` | **Genuinely absent** — a chain-owned continuation signal, cited to a local `PROTOCOL.md` §"Plan continuation marker" (`:949-950`). Identical to consumer-b #11 and consumer-c #3. **Three of five consumers carry this.** |
| 3 | `.flume/chain.ts:964-966` | `result.pendingAfter.some(e => e.gate.kind === "open")` — the hand-rolled pickability test | **Covered** — `TickResult.pickableAfter`. Not adopted; the known live-lock consumer-a and consumer-b both documented. |
| 4 | `.flume/chain.ts:459-461` | The reaper reads `.flume/worktrees/` directly — an **engine-owned directory** | **Genuinely absent.** The engine owns worktree provisioning and naming but reports no inventory of live worktrees, so a chain that allocates an external resource per worktree must enumerate the engine's own directory to find orphans. **The only instance in the survey of a chain reading an engine-owned directory.** |
| 5 | `.flume/chain.ts:312-313` | `entryTag.toLowerCase().replace(/[^a-z0-9_]+/g, "_")` — a **slug rule for an entry tag**, hand-rolled | **Covered** — `slugify` is exported from flume's `src/index.ts:68`. The chain's variant differs (underscores, not hyphens) because it must be a valid Postgres identifier, so the engine's rule would not serve as-is — but the *need* to derive a stable per-entry name from a tag is a fact the engine already owns. |
| 6 | `.flume/chain.ts:336-342` | Reads and parses `.env` by hand to recover `DATABASE_URL` | **Uncovered**, and outside the engine's business. |
| 7 | `prompts/plan.md:4,8,12` | `git log --grep='^plan:'` → `$LAST..HEAD` window for commits, stats, and a `spec/` diff | **Uncovered, and it is an inference** — identical to consumer-c #5, character-identical source. |
| 8 | `prompts/plan.md:16` | `cat .flume/plan/pending.json` raw into the prompt | **Covered** — `TickContext.pending`. Cruder than consumer-c's `node -e` digest: the whole queue file goes into every plan render. |
| 9 | `prompts/plan.md:20` | `awk '/^---$/{found=1; next} found' .flume/inbox.md` | **Uncovered** — identical to consumer-c #7. |
| 10 | `prompts/plan.md:32,36,40` | `pnpm tsc --noEmit`, `pnpm exec biome lint`, `pnpm exec knip` — **three live tool invocations inside render spans** | **Uncovered.** All three `\|\| true`-guarded so they cannot abort the render. Notable: `plan.md:45` (see §7) tells the agent these blocks are *fresher than any prior narrative* and must be used to re-check a prior bail's premise — so the spans are load-bearing prompt input, not decoration. |

**Inline-exec spans: 12 total** (10 in `plan.md`, 2 in `build.md`) — the most
of any consumer. **None reads an engine-owned artifact from a span**; the one
engine-directory read is in `chain.ts` (#4).

**Agent-output re-parsing:** none. **Gate-message text matching:** none.
**Reading a file at a sha by hand:** none.

> **§3 verdict: 10 re-derivations. 4 are already covered by a 0.15.0 surface
> (#1, #3, #5, #8) — #3 being the known live-lock. 6 are genuinely absent: a
> continuation signal (#2), a live-worktree inventory (#4), and four chain-owned
> shell reads (#6, #7, #9, #10).**

## 4. What 0.15.0 breaks

| Check | Result |
| --- | --- |
| `voluntary-bail` string | **2 hits, both in prompt prose, both breaking as documentation.** `prompts/build.md:25` and `prompts/plan.md:45` each enumerate the no-commit taxonomy to the agent: *"(gate-revert, voluntary-bail, or platform-preempt)"*, then explain what each mode means and how to respond. Under 0.15.0 the engine injects `clean-exit`, which **neither prompt names** — so a retry tick receives a `<prior-attempt>` block tagged with a mode its own instructions do not cover, while the instructions describe a mode that can no longer appear. `plan.md:45` is the worse of the two: it gives a specific, valuable directive for that mode (*"before re-bailing on the same ground, verify the premise against the live `<knip>` / `<biome-lint>` / `<tsc>` blocks, which are fresher than any prior narrative"*) that will now never fire. Both prompts also predate the taxonomy's fourth member, `render-refused`. **No type error, no gate failure — the prompts simply stop matching reality.** |
| Record's `constraint` → `finalMessage` | Not read in `chain.ts`. `prompts/build.md:25` says a clean bail *"refused a constraint"* — prose that tracked the old field name and now names nothing. |
| Direct `writablePathsGate(...)` call | **No hits.** |
| `ctx.priorAttempts` keyed by a raw tag | **No hits** in `chain.ts` — prior attempts reach this chain only through the engine's own `<prior-attempt>` prompt injection, which is why the breakage lands in the prompts rather than the code. |
| `JobStatus.awake` as `string[]` | **No hits.** |
| `.flume/rendered-prompts/` / `.flume/merging/` ignored | **Absent.** `.gitignore:52-56` carries `.flume/.awake`, `.flume/.lock`, `.flume/awake/`, `.flume/worktrees/`, `.flume/sessions/` — five entries, two of them (`.awake`, `.lock`) from an engine version this consumer no longer runs. Neither new directory is named; both will show as untracked. No `shouldRun` reads dirtiness, so cosmetic. |
| Imports no longer exported by 0.15.0 | **None.** Runtime values come from the injected `api` parameter (`:698-699`). |
| Typecheck against 0.15.0 | **Not run** — scratch install required; survey is read-only. One flag for whoever does run it: `scopeWritesToEntry: true` (`:773`) is the only use of that field in the survey, so consumer-d is the only consumer whose migration would exercise whatever 0.15.0 changed about scoped-write behavior. |

> **§4 verdict: 1 breakage, in prose rather than code — both prompts teach a
> no-commit taxonomy that 0.15.0 renamed one member of and added a fourth to,
> so retry ticks get an unexplained mode and lose a directive. `chain.ts` is
> clean, because its build `handoff` reads no `TickResult` field at all.
> Typecheck NOT run.**

## 5. What this chain does that flume's own chain does not

**Has, that flume's lacks:**

- **A full worktree resource lifecycle** — `setupWorktree` provisions a
  per-entry Postgres database, `teardownWorktree` drops it, and a **reaper**
  (`:426`) with a safelist collects databases orphaned by worktrees that no
  longer exist. No other consumer surveyed allocates an external resource per
  fanout arm, and flume's own chain has no `teardownWorktree` at all.
- **A sentinel gate for worktree dependency resolution** (`:481`) — fails loud
  when `vitest` stops resolving from the worktree root, rather than letting the
  failure surface as an unrelated test error.
- **A two-tier gate schedule** (`:864-877`) — cheap structural checks
  `afterCommit` for per-job feedback, the expensive suite `afterMerge` once per
  wave, with the CPU-saturation measurement that motivated it.
- **`scopeWritesToEntry: true`** (`:773`) with the partition-correctness
  argument — the only consumer to turn it on.
- **A design-system lint gate driven by `ast-grep`** (`:666`) — structural, not
  textual.
- **A separate package's typecheck and suite as its own gate** (`:529`).
- **`capabilities: []` declared with a written reason** (`:975-980`) — an
  environment-gated entry deliberately left unpickable because the capability
  alone would not make it runnable.
- **Live tool output as prompt input, declared fresher than narrative**
  (`plan.md:32,36,40` + `:45`).

**Flume's own chain has, that this lacks:** plan slicing; records as one file
each (single `.flume/inbox.md`); a `tests[]`/`pins[]` judge — `tests[]` is
declared (`:17`) and, **as in all five consumers, nothing runs it**; a
`per`-cite gate; a clean-tree gate; a records gate; a posture sweep. Also
absent relative to its siblings: any `shouldRun`, a friction channel,
telemetry, a ledger cap (consumer-c has one), or any `supervisorPolicy`.

**Same notion of "done" as flume's:** no `shipped` predicate.

**Same spec locus as flume's, and the richest of the five:** a human-curated
`spec/` corpus — `SPEC.md`, `AUTH.md`, `CLIENT.md`, `COMPILE.md`,
`DATA-MODEL.md`, `DECISIONS.md`, `DESIGN-SYSTEM.md`, and more — which neither
phase may write (`:921-924`). This is the closest structural match to flume's
own `spec/*.md` topic-file corpus.

## 6. Harness copies

| Artifact | Present? | Verbatim / adapted / original |
| --- | --- | --- |
| `.flume/PROTOCOL.md` | **Yes** | **Adapted**, and cited from `chain.ts` (`:949-950`) |
| Plan-slice prompts | No — one `plan.md` (144 lines) | Original |
| `.flume/inbox.md` | Yes, single file (pre-0.15 shape) | Adapted |
| `open-questions.md` | Yes | Adapted |
| `state.md` with cursor lines | Yes — carries `Plan continues:`, read by `handoff` | Adapted |
| **`.claude/rules/`** | **Yes — 10 files, four of them forks of flume's own** | See below |
| `.claude/rules/engineering.md` | **No** | — |
| `.claude/rules/engine-boundary.md` | **No** | — |

**This is the only consumer carrying flume's own rule pages, and they are
forks that have drifted.** Structure verbatim, domain nouns swapped:

| Page | flume | consumer-d | What differs |
| --- | --- | --- | --- |
| `code-navigation.md` | 43 lines | 44 lines | **Structure verbatim.** Only the `ast-grep` example patterns are swapped for domain ones, the "when to skip LSP" bullets name this stack's file types, and the binary is version-pinned (`0.42.2`) where flume's says "when installed" |
| `collaboration.md` | 60 lines | 50 lines | Same sections; consumer-d's is **flume's pre-*Complexity is a signal* / pre-*Match prose to the medium* version** — it has not taken the last two sections flume added |
| `memory.md` | 30 lines | 29 lines | **Structurally verbatim, factually stale.** consumer-d's "What lives in the repo" table still names `.flume/inbox.md` (single file) and says *"`open-questions.md` doubles as cross-tick scratch space."* flume's now names `.flume/inbox/` and `.flume/plan/notes/<TAG>.md` and says *"`open-questions.md` is plan's alone"* — the 0.15 records-are-one-file-each change. The fork is one engine minor behind on a rule that describes engine-adjacent structure. |
| `spec-plan-build.md` | 24 lines | 58 lines | Most diverged — same table-plus-directives shape, expanded with this consumer's own lanes |

Plus six original domain rules (`cite-freshness`, `cli-bundle`,
`frontend-design`, `lint`, `prompt-quality`, `test-iteration`).

**Verbatim blocks shared with consumer-c** — same lineage, and each is a
candidate config field rather than a copied block:

1. **The plan prompt's three cursor spans** (`plan.md:4,8,12` ≡ consumer-c
   `:4,8,12`) — character-identical modulo one em-dash. The single
   most-copied block in the survey.
2. The inbox awk split (`plan.md:20` ≡ consumer-c `:22`).
3. The `state.md` / `open-questions.md` `cat` spans.
4. `handoff`'s `Plan continues:` regex + `pendingAfter.some(open)` pair
   (`:943-968` ≡ consumer-c `:502-520`), including the identical comment and
   the identical `PROTOCOL.md §"Plan continuation marker"` cite.
5. The `writablePaths` comment explaining plan does not touch `spec/` and the
   inbox is writable because plan drains it (`:921-933` ≡ consumer-c `:483-484`,
   expanded here).
6. `humanOnly: []` with the identical trailing comment *"no spec phase; SPEC.md
   is edited via normal commits"* (`:974` ≡ consumer-c `:601`).
7. The `per`-narrowing comment in `build.promptArgs` (`:886-888` ≡ consumer-c
   `:566-567`).
8. The bundle-self-containment gate concept and shape (`:135` ≡ consumer-c
   `:162`).
9. The chain-level-agent-backstop return idiom (`:983-985` ≡ consumer-c
   `:610-616`).

## 7. Operator signal

- **`tsx`'s namespace query string breaks `createRequire`** (`:361-364`): the
  specifier arrives as `'node:events?tsx-namespace=…'`, *"failing
  setup/teardownWorktree on every"* run. Worked around with
  `import.meta.url.split("?")[0]`. Shape: *the engine loads chains under `tsx`,
  and that loader's URL decoration leaks into any chain that needs
  `createRequire`.* This is a platform fact no consumer should have to
  rediscover.
- **Concurrent fanout worktrees saturate CPU and produce false gate failures**
  (`:864-870`) — timing-sensitive tests time out at vitest's 5s default and
  *"revert[] commits that aren't actually broken."* Worked around by moving the
  suite to `afterMerge`. Shape: *`maxParallel` governs agent concurrency, but
  nothing governs the resource cost of N concurrent gate runs, and the failure
  presents as a broken commit rather than a saturated machine.*
- **The engine reports no inventory of live worktrees** (`:426-470`). A chain
  allocating an external resource per worktree must enumerate
  `.flume/worktrees/` itself and maintain a safelist to avoid reaping the
  wrong thing. Shape: *the engine owns worktree lifecycle but the chain owns
  what hangs off it, and the two have no shared list.*
- **The no-commit taxonomy is taught to agents in prompt prose**
  (`build.md:25`, `plan.md:45`). Both prompts enumerate the modes, explain
  each, and give per-mode instructions. Shape: *the engine injects
  `<prior-attempt>` with a mode the prompt must independently know how to
  describe, so every consumer hand-maintains a copy of the taxonomy — and the
  copy goes stale on rename, silently.* This is §4's breakage, and the
  strongest argument in the survey for the taxonomy shipping as renderable
  prose the engine owns.
- **`capabilities` is not the right lever for an entry needing credentials**
  (`:975-979`): asserting `docker-host` *"would only make it a failing pick"*
  because the entry also needs tokens the loop lacks. Shape: *capability gating
  is one-dimensional; an entry can be unrunnable for reasons the capability
  vocabulary cannot express, and the honest answer was to declare nothing.*
- **A pre-0.10 entry-scoped fence was worth restoring** (`:766-772`) — the only
  consumer to adopt `scopeWritesToEntry`, and the reasoning is a correctness
  argument about the partition, not a preference: without narrowing, *"two
  entries the partition treats as disjoint could write the same file inside the
  wide ceiling."* Worth weighing against consumer-a's and consumer-c's opposite
  conclusion; the two positions are not reconcilable by taste, and the engine
  currently lets both stand with no guidance.
- **Ignore-file residue from a retired engine version** (`.gitignore:52-53`):
  `.flume/.awake` and `.flume/.lock` are names this consumer's engine no longer
  writes. Nothing retires them. Minor, but it is the same class as §4's
  seeded-directory gap: consumers hand-maintain an ignore list against an
  engine-owned set of paths, and neither direction is checked.
