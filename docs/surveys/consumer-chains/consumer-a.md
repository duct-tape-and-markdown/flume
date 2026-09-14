# consumer-a — chain survey

Read 2026-09-14 against the consumer's working tree at its then-HEAD. Every
claim below was verified on disk at that read; `path:line` is relative to the
consumer repository root. Read-only: nothing in the consumer was modified.

## 1. Identity and engine version

| | |
| --- | --- |
| Label | `consumer-a` |
| Primary stack | C# / .NET (solution build via `dotnet build`), plus Node tooling under the state root |
| Package manager | pnpm, pinned `pnpm@11.1.2` (`.flume/package.json:2`) |
| Engine dependency | `"@dtmd/flume": "0.14.0"` — exact, not a range (`.flume/package.json:8`) |
| Lockfile resolved | `0.14.0` (`.flume/pnpm-lock.yaml`, `specifier: 0.14.0` / `version: 0.14.0`) — manifest and lock agree |
| Install shape | Installed from the registry, not vendored or path-linked. The engine is a devDependency of a **nested** manifest at `.flume/package.json`, not of the repo root, so the state root is its own pnpm project (`.flume/pnpm-workspace.yaml`, `.flume/tsconfig.json`) |
| State root | `.flume/` for the chain and prompts; **job mode** — live state roots are `.flume/jobs/<name>/` |
| Jobs | `flume job` is the operating mode, not the default root. One job present at read time, under `.flume/jobs/<job>/`. A job seed template lives at `.flume/job-seed/` (`brief.md`, `inbox.md`, `plan/{pending.json,state.md,open-questions.md}`, `friction/`, `pending-query.mjs`), declared to the engine as `seedDir: "job-seed"` (`.flume/chain.ts:906`) |

Note on the read: the one live job's directory carried only engine-written
material (`awake/`, `friction/`, `metrics.jsonl`, `sessions/`,
`tick-verdict.json`, `tick-verdicts.jsonl`) and **no `plan/` subtree**, so the
job was either freshly mounted or drained at read time. §7's operator signal
is therefore drawn from the chain module and `.flume/README.md` rather than
from a live `open-questions.md`.

## 2. Chain shape

Chain module: `.flume/chain.ts`, **940 lines**. Two prompt files
(`.flume/prompts/build.md`, 91 lines; `.flume/prompts/plan.md`, 176 lines).
**Zero helper scripts under the state root** — the only `.ts`/`.mjs` beside
the chain is `job-seed/pending-query.mjs`, which is seed template content
copied into a new job, not a chain-invoked script.

### Phases

