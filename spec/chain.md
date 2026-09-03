# The chain

A chain is the implementation flume runs: a single TypeScript module at
`<configDir>/chain.ts` that declares phases, gates, agents, and a handful of
engine-consumed fields. This file governs that seam — how the module is
shaped and loaded, what the engine hands it, what it may declare back, and
which obligations fall on the chain author rather than the runtime. The
entry queue the chain's phases consume is `spec/pending.md`; tick lifecycle
and supervisor mechanics are `spec/loop.md`; the subcommands that resolve
`configDir` are `spec/cli.md`.

## The chain is a plugin, not a consumer

The engine hands the chain its API. `chain.ts` default-exports a **factory**
the engine calls with its own surface; the chain imports no engine *value* at
runtime.

- The default export is `ChainFactory = (api: FlumeApi) => ChainModule`, where
  `ChainModule` is `{ chain: Chain; agent?: Agent; forkResolver?: ForkResolver }`
  (`src/Dispatcher.ts:ChainFactory`, `:ChainModule`). Everything a chain
  previously supplied as a named module export rides the factory's return,
  because a named export cannot receive the API.
- `FlumeApi` (`src/flumeApi.ts:FlumeApi`) carries the runtime surface a chain
  composes with — builtin gates, `setupWorktree`, the pending-schema helpers,
  the agent constructors and decorators, the path-glob matcher `matchesAny`
  (`src/paths.ts` — the same matcher the write fence enforces with, so chain
  path policy such as a shipped predicate never hand-rolls a second grammar
  beside the engine's), read-only git helpers, and the error
  classes chains branch on with `instanceof`. Each member is declared with
  `typeof` against the real implementation, so the handed surface cannot drift
  from what the engine exports: a signature change breaks at compile time
  rather than at a consumer's tick. The object is built by
  `src/flumeApi.ts:buildFlumeApi` and passed **by reference** — the identity-same
  objects the dispatcher holds, never resolved a second time.
- `buildFlumeApi` is a function, not a module-level constant, and that is
  load-bearing: `src/index.ts` initializes `builtinGates` before `Dispatcher`
  and `builtinGates` imports `Dispatcher` (a documented intentional cycle), so
  a top-level object literal would read exports still in their temporal dead
  zone. Property access is deferred into the call.
- **Type-only imports stay.** `import type { Chain, FlumeApi } from "@dtmd/flume"`
  is erased at runtime, so a types-only devDependency cannot execute and its
  staleness cannot reach a tick.
- A default export that is not a function is **refused** at load with a
  usage-shaped error naming the migration — never accepted as a bare `Chain`
  object. A factory that returns a thenable is refused too: the contract is
  synchronous, and awaiting would silently accept a shape it does not carry.
  Async work belongs in a phase hook, not at chain build time
  (`src/Dispatcher.ts:loadChainModule`).
- The engine's own dogfood chain runs under the same shape. No exemption for
  the host repo.

**Why:** a chain that writes `import { tscGate } from "@dtmd/flume"` is a
*consumer* resolving its own copy by Node's walk-up from the chain's
directory, so a second physical engine is reachable whenever the running
engine is not the one the walk-up finds. Two shapes were field-traced: a
globally-installed engine is structurally unreachable from the chain's import,
so the run dies with a raw `ERR_MODULE_NOT_FOUND` naming the very package that
is running; and with a local copy present the process runs **two engines** —
the invoked dist drives the Dispatcher while the chain constructs
Phase/Gate/Agent objects from the other copy, splitting `instanceof` and
module-level state **at equal versions**, with nothing reporting it and commits
as the output. The second rules the design: a silent degradation whose product
is commits is what `engineering.md`'s *Loud or nothing* forbids, and a refusal
would be the wrong fix — the condition should not be reachable. Removing the
chain's runtime dependency removes it by construction, where a specifier
rewrite or an identity check would only redirect or report it.

`src/index.ts` remains the package's public surface for programmatic embedders
(anyone constructing a `Dispatcher` directly) and for types. What changed is
that chains stop taking *values* from it. No loader hook, specifier rewriting,
version comparison, or lockfile check is part of this: it is an identity
contract, not a version one (see `spec/cli.md` for the exec-local doctrine).

## A dead declaration is refused at load

A chain field whose only consumer is statically unreachable from the rest of
the same declaration is a defect in the chain, and the loader refuses it with
a usage-shaped error naming the field and the declaration that disarms it
(`src/Dispatcher.ts:loadChainModule`) — never loaded silently. Config the
engine will never consult is stale narration wearing declaration syntax: it
reads as live policy while governing nothing, and nobody is told.

The decidable instances, each checkable from the declaration alone, no tick
required:

- **`phase.entryChannelPaths` without `phase.scopeWritesToEntry: true`.** The
  channel allowance is only consulted on a scoped tick (`spec/pending.md`,
  *The entry-scoped write guard is opt-in, and off by default*), so without
  the flag the globs govern nothing. The field-traced shape is a chain
  migrated across the narrowing-becomes-opt-in flip that kept its channel
  paths and missed the new flag — quietly running under the wider fence the
  old default would have narrowed.
The bar is static deadness, never disuse: an empty `entryChannelPaths: []` on
a scoped phase and an `afterMerge` gate on any phase both load — singleton
ticks merge through the same loop a wave does (`spec/worktrees.md`, *Singleton
runs in a worktree*), so `afterMerge` is reachable from every concurrency and
the former singleton-`afterMerge` refusal is retired. The
engine is not policing convention here — it refuses only a declaration its
own mechanics provably cannot reach, which is knowledge no chain owns. And
refusal, not a warning, is the shape (`engineering.md`, *Loud or nothing*): a
warning is a marker someone must remember to inspect, and the operator of an
autonomous loop reads exit codes, not scrollback.

## Chain resolution is per-tick, and the tick is a fresh process

The chain is resolved from `<configDir>/chain.ts` at the **start of every
tick**. A tick that commits a rewritten `chain.ts` — new phases, handoff,
`writablePaths`, gates — is governed by the new chain on the next tick,
including a `chain.ts` change that rides a same-commit `src/` change.

- **The mechanism is a process boundary.** `flume loop` is a supervisor that
  spawns one `flume tick` child per iteration; the chain is resolved once, in
  that child, at tick start. In-process re-resolution is *impossible* on the
  supported toolchain and is not attempted: Node's ESM module registry is keyed
  by resolved URL and non-evictable, so a fixed-path `chain.ts` is pinned to
  its first evaluation for the life of the process — no content-hash query
  string, `tsImport` namespace, or loader re-registration evicts it (verified
  empirically on tsx 4.21 / Node 22.21; the plain-`import()` control proves it
  is a Node-ESM constraint, not a `tsx` bug). An in-process loader also could
  not pick up a `chain.ts` whose behavior moved into a same-commit `src/`
  change, since those dependency modules are already evaluated. The process
  boundary is therefore *the* mechanism, not an optimization.
- **No memoization, no cache-bust.** `src/Dispatcher.ts:diskChainLoader` loads
  once per call: there is exactly one resolution per process and nothing to
  memoize across. Cost is one small `tsImport` of `chain.ts` per tick,
  dominated by orders of magnitude by the agent invocation.
- The chain is compiled in-process by `tsImport` (`tsx/esm/api`) rather than a
  plain `await import()`, because Node refuses `.ts` under `node_modules` and a
  consumer's `.flume/chain.ts` is a `.ts` file regardless of where flume lives.
  The published `dist/cli.js` needs no node loader flag as a result.
- `DispatcherOptions` accepts **no prebuilt `Chain`**; the dispatcher resolves
  its own. `DispatcherOptions.chainLoader?: () => Promise<ChainModule>` replaces
  the disk resolver wholesale and exists for **in-process test injection only**
  (unit tests that call `tick()` directly, no subprocess), defaulting to
  `diskChainLoader(configDir)`.
- The supervisor carries no in-memory chain or phase state across ticks —
  with one exception, `Chain.supervisorPolicy`, which it resolves once per run
  (below); continuation and hibernation are read from disk between children.
  See `spec/loop.md`.

## A broken chain fails loudly, at two layers

A rewritten `chain.ts` can be broken — syntax error, no default export, a
default export that is not a factory, no `phases[]`. Two layers, both required.

- **`chainLoadGate`** (`src/builtinGates.ts:chainLoadGate`), a builtin declared
  by any phase that can write `chain.ts`. It runs `afterCommit`, skips as a
  pass when the commit did not touch the chain, and otherwise validates by
  calling the **real** `loadChainModule` on the committed file — the same
  load+validate path the next tick's resolution takes, so the gate's verdict
  cannot disagree with what resolution would do. On failure the tick fails its
  gate, the revert path restores the commit, and `chain.ts` returns to its
  last-good version. It is a builtin because `chain.ts` is universal to every
  flume project and the load path it validates is the engine's own — the gate
  calls the exact function resolution calls, so a chain-local reimplementation
  could only diverge from it. `pendingGate` is likewise a builtin
  (`src/builtinGates.ts:pendingGate`), parameterized by chain-supplied options;
  the parameterization, not chain-locality, is what carries the convention.
- **A CJS-context host is refused, not relayed.** When the load failure carries
  the module-context signature — `Cannot use import statement outside a
  module`, or an `ERR_MODULE_NOT_FOUND` whose path carries tsx's
  percent-encoded `?namespace=` query
  (`src/Dispatcher.ts:isCjsContextLoadFailure`, an empirical two-shape family)
  — the engine refuses with a usage-shaped message naming the fix (`"type":
  "module"` in the repo's package.json, or one beside `chain.ts`) and the tick
  exits **2**, not the mount-dead constant
  (`src/Dispatcher.ts:CjsContextLoadError`, `src/cli.ts:tickExitCode`, which
  checks it first). Matching is deliberately narrow: a genuinely missing
  dependency must keep surfacing as itself, unshadowed. Supporting a
  CJS-context host is declined; relaying a raw loader stack is the defect.
- **Engine resolution failure.** If per-tick resolution throws for any other
  reason and no gate caught it, the `flume tick` child exits with the
  mount-dead exit constant and
  a loud error; the supervisor never crashes on it. There is no in-process
  "last-good chain" to retain — recovery is structural: a gated broken chain is
  reverted and the next tick's fresh process reads the restored file, while an
  *ungated* broken chain makes every subsequent tick fail loudly until it is
  restored. Because a mount-dead run would otherwise burn the remaining `--max`
  ticks re-hitting the same wall, the supervisor **aborts the run** on that
  code instead of proceeding to the next iteration; see `spec/loop.md` for the
  exit-code contract.

**Containment is not recovery.** The layer above guarantees no crash and no bad
persist. It becomes recovery only because the prior-outcome channel forwards
the failure detail to the retrying tick (`spec/loop.md`): without it, a tick
that writes a broken `chain.ts` is reverted, the next tick cannot see why,
writes it the same way, and the loop reverts forever while looking alive.

> **Drift:** `chainLoadGate` keys on the repo-relative literal
> `.flume/chain.ts` (`src/builtinGates.ts:CHAIN_REL_PATH`), not on the
> dispatcher's resolved `configDir`, and `GateContext` carries no `configDir`
> to key on. Under an explicit `FLUME_CONFIG_DIR` the gate silently reports
> "chain.ts untouched — gate skipped" for a chain it never validated. The site
> declares the hardcoded path as the universal convention.

## Chain residency — one chain per `.flume`

The chain lives at `<configDir>/chain.ts`, and **job resolution never retargets
`configDir`**. `--job`/`FLUME_JOB` moves only the state root (`flumeDir` →
`<repoRoot>/.flume/jobs/<name>`); `configDir` stays `<repoRoot>/.flume`, or an
explicit `FLUME_CONFIG_DIR`, which composes with a job
(`src/cli.ts:resolveStateDirs`). There is no job-local chain.

- **A `chain.ts` inside a job dir is inert, and stays unpoliced.** The runtime
  never looks there; machinery does not police caller-owned content. No probe,
  no warning, no refusal — the invariant is what resolution *is*, not a rule
  to enforce.
- **Per-job variation is already served**: a chain is code, and `FLUME_JOB` is
  written back into the environment when the state roots resolve
  (`src/cli.ts:resolveStateDirs`), before the tick's chain load, so one repo
  chain can dispatch on it. Operator-run worktrees give concurrent divergence,
  each checkout resolving its own chain.
- `promptPath` mechanics follow for free: it joins `configDir`
  (`src/Dispatcher.ts`, `src/cli.ts`), and `configDir` is always the directory
  the chain actually lives in — a shared chain finds its sibling `prompts/`
  from any job, with no chain-dir token and no dynamic path computation.

## Per-phase agent assignment

`Phase.agent?: Agent` (`src/Phase.ts:Phase`). Per-tick resolution is
`phase.agent ?? chainModule.agent ?? DispatcherOptions.agent`
(`src/Dispatcher.ts`) — the chain-level override chain extended by one inner
scope.

Mechanism over sugar: the declared value is an `Agent`, not a model string, so
it composes with decorators — a bare model string cannot express "same
decorator stack, different model". A model-only variation is expressible as
`claudeCode({ extraArgs: ["--model", "…"] })` inside the phase's agent value,
and a chain-local helper amortizes re-stating the stack (the dogfood chain's
`phaseAgent(model)` is the worked example). A `Phase.model` shortcut stays
deferred until a second provider or demonstrated ergonomic pain exists.

## The agent seam

An `Agent` is `{ name, invoke }` (`src/Agent.ts:Agent`) — an opaque value the
chain supplies and the engine only calls. The engine never inspects it, so
provider options and decorator composition are entirely the chain's.

**The seam is opaque; the transcript reader is not.** One provider's NDJSON
event vocabulary — `assistant`, `result`, `is_error`, `subtype` — is hardcoded
in the engine, shared between the renderer and the voluntary-bail extractor. It
has one home rather than two, but that home is engine code holding a provider's
shape. This is accepted while Claude Code is the only shipped provider: the
second-implementation test (`.claude/rules/engine-boundary.md`) cannot be
answered from a sample of one, and a `transcript` hook invented against a single
known consumer would encode that consumer's shape as everyone's. **The condition
that reopens it is a second provider** — at that point the chain supplies its own
extractor alongside its `Agent`, and the engine stops parsing streams entirely.
Not a date, not a release: the appearance of the second implementation.

- **`claudeCode()` skips permissions by default.** `dangerouslySkipPermissions`
  defaults to `true`, and the flag is appended to the argv whenever it is
  (`src/Agent.ts:claudeCode`). The CLI's fallback agent is a bare
  `claudeCode()` (`src/cli.ts`), so a chain that declares neither `Phase.agent`
  nor `ChainModule.agent` runs every tick with permissions skipped. The other
  defaults: `claude` off `PATH`, `outputFormat: "text"`, `extraArgs` appended
  after the format flags.
- **Decorators wrap an `Agent` and return one, and the stack order is
  load-bearing.** `withTerminalRenderer` replaces `inv.onStdout`, so
  `withSessionCapture` must sit **inside** it to tee the raw stream —
  `withTerminalRenderer(withSessionCapture(claudeCode({ outputFormat:
  "stream-json" }), { dir }))`. Inverted, the capture files the rendered
  summary instead of the transcript.
- **The renderer requires stream-json, and violating that is quiet.** It
  forwards only `assistant` events' `tool_use` blocks and the final `result`
  line; every other event is dropped, and a line that does not parse as JSON is
  re-emitted verbatim with the tag prefix. An agent not producing stream-json
  therefore has *all* of its output take the parse-error leg — output still
  appears, so the misconfiguration reads as working. The site declares this
  (`src/Agent.ts:withTerminalRenderer`); a refusal on repeated parse failure is
  the standing alternative, not shipped.
- **`withSessionCapture` tees stdout only.** It creates `opts.dir` on demand,
  closes the stream on failure as well as success, and never captures stderr.
  Its default filename is an ISO timestamp plus the invocation's `cwd`
  basename, specifically so concurrent fanout invocations — distinct worktrees,
  same clock tick — do not collide.

Live agent output is operationally load-bearing (`spec/loop.md`), which is what
makes a misassembled stack more than cosmetic: it blinds the operator without
failing anything.

The skip-permissions default's stated rationale — every Flume tick runs in a
worktree the harness controls (`src/Agent.ts:ClaudeCodeOptions`) — holds for
both concurrencies now that singleton ticks provision one too
(`spec/worktrees.md`, *Singleton runs in a worktree*); the singleton-in-checkout
gap it used to carry as drift is closed.

## `Chain.seedDir` — the declared job seed

The chain declares what a newborn job contains; machinery materializes the
declaration and holds no content opinion.

- **`Chain.seedDir?: string`** (`src/Phase.ts:Chain`): a **configDir-relative**
  directory — the `promptPath` idiom, so stubs are real files beside the chain
  (e.g. `.flume/job-seed/`).
- `flume job new` loads the repo chain first: no `<configDir>/chain.ts` is a
  usage error (exit 2) — a job that could never `run` must not be creatable —
  and a declared `seedDir` that is absent on disk is the same class of error,
  checked **before** the state root is touched so a bad declaration leaves no
  stray job dir (`src/job.ts:jobNew`).
- The copy is **verbatim, skip-existing** (`cp` with `force: false`): a re-run
  fills gaps — a stub added to the seed dir reaches existing jobs — and never
  clobbers a worked file. No interpolation. This is what makes "idempotent on
  re-run" true.
- Absent `seedDir` → a bare job, **no warning**: state accretes from ticks, and
  bare is legitimate. There is no seed default and no per-invocation template
  flag; authority is a repo-declared fact.

The rest of `job new`'s sequence — runtime ignores, longpaths pin, baseline
commit on current HEAD — is `spec/jobs.md`.

## `Chain.friction` — the declared friction channel

**`Chain.friction?: string`** (`src/Phase.ts:Chain`): a **state-root-relative**
directory naming the friction channel (e.g. `"friction"`), resolved against the
resolved `flumeDir`, same idiom as `seedDir`.

- Validated at chain load (`src/Dispatcher.ts:loadChainModule` →
  `validateFrictionDeclaration`): must be relative and must resolve inside the
  state root, else a usage-shaped error. The check is base-independent — it
  resolves the declared path against a sentinel root and asks whether the
  result still sits under it — because the real state root legitimately varies
  per call site while "does this relative path escape whatever root it is
  joined to" is a property of the path string alone.
- The directory itself is created lazily by whichever engine write needs it
  first; its absence is never an error.
- **Undeclared disables the whole channel** — every friction-lifecycle
  behavior stays off, and there is no default channel.
- The engine guarantees the channel's lifecycle without ever **interpreting**
  its content — chains own what a note means; the engine may move, count,
  list, or print bytes verbatim, and never derives a decision from them.
  Where the declaration is consumed: the runtime ignore set
  (`spec/jobs.md`), the wave-teardown harvest and the revert note
  (`spec/worktrees.md`, `spec/loop.md`), the count line `flume status`,
  `flume job status`, and the loop-end summary print when the channel is
  declared and non-empty, and the `flume friction` read verb
  (`spec/cli.md`).

## Supervisor policy is a chain-overridable default

`Chain.supervisorPolicy?: { quarantineScope?: "run" | "none"; abortThreshold?:
number; maxParallel?: number; tickTimeoutMs?: number; partitionIgnore?: string[] }`
(`src/Phase.ts:Chain`). The engine's loop policy — run-scoped quarantine of an
entry slug whose worktree provisioning failed, abort after three consecutive
identical failure signatures, fanout batch width, the per-invocation wall-clock
cap, and the paths the fanout partition ignores — ships as **defaults, not
behavior** (`src/Dispatcher.ts:superviseLoop`, `quarantineScope ?? "run"`,
`abortThreshold ?? 3`; `runFanout`, `maxParallel ?? 4`; `tickTimeoutMs` default
unset — no cap; `partitionIgnore` default `[]`). A chain declaring nothing gets
the defaults byte-identically.

**The block's fields split by read scope, and the split is principled:**

- **`quarantineScope`/`abortThreshold` are read once per run** — the one
  declaration outside the per-tick guarantee above. The supervisor resolves
  the chain in its own process before the first child (`src/cli.ts` loop
  branch) and `src/Dispatcher.ts:superviseLoop` binds both before entering the
  tick loop; nothing re-reads them between children. A tick that commits a
  changed value is governed by the old one until the operator restarts
  `flume loop`, with no indication the new declaration was ignored. Run scope
  is the reason, not an oversight: the quarantine set and the
  consecutive-failure streak are run-scoped accounting that resets per
  `superviseLoop` call, so a mid-run change would rewrite the rules the
  accumulated counts were gathered under.
- **`maxParallel`, `tickTimeoutMs`, and `partitionIgnore` are read per tick**,
  straight off the tick's own resolved chain (`runFanout`,
  `chain.supervisorPolicy?.maxParallel ?? this.maxParallel`; `tickTimeoutMs`
  the same shape against `DispatcherOptions.tickTimeoutMs`; `partitionIgnore`
  handed to the partition, `spec/pending.md` *Fanout partition*). None
  accumulates run-scoped state, so there is nothing a mid-run change would
  corrupt — the per-tick chain reload governs.

`tickTimeoutMs` is the wall-clock cap `DispatcherOptions.tickTimeoutMs`
already enforces per agent invocation (exceeded → the invocation is aborted
and the tick records the abort; `src/Dispatcher.ts`). Before it rode
`supervisorPolicy`, the dispatcher supported the cap but a CLI-driven chain
had no way to set it — the only runaway brake on an autonomous loop was an
operator watching verdict lines.

This is the policy-constant rule made concrete: retry counts, quarantine
scope, abort thresholds, batch width, and timeouts enter the engine only as
chain-overridable defaults. The mechanism they tune is `spec/loop.md`.

## Gate placement is the chain's decision

Gates declare `when: "afterCommit" | "afterMerge"` (`src/Gate.ts:GatePhase`).
The engine runs them where they say; **where to put them is chain-authoring
doctrine**, and the default guidance is:

- **`afterMerge` is the only validation of the merged tree — the gates that
  define "still correct" belong there.** `afterCommit` gates run in the worktree
  and validate the entry's span against its recorded base; when the trunk moved
  under the wave — a foreign commit absorbed mid-run (`spec/loop.md`, *Tip
  verify*) — the merged tree is one no `afterCommit` gate ever saw. The engine
  re-gates nothing on its own; a chain operating under foreign commits owns
  placing its correctness gates at `afterMerge`, and a chain that leaves them at
  `afterCommit` has chosen the staleness window, not merely defaulted into it.
- **Expensive correctness gates at `afterMerge`; cheap structural gates at
  `afterCommit`.** N parallel heavy gates under fanout saturate the host, and a
  flaky timeout under contention reverts clean commits. The dogfood chain
  places `vitest` at `afterMerge` and `tscGate` at `afterCommit`
  (`.flume/chain.ts`). Per-entry `afterMerge` revert isolation is what makes
  this safe — a failure there reverts only the offending entry
  (`spec/worktrees.md`).
- **Gate on the safety property, never on byte-equality of generated
  artifacts.** A byte-exact freshness gate fired on functionally-identical
  output — virtual-store hashes leaking into a bundler's output produced
  hundreds of pure-reorder diffs — and reverted clean commits, while the real
  property was expressible directly (does the bundle resolve without reaching
  outside itself). The engine's lever here is teaching, not enforcement: the
  offending gate is always chain-owned.
- **Both concurrencies reach both gate points.** A singleton tick runs its
  span through the same worktree-then-merge machinery a wave of one does
  (`spec/worktrees.md`, *Singleton runs in a worktree*): `afterCommit` gates in
  the worktree, `afterMerge` gates on the trunk after the cherry-pick. The
  placement guidance above therefore applies uniformly, and
  `prependHarnessBlock` renders the full gate list for every phase — there is
  no longer a gate point a concurrency cannot reach.
- A gate reads the tick's touched paths from `GateContext.touchedPaths`, which
  the dispatcher computes once per commit, instead of re-shelling
  `git show --name-only` per gate.
- **Sibling ships compose only on the trunk, and only `afterMerge` sees the
  composition.** Two entries in one wave can each pass `afterCommit` in
  isolation and together produce a tree neither worktree ever held — each adds
  an import of the other's module, the cherry-picks land cleanly in different
  files, and the linearized tree fails to load. The `afterMerge` loop runs per
  entry on the trunk *after* that entry's cherry-pick, so the second sibling's
  gate runs over both; a chain that placed its load-bearing verify at
  `afterCommit` gated every commit and never the wave. This is the first bullet
  restated for the wave case, not a new rule.
- **A gate that should not judge a channel-only commit says so itself.** A
  content gate over the whole tree fails on a broken base whatever the commit
  says, so once the base is broken it reverts the very commit that reports the
  breakage — a rescope note written and lost, and the worse the tree, the less
  of it reaches the producer. The engine adds no skip mechanism for this: the
  gate already receives `touchedPaths`, and the chain already declared which
  paths are its channel, so a gate that returns `ok` when every touched path
  matches the channel is a chain-side wrapper, not an engine flag. The
  upstream fix is the bullet above — a verify gate at `afterMerge` keeps the
  base from breaking in the first place — and `writablePathsGate` runs
  regardless, so no wrapper widens the fence.

The complementary constraint — naming real-subprocess tests
`*.integration.test.ts` and excluding them from the default `vitest run` — is
in `spec/worktrees.md`, which also records that the premise it was introduced
under (an afterMerge gate running inside a freshly-installed worktree) no
longer holds: that gate runs on the warm trunk.

## What a gate receives

`GateContext` (`src/Gate.ts:GateContext`) is the whole input surface. The
dispatcher builds one per gate invocation; a gate treats it as read-only and
confines side effects to disk inside `cwd`.

- **`cwd` and `repoRoot` are the same value — the working tree the gate runs
  in.** For an `afterCommit` gate that is the tick's ephemeral worktree, both
  concurrencies alike (`spec/worktrees.md`, *Singleton runs in a worktree*);
  for an `afterMerge` gate it is the primary checkout. No field reaches the
  primary checkout from inside a worktree, so a gate that needs the trunk
  belongs at `afterMerge`.
- **`flumeDir`** is the absolute, resolved state root — how a gate reaches
  state-relative paths without hardcoding `.flume/` or reading `process.env`.
- **`commitSha` and `touchedPaths` are optional in the type and always set on a
  dispatcher-built context.** The optionality exists for hand-built fixtures;
  a builtin that falls back to its own `git show --name-only` is covering the
  fixture case, never a real tick.
- **`log`** is the harness-side output channel; a gate does not write to stdout
  itself.

## What a gate returns

`GateResult` (`src/Gate.ts:GateResult`) is `{ ok, message, details?, failingFiles? }`.

- **`failingFiles?: string[]`** — repo-relative paths the gate attributes the
  failure to, when the gate's runner can name them (a test reporter's JSON, a
  type-checker's diagnostics). The chain knows its runner; the engine knows the
  span's footprint. When both are present the engine derives the
  suspect-flake marker on the prior-attempt record (`spec/loop.md`,
  *Prior-outcome feedback*) — mechanically, from list disjointness, never by
  reading the gate's prose. An absent field is today's behavior: no marker,
  no inference.

## The builtin gates

The set is deliberately small — the gates most chains reach for, so a chain
does not rebuild exec plumbing to run `tsc`. `chainLoadGate` is above;
`pendingGate` and `writablePathsGate` are `spec/pending.md`.

- **`shellGate({ name, when, cmd, args, maxBuffer?, failHint?, env? })`** — the
  escape hatch, and what the others are built from. Verdict is exit code alone.
  On success `details` carries `stdout || stderr`; on failure `message` is
  `failHint` (default `"<name> failed"`) and `details` carries the captured
  output. `env` merges over `process.env` for the spawned command — the
  injection point that keeps a chain from hand-forking the gate to inject one
  variable. The gate it returns declares `command` — the `cmd` and `args` it
  will run, rendered as one line — which the harness block shows the agent
  beside the gate's name (`spec/prompt.md`, *The harness block*), so a chain
  wanting the agent to self-check before committing does not restate the
  command in its prompt from a parallel constant. `Gate.command?: string` is
  optional on the type: a hand-rolled gate with no single command line
  declares none and renders as name alone.
- **`maxBuffer` defaults to 16 MiB, and an overrun reads as a failing check.**
  Exceeding it rejects the exec, and the same catch that reports a non-zero
  exit reports this — so a command that would have passed reverts a clean
  commit, with a buffer-overrun string as the details. A gate whose output can
  be large raises the cap or quiets the command.
- **`tscGate`, `vitestGate`, `eslintGate` are dual-identity**
  (`src/builtinGates.ts:PkgManagerGate`): used bare (`gates: [tscGate]`) each
  *is* a pnpm-flavored `Gate`; called with `{ cmd?, args? }` each returns the
  same check through another package manager. `cmd` alone only suffices for a
  binary that accepts pnpm's arg shape — npm has no bare `npm tsc --noEmit` and
  needs the `args` override too. The chain supplies the binary, the engine
  supplies the enforcement.
- Gate binaries are spawned direct-then-shell-on-win32-`ENOENT`; the reason is
  `.claude/rules/platform-facts.md`.

## Per-run artifacts belong under `FLUME_DIR`

The teardown promise — one `rm` removes the whole footprint — holds only if
**every** mutable artifact lives under the state root. The runtime supplies
that root; it does not own what a chain writes into it.

- **The runtime canonicalizes.** After resolving `flumeDir` and `configDir`,
  the CLI writes the resolved **absolute** paths back to `process.env.FLUME_DIR`
  and `process.env.FLUME_CONFIG_DIR` (`src/cli.ts:resolveStateDirs`), so a chain
  loaded later in the same process, and any spawned child, read one resolved
  value instead of re-deriving a default or falling back to a coincidentally-equal
  `configDir`. `FLUME_DIR` is a reliable, always-present source of truth.
- **The chain author places.** A chain that captures sessions — or any other
  per-run artifact — must place it under `process.env.FLUME_DIR` for the state
  root to be self-contained. The dogfood chain's session capture is the
  reference implementation: `resolve(process.env.FLUME_DIR ?? CHAIN_DIR, "sessions")`,
  where the `??` leg is defensive only. An absolute path matters here: a fanout
  tick runs inside the worktree base — `<flumeDir>/worktrees/` by default,
  relocatable via `FLUME_WORKTREES_DIR`, namespaced per job — so a relative
  session dir would be written into a worktree git later removes.
- **The runtime does not own session-capture location.** It is a chain concern
  by decision, not an omission — the runtime supplies the canonical root and
  nothing more. A relocated state root is expected to live outside the working
  tree, so no in-repo gitignore glob is added for it; the default
  `<repoRoot>/.flume` stays ignored as it already is.

> **Drift:** `main()` dispatches the job-management verbs
> (`src/cli.ts:runJobVerb`) and returns before it reaches `resolveStateDirs`,
> so `flume job new` and `flume job status` — each deriving `configDir` inline
> and loading the chain from it — canonicalize nothing. A chain factory reading
> `process.env.FLUME_DIR` under those verbs sees whatever the caller exported,
> or nothing; the dogfood chain takes its `?? CHAIN_DIR` leg there, which the
> bullet above calls defensive only. No tick runs under those verbs, so nothing
> is misplaced today — what does not hold is the unqualified always-present
> contract a chain author would build on.

## The package a chain loads through

`src/index.ts` is the canonical export list — the shape consumers depend on,
and the only thing the `exports` map resolves. Anything not re-exported there
is internal and may break between minor versions. The inventory is not
restated here; read the module.

Durable packaging policy:

- **Ship compiled output, not raw `.ts`.** Emit `.js` + `.d.ts` to `dist/` and
  point `package.json` at the compiled tree — the broadly-compatible choice for
  any consumer (pure Node, bundler, TS or JS project), and it removes a runtime
  dependency on `tsx` for the package's own surface.
- **ESM-only.** `"type": "module"`, Node 22+. `attw --pack . --profile esm-only`
  is the accurate *profile* — the default profile's `CJSResolvesToESM` finding
  is the expected shape, not a defect — but it runs non-blocking in CI while
  the upstream crash stands; the binding declaration-shape check is the
  consumer-install smoke.
- **A strict, single-entry `exports` map.** `"."` only — no subpath patterns,
  no `./internal/*` escape hatch; a consumer needing an internal export files
  for promotion. The conditions are `types` then **`default`** — *not* `import`.
  This is load-bearing: flume's own chain loader resolves the bare package
  specifier through `tsImport`, which takes a require-ish resolution path, and
  an `import`-only map fails it with `ERR_PACKAGE_PATH_NOT_EXPORTED` — breaking
  the prescribed consumer pattern (`import … from "@dtmd/flume"` inside
  `.flume/chain.ts`) while remaining invisible to tsc, vitest, and attw. Only a
  consumer-install smoke catches it. `default` is the catch-all condition,
  still one `"."` entry resolving to the one ESM build.
- `"main"` and `"types"` are duplicated outside `"exports"` because npm only
  shows the TS-package icon when top-level `"types"` is set.

**Standing acceptance:** a fresh consumer project resolves and typechecks
`import { … } from "@dtmd/flume"`; deep paths (`@dtmd/flume/src/Dispatcher.ts`,
`@dtmd/flume/dist/Dispatcher.js`) fail at module resolution.

> **Gap:** the loader contract's runtime half is only exercised by the
> consumer-install smoke, whose chain fixture is pre-factory (see the drift
> note above). Nothing currently proves a *published* package loads a
> factory-shaped chain end to end.