| | `plan` | `build` |
| --- | --- | --- |
| Concurrency | `singleton` (`:834`) | `fanout` (`:710`) |
| Prompt | `prompts/plan.md` (`:833`) | `prompts/build.md` (`:709`) |
| `writablePaths` | getter: 4 bay-wide literals + the job's declared `planWritablePaths` + `frictionGlob` (`:843`, via `planArtifacts()` `:672`, `PLAN_WRITABLE` `:269`) | getter: the job declaration's `writablePaths` + `openQuestions` + `frictionGlob` (`:750`, via `commitFence()` `:701`) |
| top-level dirs covered | `.flume/**` only (`plan/pending.json`, `plan/state.md`, `plan/open-questions.md`, `inbox.md`, `friction/**`) | job-declared — arbitrary repo source, plus the `.flume/` channel paths |
| `entryChannelPaths` | not declared | not declared |
| `scopeWritesToEntry` | n/a | **deliberately undeclared** (`:711-713`) — comment cites MIGRATING-0.10 §6: the fence is the declaration's standing phase contract, an entry's `files` is a partition prediction, not an allowance |
| `shouldRun` | yes (`:839`) — `!planShapedHead() \|\| jobRootDirty()` | yes (`:728`) — the "zombie brake" |
| `shipped` | n/a | yes (`:763`) — ships when any non-channel path was touched, or the entry declared `channelOnly: true` |
| `promptArgs` | yes (`:865`) — 6 tokens | yes (`:781`) — 6 tokens |
| `setupWorktree` | not declared | yes (`:770`) — declared `setupDirs` installs + a PowerShell restore script |
| `teardownWorktree` | not declared | not declared (friction harvest is the engine's, via `friction: "friction"`) |
| `handoff` | `:896` | `:821` |

### Gates

| Gate | `when` | Builtin / chain-authored | What it judges |
| --- | --- | --- | --- |
| `pendingGate` | engine default | builtin (`:850`) | Parses `pending.json` under `entryExtension`; `targetFence` is a getter onto `commitFence()`, `fenceWhen` scopes the pre-check to `gate.kind === "open"`; carries a `hint` steering re-scope rather than fence-widening |
| `per-paths-exist` | `afterCommit` | **chain-authored** (`:538`) | Stats every open entry's `per.path` against the checked-out tree; refuses a plan commit that queues an entry pointing at a file that does not exist |
| `dotnet-build` | `afterCommit` | `shellGate` builtin, chain-configured (`:458`) | `dotnet build <solution> --no-restore`; the only member of the named-gate registry `GATES` (`:468`) |
| *(declared, per job)* | `afterCommit` \| `afterMerge` | either | A job's `declaration.json` may select a `GATES` name, an inline shell gate (`cmd`+`args`), or a **script gate** — `node <script> --commit <sha> [...args]` in the tick's worktree, exit 0 = proof holds (`scriptGate`, `:489`) |

Every verify gate is wrapped in `skipChannelOnly` (`:475`): a commit whose
`touchedPaths` are all channel paths skips the gate rather than running a
cold build against no build inputs.

### Chain-level declarations

| Field | Value |
| --- | --- |
| `pendingPath` | not declared (engine default) |
| `seedDir` | `"job-seed"` (`:906`) |
| `friction` | `"friction"` (`:908`) |
| `humanOnly` | `[]` (`:904`) |
| `entryExtension` | **6 fields** (`:160`): `summary` (≤300), `per` (`{path, section}` strict), `acceptance` (≤1600), `tests[]` (`{path, asserts}`), `notes` (≤800), `channelOnly` (optional boolean) |
| `supervisorPolicy.maxParallel` | `4` (`:912`) |
| `supervisorPolicy.partitionIgnore` | one entry, a shared tool's `lock.toml` (`:919`) — a universally re-pinned file excluded from the collision set so the partition does not serialize every wave to one entry |
| `supervisorPolicy.tickTimeoutMs` | getter (`:927`): declared `tickTimeoutMinutes` else **55 min**, derived from 374 measured invocations across seven jobs (max 21.3 min, median 4.0, p90 12.2) |
| Agent assignment | Per phase, from the job declaration's `agents.{plan,build}` selecting a name out of a registry `{sonnet, opus, haiku}` (`:449`); absent means `sonnet` (`:456`). An unknown name **refuses the tick** rather than falling back (`:651`) |
| Agent extra args | `["--strict-mcp-config"]` on every agent (`:434`) — tick agents boot no user-level MCP servers; comment cites a wedged MCP child that held a finished agent open and stalled a wave |
| Agent decorator stack | `withTerminalRenderer(withSessionCapture(claudeCode({outputFormat:"stream-json"})))` (`:424`), then `withTickMetrics` outermost in `agentFor` (`:696`) |

### `handoff` shape

**build** (`:821`) reads `result.nothingPickable`, `result.noCommit`
(`platform-preempt`, `render-refused`), and otherwise falls through to the
chain's own `planShapedHead()`. Wakes `["plan"]` only when HEAD is not
plan-shaped; hibernates (`[]`) on every no-work outcome. The comment
(`:803-820`) reasons explicitly that the engine's `nothingPickable` and
`noCommit` are *trusted first* over the chain's own git predicate, with
`planShapedHead()` kept only as belt-and-suspenders for a future `noCommit`
member.

**plan** (`:896`) reads `result.pickableAfter` — wakes `["build"]` when
non-empty. Comment (`:891-895`) records the migration from `pendingAfter` to
`pickableAfter` and the live-lock it fixed (a quarantined open entry made
plan↔build ping-pong forever).

## 3. Engine facts the chain re-derives

| # | Site | What it re-derives | Covered by 0.15.0? |
| --- | --- | --- | --- |
| 1 | `.flume/chain.ts:50` | Resolves the state root itself: `process.env.FLUME_DIR ?? dirname(fileURLToPath(import.meta.url))` at **module scope** | **Covered** — `FlumeApi.paths` carries the identity-same values. The chain *knows*: `:38-49` is a 12-line comment explaining that `paths` is only reachable inside the factory closure, and that five module-scope consumers (`flumeDirRel`, the `FLUME_WORKTREES_DIR` side effect, `jobRootDirty`, `openFriction`, `SESSIONS_DIR`/`METRICS_PATH`) run before the factory exists or are closed over from outside it. **This is a lifecycle gap, not an absent fact**: the surface exists but is not reachable at the time the chain needs it. |
| 2 | `.flume/chain.ts:53` | `repoRoot` from the chain file's own location | **Covered** — `paths.repoRoot` (used correctly at `:681`, `:738`). Same module-scope lifecycle gap as #1. |
| 3 | `.flume/chain.ts:70-78` | Shells `git rev-parse --path-format=absolute --git-common-dir` to compute a fanout worktree base, then sets `FLUME_WORKTREES_DIR` | **Uncovered as a hook.** The engine takes the value by env var, which forces module-scope execution before any hook fires (`:66-67` says so). There is no declared chain field for the worktree base. |
| 4 | `.flume/chain.ts:284` | `jobRootDirty()` — `git status --porcelain -- <flumeDirRel>` | **Uncovered.** No engine surface reports whether the state root is dirty. |
| 5 | `.flume/chain.ts:305` | `openFriction()` — `readdirSync` of the engine-owned `friction/` directory, names only | **Uncovered.** The engine owns the friction channel (`friction: "friction"`, `:908`) and harvests it, but does not report the open notes to a prompt. The chain reads the engine's own directory directly. Comment (`:298-302`) prices the gap: one redo at \$6.85. |
| 6 | `.flume/chain.ts:361` | `withTickMetrics` re-scans raw stdout for the `result` event to recover `total_cost_usd` | **Partially covered.** `AgentResult.usage` (`AgentUsage`) carries turns / duration / tokens and is read here (`:360`), but **has no cost field** — `total_cost_usd` is parsed off the `result` event by the terminal renderer (flume `src/Agent.ts:662`) and dropped. This is the one field forcing a raw-stdout scan. The comment at `:355-359` states exactly this. |
| 7 | `.flume/chain.ts:560` | `git show <sha>:<stateRootRel>/plan/pending.json` by hand inside `perPathsExist` | **Covered** — `FlumeApi.git.readFileAtRef` (flume `src/flumeApi.ts:136`). Not adopted; the chain is on 0.14.0. |
| 8 | `.flume/chain.ts:680` | `planShapedHead()` — `git diff-tree --no-commit-id --name-only -r HEAD` | **Covered for the read** — `FlumeApi.git.showNameOnly` (flume `src/flumeApi.ts:184`). **Uncovered for the conclusion**: the predicate infers *which phase authored HEAD* from the commit's touched paths. The chain declares this deliberately (`:251-261`) and names the adversarial finding it survives (a build rescope commit and an operator inbox commit must not masquerade as plan's restamp), closing with "Engine-anchored variant pending flume#12." |
| 9 | `.flume/chain.ts:732-742` | `shouldRun` reads `prior-attempts/<slug>.json` off disk, casts `{mode?: string}`, and compares the record's **mtime** against `git log -1 --format=%ct` | **Path covered, shape not.** `priorAttemptPath` is the engine's own rule and is used (`:732`) — the chain migrated to it (`flume#11`, `:721`). But the record's *shape* stays engine-private, so `mode` is a hand cast and the staleness test is an mtime heuristic. The comment (`:722-725`) notes that flume 0.13's `headSha`/`at` fields could replace the mtime comparison with a direct state check, **not adopted**. |

**Prompt inline-exec spans: none.** A search for the inline-exec span opener
across `.flume/prompts/*.md` returns no hits in either prompt file. This is a
stated design position, not an accident — `.flume/chain.ts:878-879`:
*"Injected whole, never via inline-exec spans: no per-render shell spawns, and
a missing file is a fallback, not a render abort."* All four prose inputs
(`STATE`, `OPEN_QUESTIONS`, `INBOX`, `PENDING_DIGEST`) are read in `promptArgs`
through `readOr` (`:242`), which degrades to a named fallback string.

**Pickability / quarantine re-derivation: none.** The chain reads
`result.pickableAfter` (`:897`) and `result.nothingPickable` (`:822`) rather
than re-running the decision. `ctx.pending` is consumed directly for the plan
digest (`:869`), with the comment noting this *replaces* a per-render `node -e`
re-parse of `pending.json` (`:866-867`) — a re-derivation already retired.

**Agent-output re-parsing:** one instance, #6 above. **Gate-message text
matching:** none. **Filename/slug rule copying:** none — `priorAttemptPath`
is used (#9). **Commit-shape inference:** one instance, #8 above, declared.

> **§3 verdict: 9 re-derivations. 5 are already covered by a 0.15.0 surface
> (#1, #2, #7, #8-read, #9-path), two of those blocked by a module-scope
> lifecycle gap rather than an absent API. 4 are genuinely absent from the
> engine: the worktree-base hook (#3), a state-root-dirty fact (#4), an
> open-friction report (#5), and a cost field on `AgentUsage` (#6).**

## 4. What 0.15.0 breaks

| Check | Result |
| --- | --- |
| `voluntary-bail` string | **1 hit — breaking.** `.flume/chain.ts:734`: `if (record?.mode !== "voluntary-bail") return true;`. Under 0.15.0 the mode is `clean-exit`, so the comparison never matches, `shouldRun` returns `true` unconditionally, and the **zombie brake silently stops braking**. This is a silent behavioral regression, not a type error — `mode` is a hand cast (`{mode?: string}`), so `tsc` cannot catch it. Highest-severity finding in this consumer. |
| Record's `constraint` → `finalMessage` | Not read. The chain casts only `{mode?: string}` (`:733`), so the rename is inert here. |
| Direct `writablePathsGate(...)` call | **No hits.** The only occurrence is the word inside a comment (`.flume/chain.ts:544`), naming it as an example of an engine-owned gate that declares no `command`. |
| `ctx.priorAttempts` keyed by a raw tag | **No hits.** The chain never touches `ctx.priorAttempts`; it reads the record off disk via `priorAttemptPath(ctx.flumeDir, entry.tag)` (`:732`), which applies the engine's own slug rule. Not a breakage. |
| `JobStatus.awake` as `string[]` | **No hits.** No `.awake` consumer in `chain.ts` or either prompt. |
| `.flume/rendered-prompts/` or `.flume/merging/` in an ignore file | **Absent.** The repo-root `.gitignore` carries four `.flume/**` rules (`:26-29`: `sessions/`, `metrics.jsonl`, `tick-verdict.json`, `tick-verdicts.jsonl`) and names neither directory. `.flume/.gitignore` exists but is 8 bytes. On 0.15.0 both are seeded at loop start, so **both will appear as untracked** in the primary checkout. This matters more here than elsewhere: the chain's `jobRootDirty()` (`:284`) tests `git status --porcelain -- .flume` and admits a tick whenever it is non-empty — two permanently-untracked engine directories under the state root make `jobRootDirty()` **permanently true**, which pins `plan.shouldRun` (`:839`) to always-admit and defeats the decline. Second breakage, and it is a loop-economics one. |
| Imports no longer exported by 0.15.0 | **None.** The chain imports 8 types (`Agent`, `Chain`, `ChainFactory`, `EntryExtension`, `Gate`, `Phase`, `TickContext`, `TickResult`, `:14-23`) — all still exported from flume's `src/index.ts`. Runtime values come through the injected `FlumeApi` (`:400-412`: `claudeCode`, `matchesAny`, `parsePending`, `paths`, `pendingGate`, `priorAttemptPath`, `renderSchemaForPrompt`, `setupWorktree`, `shellGate`, `withSessionCapture`, `withTerminalRenderer`), not through static imports, so the import surface is type-only and erased. |
| Typecheck against 0.15.0 | **Not run.** Running it requires installing `@dtmd/flume@0.15.0` into a scratch copy of the consumer's `.flume/` project; the survey is read-only and no scratch install was performed. The import-surface check above was done by reading `src/index.ts` in the flume checkout instead. |

> **§4 verdict: 2 breakages, both silent. (a) the `voluntary-bail` →
> `clean-exit` rename disarms the zombie brake with no type error, because the
> record shape is a hand cast; (b) the newly-seeded `rendered-prompts/` and
> `merging/` directories are unignored here and pin `jobRootDirty()` true,
> defeating `plan.shouldRun`'s decline. Typecheck NOT run.**

## 5. What this chain does that flume's own chain does not

**Has, that flume's lacks:**

- **A per-job declaration layer.** `declaration.json` beside each job's brief,
  validated by a `.strict()` zod schema (`:94`) with members `writablePaths`,
  `planWritablePaths`, `verifyGates`, `setupDirs`, `restore`,
  `tickTimeoutMinutes`, `agents`. The chain declares the *mechanism*; each job
  declares its own fence, gates, agents, and timeout. Flume's own chain
  hardcodes one set. This is the single largest structural difference and is
  the shape a chain package would need to expose.
- **Refusal at mount, with an error that names what is on offer.** Unknown
  gate names (`:643`), unknown agent names (`:651`), and a missing declaration
  (`:602`) each throw with the valid set enumerated. Plus a **cross-field
  refusal**: `restore: false` together with the `dotnet-build` gate is a
  guaranteed revert, refused at mount (`:633`).
- **Lazy declaration reads throughout.** `decl()` (`:594`) reads on first use,
  never at import, because `flume job new` loads the chain before the job dir
  exists; every phase member that depends on it is a **getter** (`:747`,
  `:750`, `:753`, `:840`, `:843`, `:927`). A plain value would make every job
  unmountable.
- **Three gate *forms* resolved from a declaration** (`resolveGate`, `:525`):
  a registry name, an inline shell gate, or a **script gate** running
  PR-governed repo source (`scriptGate`, `:489`). Flume's own chain has named
  gates only.
- **`skipChannelOnly`** (`:475`) — a gate wrapper that skips when every touched
  path is channel.
- **The zombie brake** (`shouldRun`, `:728`) — refusing dispatch of an entry
  whose last attempt bailed against an unchanged world.
- **Multi-model agent registry** (`:449`) with per-job selection.
- **Worktree provisioning with a serialized restore queue** (`:200-237`):
  restores serialize wave-wide because the shared native-package cache is not
  concurrency-safe while cold, and `.then(work, work)` (`:204`) keeps one
  failed restore from poisoning the queue behind it.
- **Cost/token telemetry** (`withTickMetrics`, `:350`) writing `metrics.jsonl`,
  and a `tickTimeoutMs` **derived from that corpus** (`:920-923`).
- **`partitionIgnore`** for a universally re-pinned lockfile (`:919`).

**Flume's own chain has, that this lacks:**

- **Plan slicing.** Flume runs three plan slices (`plan-inbox`, `plan-derive`,
  `plan-sweep`); consumer-a runs **one** `plan` phase doing all of it
  (`:830-832`, described as "the routing pass").
- **Records as one file each.** Flume drains `inbox/<date>-<slug>.md` and
  `plan/notes/<TAG>.md`. consumer-a uses a **single `inbox.md`** (`:273`,
  `:882`) — the pre-0.15 shape — and has no per-entry notes channel; build's
  cross-tick channel is `open-questions.md` plus `friction/`.
- **A `tests[]`/`pins[]` judge.** consumer-a declares a `tests[]` extension
  field (`:176`) but **nothing runs it** — no gate reads it. Flume's chain runs
  the named tests against the merged tree and the base. This is a declared
  field with no enforcing gate: the entry says what it proves and nothing
  checks that it does.
- **A `per`-cite gate.** consumer-a has `perPathsExist` (`:538`), which stats
  that the file exists — it does **not** check the `section` heading resolves
  inside it. Flume's `per` gate cites into `spec/` and `.claude/rules/`.
- **A clean-tree gate** and **a records gate.**

**Different notion of "done":** consumer-a's `shipped` (`:763`) is a **policy**
predicate — any non-channel touch ships, whatever the entry predicted in
`files` — with one declared opt-in exception (`channelOnly: true`). The comment
(`:756-762`) is explicit that this is policy, not path-diff, and that the
alternative (inferring intent from `touchedPaths` alone) was rejected.

**Different spec locus:** there is no `spec/`. `per.path` points at "the brief
or spec that justifies this work" (`:170`) — per-job briefs, not a repo-wide
corpus. Domain rules live in `.claude/rules/` (13 files), none of which are
flume harness copies.

## 6. Harness copies

| Artifact | Present? | Verbatim / adapted / original |
| --- | --- | --- |
| `PROTOCOL.md` | **No.** Absent from `.flume/`. | — |
| `.flume/README.md` | Yes | **Original.** Operator documentation for the jobs bay — install, mount, run. Opens with an explicit "static — hand-authored" marker. Covers pnpm/corepack pinning, the no-`--`-separator argument convention, the workspace file approving esbuild's build script so tsx can load `chain.ts` at all, and a chain-load-failure triage note. None of this exists in flume's own repo; it is the missing *operator* manual, written once per consumer. |
| Plan-slice prompts | **No.** One `plan.md` (176 lines), not three slices. | Original |
| A plan discipline file | **No** separate file — discipline is in `prompts/plan.md` and the chain's doc comments. | — |
| `.claude/rules/engineering.md` | **No** | — |
| `.claude/rules/engine-boundary.md` | **No** | — |
| `.claude/rules/spec-plan-build.md` | **No** | — |
| `.claude/rules/*` | 13 files, all **domain** rules. One is named `protocol.md`, but it is a domain protocol, not flume's `PROTOCOL.md`. | Original, none flume-derived |
| `open-questions.md` | Yes, as a **seed template** (`.flume/job-seed/plan/open-questions.md`) instantiated per job | Adapted |
| `state.md` with cursor lines | Yes, as a seed template (`.flume/job-seed/plan/state.md`); the chain treats it as **the unforgeable plan signature** (`PLAN_LEDGER`, `:263`) | Adapted — and load-bearing in a way flume's is not |

**Reading:** consumer-a is the *least* verbatim-copied consumer of its harness
prose. It carries **none** of flume's `.claude/rules/` posture pages and no
`PROTOCOL.md`. What it does share with flume is *structural* — the plan/build
split, the pending-entry extension idiom, the friction channel — and it has
re-derived the operator-facing layer (`README.md`, the seed template, the
declaration schema) independently. The block worth comparing across consumers
here is the **seed template** (`job-seed/`), not the rules pages.

## 7. Operator signal

**Four open upstream asks are named in the chain module by issue number**, which
is the clearest operator signal in this consumer — the chain is annotated with
what it is waiting for:

- **`flume#10`** — `.flume/chain.ts:337`, a section header declaring the
  telemetry block *"dies whole when flume#10 lands"*. The whole
  `withTickMetrics` block (`:337-395`) is declared **provisional**, to be
  deleted when the engine reports cost/token telemetry itself. Shape of the
  complaint: *the engine already parses the result event; the chain re-scans
  raw stdout for the one field the engine drops.* Cross-ref §3 #6.
- **`flume#11`** — `:721`, `priorAttemptPath`. **Already landed and adopted.**
  The chain records that the record's *path* is now the engine's rule, while
  its *shape* remains engine-private. Shape of the complaint: *half the fact
  was handed out.* Cross-ref §3 #9 and §4's silent `voluntary-bail` breakage,
  which is the direct cost of the shape staying private.
- **`flume#12`** — `:261`, closing the `planShapedHead` doc comment:
  *"Engine-anchored variant pending flume#12."* Shape: *the chain infers which
  phase authored HEAD from the commit's touched paths, and knows that is an
  inference; it wants the engine to state it.* The comment documents an
  adversarial finding (2026-08-26) proving the inference is currently sound,
  which is the tell that it was pressure-tested rather than assumed.
- **`flume#16`** — `:917`, `partitionIgnore`. **Already landed and adopted.**
  Recorded as the engine-side knob replacing a chain-side workaround (the plan
  prompt keeping a universally-re-pinned file out of every entry's `files`).

**Worked around with code, no issue filed:**

- The **module-scope lifecycle gap** (`:35-49`). A 15-line comment documenting
  that `FlumeApi.paths` carries the identity-same values but is unreachable
  from module scope, enumerating the five consumers that therefore cannot use
  it, and ending *"(tracked separately as a follow-up)"*. Shape: *the surface
  exists; the lifecycle does not let the chain reach it.*
- The **`FLUME_WORKTREES_DIR` relocation** (`:60-78`). The comment states that
  the engine's default *"puts a tick's cwd inside the checkout: the stray-write
  vector it documents"* — so the chain relocates fanout worktrees out of the
  checkout entirely, at module scope, because the engine reads the env var
  before any hook fires. Shape: *a documented hazard is the engine's default,
  and opting out is only possible through an env var set at import time.*
- **`--strict-mcp-config` on every agent** (`:429-434`). Worked around a wedged
  MCP child holding a finished agent's process open and stalling a whole wave.
  Shape: *a headless tick should not inherit user-level MCP config.*
- **`maxBuffer` raised at every call site** — 64 MiB at `:224`, `:463`, `:529`;
  16 MiB at `:508`. Shape: *the default buffer is too small for real build
  output, and every call site pays for it separately.*
- **`pendingGate`'s pre-0.13 bug, recorded in a comment** (`:551-554`): the
  engine's own gate *"read trunk's `pending.json` at gate time, so it judged
  the previous commit, not the one under inspection."* The chain-authored
  `perPathsExist` was written to avoid the same shape and says so.
- **The `pendingAfter` → `pickableAfter` live-lock** (`:891-895`): waking build
  on a quarantined-but-open entry made plan↔build ping-pong forever. Fixed by
  adopting the newer field; recorded as a hazard of the older one.
- **Two "adversarial finding 2026-08-26" cites** (`:261`, `:632`, `:805`) —
  this consumer ran a deliberate adversarial pass over its own chain and
  hardened three sites from it. Those findings are all chain-side; none were
  filed upstream.
