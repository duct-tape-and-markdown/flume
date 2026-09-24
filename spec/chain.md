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
  `ChainModule` is `{ chain: Chain; agent?: Agent; forkResolver?: ForkResolver }`.
  Everything a chain previously supplied as a named module export rides the
  factory's return, because a named export cannot receive the API.
- `FlumeApi` carries the runtime surface a chain
  composes with — builtin gates, `setupWorktree`, the pending-schema helpers,
  the agent constructors and decorators, and every path rule the engine
  keys files by — the glob matcher `matchesAny`, the host-to-git path rule
  `gitPath`, the state-root layout (the same rules the write fence and the
  at-ref readers enforce with, so chain
  path policy such as a shipped predicate never hand-rolls a second grammar
  beside the engine's), read-only git helpers, and the error
  classes chains branch on with `instanceof`. Each member is declared with
  `typeof` against the real implementation, so the handed surface cannot drift
  from what the engine exports: a signature change breaks at compile time
  rather than at a consumer's tick. The object is built by
  `buildFlumeApi` and passed **by reference** — the identity-same
  objects the dispatcher holds, never resolved a second time.
- **Type-only imports stay.** `import type { Chain, FlumeApi } from "@dtmd/flume"`
  is erased at runtime, so a types-only devDependency cannot execute and its
  staleness cannot reach a tick.
- A default export that is not a function is **refused** at load with a
  usage-shaped error naming the migration — never accepted as a bare `Chain`
  object. A factory that returns a thenable is refused too: the contract is
  synchronous, and awaiting would silently accept a shape it does not carry.
  Async work belongs in a phase hook, not at chain build time.
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
— never loaded silently. Config the
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
- **No memoization, no cache-bust.** `diskChainLoader` loads
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

- **`chainLoadGate`**, a builtin declared
  by any phase that can write `chain.ts`. It runs `afterCommit`, skips as a
  pass when the commit did not touch the chain, and otherwise validates by
  calling the **real** `loadChainModule` on the committed file — the same
  load+validate path the next tick's resolution takes, so the gate's verdict
  cannot disagree with what resolution would do. On failure the tick fails its
  gate, the revert path restores the commit, and `chain.ts` returns to its
  last-good version. It is a builtin because `chain.ts` is universal to every
  flume project and the load path it validates is the engine's own — the gate
  calls the exact function resolution calls, so a chain-local reimplementation
  could only diverge from it. `pendingGate` is likewise a builtin,
  parameterized by chain-supplied options; the parameterization, not
  chain-locality, is what carries the convention.
- **A CJS-context host is refused, not relayed.** When the load failure carries
  the module-context signature — `Cannot use import statement outside a
  module`, or an `ERR_MODULE_NOT_FOUND` whose path carries tsx's
  `?namespace=` query in either spelling, literal or percent-encoded (an
  empirical two-shape family)
  — the engine refuses with a usage-shaped message naming the fix (`"type":
  "module"` in the repo's package.json, or one beside `chain.ts`) and the tick
  exits **2**, not the mount-dead constant (`CjsContextLoadError`,
  checked ahead of every other outcome). Matching is deliberately narrow: a
  genuinely missing dependency must keep surfacing as itself, unshadowed.
  Supporting a CJS-context host is declined; relaying a raw loader stack is
  the defect.
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

## Chain residency — one chain per `.flume`

The chain lives at `<configDir>/chain.ts`: one chain per state root, and
`configDir` is `<repoRoot>/.flume` or an explicit `FLUME_CONFIG_DIR`.

- **A `chain.ts` anywhere the runtime does not resolve is inert, and stays
  unpoliced.** The runtime never looks there; machinery does not police
  caller-owned content. No probe, no warning, no refusal — the invariant is
  what resolution *is*, not a rule to enforce.
- **Variation between efforts is served by the checkout**: operator-run
  worktrees give concurrent divergence, each checkout resolving its own chain
  against its own state root (`spec/jobs.md`, *The checkout is the unit of
  isolation*).
- `promptPath` mechanics follow for free: it resolves against `configDir` — a
  relative path keeps its meaning beneath it, an absolute one is taken as given,
  which is how a package-shipped prompt gets an address — and
  `configDir` is always the directory the chain actually lives in, so a chain
  finds its sibling `prompts/` with no chain-dir token and no dynamic path
  computation.

## Per-phase agent assignment

`Phase.agent?: Agent`. Per-tick resolution is
`phase.agent ?? chainModule.agent ?? DispatcherOptions.agent`
— the chain-level override chain extended by one inner scope.

Mechanism over sugar: the declared value is an `Agent`, not a model string, so
it composes with decorators — a bare model string cannot express "same
decorator stack, different model". There is no `Phase.model`.

The model itself is a typed option on the adapter: `claudeCode({ model })`
(`ClaudeCodeOptions.model`), rendered to `--model <value>` on the
argv. It has **no default** — undeclared, the binary's own default applies and
the engine passes nothing. A tick loads only the MCP configuration the chain
hands it: the adapter passes `--strict-mcp-config` unless
`ClaudeCodeOptions.inheritUserMcp` is set, because by-user runtime state is what
a stateless tick excludes, and a wedged inherited server has stalled a wave.
`extraArgs` remains the passthrough for every other
flag; the engine types the one knob every consumer varies per phase and
declines to mirror the rest of the CLI (`.claude/rules/engine-boundary.md`,
*Surface, not prescription*). The result event reports the model
that ran (`AgentUsage.model`, the resolved id), so a chain can check what
ran against what it asked for. A chain-local helper that re-states a decorator
stack per model is still the way to vary model under one stack; what it no
longer does is assemble argv.

## The agent seam

An `Agent` is `{ name, invoke }` — an opaque value the
chain supplies and the engine only calls. The engine never inspects it, so
provider options and decorator composition are entirely the chain's.

**The seam is opaque, and the adapter is where provider shape lives.** One
provider's NDJSON event vocabulary — `assistant`, `result`, `is_error`,
`subtype` — is known to exactly one module, which holds the
`claudeCode` adapter and its decorators. The adapter lifts what the engine
consumes onto `AgentResult` as plain fields: `usage` (already) and
`finalMessage` — the agent's closing prose, the `result` event's text under
stream-json, the whole of stdout under `"text"`. The dispatcher reads
`AgentResult.finalMessage` and never parses a transcript; a second provider's
adapter fills the same fields from its own stream and nothing downstream
changes. The renderer keeps its own parse because rendering *is* provider
presentation, and it lives in the same module.

- **`claudeCode()` skips permissions by default.** `dangerouslySkipPermissions`
  defaults to `true`, and the flag is appended to the argv whenever it is.
  The CLI's fallback agent is a bare
  `claudeCode()`, so a chain that declares neither `Phase.agent`
  nor `ChainModule.agent` runs every tick with permissions skipped. The other
  defaults: `claude` off `PATH`, `outputFormat: "text"`, `model` unset (no
  `--model` flag emitted), `extraArgs` appended after the format flags.
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
  (`withTerminalRenderer`); a refusal on repeated parse failure is
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
worktree the harness controls — holds for
both concurrencies now that singleton ticks provision one too
(`spec/worktrees.md`, *Singleton runs in a worktree*); the singleton-in-checkout
gap it used to carry as drift is closed.

## `Chain.friction` — the declared friction channel

**`Chain.friction?: string`**: a **state-root-relative**
directory naming the friction channel (e.g. `"friction"`), resolved against the
resolved `flumeDir`.

- Validated at chain load: must be relative and must resolve inside the
  state root, else a usage-shaped error. The check is base-independent — it
  resolves the declared path against a sentinel root and asks whether the
  result still sits under it — because the real state root legitimately varies
  per call site while "does this relative path escape whatever root it is
  joined to" is a property of the path string alone.
- The directory itself is created lazily by whichever engine write needs it
  first; its absence is never an error.
- **A dotfile is not a note.** The count, the listing, the read verb, and
  the teardown harvest skip a name beginning with `.` — a placeholder git
  made the consumer create is no work, and a harvest that relayed one under a
  stamped name would turn a skipped name into an unskippable one — and the
  skip is by name alone, never by content.
- **Undeclared disables the whole channel** — every friction-lifecycle
  behavior stays off, and there is no default channel.
- The engine guarantees the channel's lifecycle without ever **interpreting**
  its content — chains own what a note means; the engine may move, count,
  list, or print bytes verbatim, and never derives a decision from them.
  Where the declaration is consumed: the runtime ignore set
  (`spec/jobs.md`), the wave-teardown harvest and the revert note
  (`spec/worktrees.md`, `spec/loop.md`), the count line `flume status` and the
  loop-end summary print when the channel is declared and non-empty, and the `flume friction` read verb
  (`spec/cli.md`).

## Supervisor policy is a chain-overridable default

`Chain.supervisorPolicy?: { quarantineScope?: "run" | "none"; abortThreshold?:
number; maxTicks?: number; maxParallel?: number; tickTimeoutMs?: number;
partitionIgnore?: string[]; killGraceMs?: number }`.
The engine's loop policy — run-scoped quarantine of an
entry slug whose worktree provisioning failed, abort after three consecutive
identical failure signatures, how many phase ticks the supervisor runs at once
(`spec/loop.md`, *Baton — presence wakes, absence hibernates*), fanout batch
width, the per-invocation wall-clock cap, the paths the fanout partition
ignores, and the grace a signalled tick gives its agent tree before `SIGKILL`
(`spec/loop.md`, *The loop lock and the tip claim*) — ships as **defaults, not
behavior** (`superviseLoop`, `quarantineScope ?? "run"`, `abortThreshold ?? 3`,
`maxTicks ?? 1`; `runFanout`, `maxParallel ?? 4`; `tickTimeoutMs` default unset
— no cap; `partitionIgnore` default `[]`; `killGraceMs ?? 5000`). A chain
declaring nothing gets the defaults byte-identically — one phase tick at a
time, which is the serial loop.

**The block's fields split by read scope, and the split is principled:**

- **`quarantineScope`, `abortThreshold`, and `maxTicks` are read once per
  run** — the one declaration outside the per-tick guarantee above. The
  supervisor resolves the chain in its own process before the first child and
  `superviseLoop` binds all three before entering the tick loop; nothing
  re-reads them between children. `maxTicks` is the supervisor's own bound on
  the children it holds, and the supervisor is the one process that never
  reloads. A tick that commits a changed value is governed by the old one
  until the operator restarts
  `flume loop`, with no indication the new declaration was ignored. Run scope
  is the reason, not an oversight: the quarantine set and the
  consecutive-failure streak are run-scoped accounting that resets per
  `superviseLoop` call, so a mid-run change would rewrite the rules the
  accumulated counts were gathered under.
- **`maxParallel`, `tickTimeoutMs`, `partitionIgnore`, and `killGraceMs` are
  read per tick**, straight off the tick's own resolved chain (`runFanout`,
  `chain.supervisorPolicy?.maxParallel ?? this.maxParallel`; `tickTimeoutMs`
  the same shape against `DispatcherOptions.tickTimeoutMs`; `partitionIgnore`
  handed to the partition, `spec/pending.md` *Fanout partition*;
  `killGraceMs` read by the tick process that signals its agent, under a loop
  and bare alike — the supervisor signals its child and holds no grace of its
  own). None accumulates run-scoped state, so there is nothing a mid-run
  change would corrupt — the per-tick chain reload governs.

`tickTimeoutMs` is the wall-clock cap `DispatcherOptions.tickTimeoutMs`
already enforces per agent invocation (exceeded → the invocation is aborted
and the tick records the abort). Before it rode
`supervisorPolicy`, the dispatcher supported the cap but a CLI-driven chain
had no way to set it — the only runaway brake on an autonomous loop was an
operator watching verdict lines.

This is the policy-constant rule made concrete: retry counts, quarantine
scope, abort thresholds, batch width, and timeouts enter the engine only as
chain-overridable defaults. The mechanism they tune is `spec/loop.md`.

## Gate placement is the chain's decision

Gates declare `when: "afterCommit" | "afterMerge"` (`GatePhase`).
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

`GateContext` is the whole input surface. The
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
  It is the **primary checkout's** state root at both gate points, never
  rebased onto a worktree: runtime state (`awake/`, `prior-attempts/`,
  `tick-verdicts.jsonl`) exists only there. Under `afterCommit` it is
  therefore *not* nested under `repoRoot` — the worktree lives inside it —
  so a gate never derives a repo-relative path from the two.
- **`stateRootRel`** is the state root's path relative to the primary repo
  root, in git's own alphabet — forward slashes, whatever the host's separator —
  set when the state root lives inside the repo and absent when it is
  relocated outside it. It is the one value a gate needs to read a
  **tracked** state-root file as the gated commit holds it —
  `git show <commitSha>:<stateRootRel>/plan/pending/<tag>.json` — and the
  dispatcher computes it once, the same computation the friction harvest
  already makes, rather than each gate re-deriving it from paths that are
  not nested. A gate that reads a tracked file off `flumeDir` instead reads
  the previous commit's copy under `afterCommit`; `pendingGate` reads at the
  sha.
- **A `GateContext` field the dispatcher always sets is required in the type.** No
  builtin carries a second derivation to fall back to, and no field is optional for a
  hand-built fixture's convenience: a fixture assembles what a tick hands a gate, or
  the test drives a real tick. `commitSha`, `touchedPaths` and `baseSha` are set on
  every dispatcher-built context; `stateRootRel` is the one genuinely absent case (a
  relocated state root) and is a required key carrying that absence.
- **`baseSha`** — the sha the span started from: the worktree's tip when the
  tick branched, the same value the dispatcher cherry-picks from. Set on both
  stages. A gate that needs the *tree* at that sha, not a file from it, asks
  the API for a detached checkout (`api.git.checkoutAt`) placed under the
  state root's worktree base and removed by the engine when the gate returns —
  a differential gate never provisions its own. It is how a gate tells an input the tick *ignored* from one it
  *never saw*: `git log <baseSha>..HEAD -- <inputs>` names what landed on
  trunk after the tick branched, and `git show <baseSha>:<path>` is the
  input as the tick read it. Without it a gate reading trunk claims reverts
  a tick for a note that post-dates it, and the chain rebuilds the base from
  a worktree path convention the engine never promised.
- **`landedOnSha`** — under `afterMerge`, the trunk tip the gated span landed
  onto: the lower end of the range `touchedPaths` is diffed over, and the
  trunk as this entry found it before its own commits were carried across.
  Absent under `afterCommit`, where no trunk is involved and `baseSha` is the
  whole story. It is how a per-entry cumulative gate on trunk — one that
  measures a set before and after this entry and refuses growth — reads the
  right *before*: `baseSha` is what the tick *saw* when it branched, and every
  sibling in a fanout wave shares it, so a gate measured against it inherits
  every sibling's landing; `HEAD^` is right only while a span lands as one
  commit. Set on every dispatcher-built `afterMerge` context.
- **`entry`** — the pending entry the gated span was provisioned for, as the
  wave selected it; set at both stages under fanout, absent on a singleton
  tick, which carries no entry. It is how a chain gate holds a commit to the
  entry's *own* contract — the behaviors its `tests[]` names, an acceptance
  its extension declares — rather than to the phase's uniform bar alone. The
  engine reads none of those fields (`.flume/PROTOCOL.md`, *What an entry
  carries*); a gate the chain declares may, and the dispatcher already holds
  the entry for the scoped fence union, so it is reported rather than
  re-read from the queue.
- **`log`** is the harness-side output channel; a gate does not write to stdout
  itself.

## What a gate returns

`GateResult` is `{ ok, message, details?, failingFiles?,
skipped?, verdict?, blamesSpan? }`.

- **A gate that throws is a gate that failed.** The engine catches the throw at
  every gate-run site, records `{ ok: false, message: <the error's message>,
  details: <its stack> }` for it — the stack is the `details` a returned
  refusal would have carried — and completes the tick — verdict written, merge bookkeeping done —
  exactly as it would for a refusal the gate returned. A gate's exception is
  a fact about the gate, never a reason to lose the tick's facts or to strand
  a merge behind the crash marker (`spec/loop.md`, *Crash equals stop*).
- **`verdict?: string`** — a chain-authored discriminant for *why* the gate
  ruled as it did, persisted verbatim onto the tick verdict's gate result and
  onto a `gate-revert` prior-attempt record beside `message`. The engine
  interprets it no further, as with `skipped`. A chain whose next tick keys on
  the reason reads this field rather than re-reading its own prose.

- **`skipped?: string`** — the gate did not run its judge, and says why: no
  code path among the touched paths, a runner the chain scopes out by design.
  `ok` stays required and stays the verdict the engine acts on; `skipped` is
  the fact that the verdict was not earned by running anything. The engine
  copies it onto the tick verdict's gate result verbatim and interprets it no
  further. A gate that returns `ok: true` without `skipped` claims it ran
  (`.claude/rules/engineering.md`, *A green verdict is proven non-vacuous*:
  vacuous-by-design is spelled, never inherited).

- **`failingFiles?: string[]`** — repo-relative paths the gate attributes the
  failure to, when the gate's runner can name them (a test reporter's JSON, a
  type-checker's diagnostics). Copied onto the tick verdict's gate result and
  the `gate-revert` record verbatim; the engine derives nothing from it. A
  span's edits can red a file they never touched — a pin in a test module
  that reads the whole tree — so disjointness from the footprint proves
  nothing, and attribution is the gate's to declare (`blamesSpan`, below).

- **`blamesSpan?: false`** — the gate says this failure is not the gated
  span's: the suite was red at the base, or a resource the span never
  touched refused. The engine withholds the entry-scoped half of the stage
  failure — no quarantine key, no blame on the prior-attempt record —
  exactly as a singleton's own revert already carries none, while the
  consecutive-failure backstop still counts the failed tick. The revert
  itself still happens; a span that cannot be judged does not land. Absent
  or `true` is today's behavior. A declared fact, never a reading of
  `verdict` or `message`.

## What a hook receives

`shouldRun`, `promptArgs`, `handoff`, and `shipped` are the chain's four
interpretation points. Each receives one read-only object carrying the facts
the engine holds at that moment (`.claude/rules/engine-boundary.md`, *Surface,
not prescription*: a hook receives facts, never re-derives them). The test for
adding a field: a chain that reads `process.env`, scans a directory under
`flumeDir`, or recomputes a verdict the dispatcher already reached is naming a
missing field, and the field is added rather than the chain excused.

A hook that throws is answered the way its sibling seams already are, never
by losing the tick. `promptArgs` throwing is `render-refused`: the prompt never
resolved, the agent is never invoked, and the record is persisted as for any
other render refusal. `shouldRun` throwing is a refused tick, not a decline —
a hook that cannot decide has not decided to skip. `handoff` throwing is logged
and the tick's facts stand, since they are written before it runs. `shipped`
throwing is not `false`: the entry stays pending and the verdict names the
throw, as it names a declined ship. In every case the verdict is written and
the merge bookkeeping completes.

- **`TickContext`** (`shouldRun`, `promptArgs`) —
  `cwd`, `flumeDir`, `assignedEntry` (fanout), `pending` (singleton), plus:
  - **`stateRootRel`** — the state root's path relative to the repository
    root, as the dispatcher resolved it; absent only when the root is
    relocated outside the repository. A chain naming a repo-relative artifact
    (a build note, a queue path in a prompt) reads this rather than deriving
    it from `flumeDir` and `repoRoot` a second time.
  - **`pickable`** — the entries the dispatcher would select right now: the
    strict-read queue with `blockedBy` resolved, every declared fork checked
    through the chain's `forkResolver`, `requiresCapability` checked against
    `Chain.capabilities`, and this run's quarantine drop applied. The same
    computation fanout selection uses, so a
    singleton `shouldRun` and the next fanout tick cannot disagree.
  - **`priorAttempts`** — every persisted `PriorAttempt` record under
    `<flumeDir>/prior-attempts/`, keyed by keyspace and identity — `entry:<tag slug>`
    for fanout entries, `phase:<phase name>` for singletons — so the two keyspaces
    never collide in the map, as they never share a stem on disk; read with the
    engine's own reader and
    the engine's own tolerance (a corrupt record is absent). A plan-phase
    `shouldRun` deciding "build has a standing bail to reconcile" reads this
    map; it does not `readdirSync` the engine's directory. A park is in the
    same map (`not-shipped`), so "build parked, plan reconciles" is a read of
    this field too — never of the verdict log.
- **`TickResult`** (`handoff`) — the existing
  facts (`committed`, `commitSha`, `gateResults`, `pendingAfter`,
  `shippedTags`, `revertedTags`, `noCommit`, `quarantinedTags`,
  `nothingPickable`) plus:
  - **`pickableAfter`** — `pendingAfter` filtered by the same dispatcher
    verdict as `TickContext.pickable`, taken at the post-tick re-read. A
    handoff that wakes build on "anything pickable" reads this list; it does
    not call `isPickableNow` with a default resolver and an empty capability
    set, which is a different verdict with two inputs missing.
  - **`flumeDir`** and **`configDir`** — the resolved roots, so a handoff that
    writes or reads a state-root file has them without `process.env`.
  - **`baseSha`** — the span's base, the same value `GateContext.baseSha`
    carries (*What a gate receives*), so a handoff routing on "did anything
    land on trunk that this tick could not have seen" compares against the
    engine's number rather than the worktree's reflog.
  - **`entries`** (fanout only) — one record per entry the wave handed to its
    agent, carrying what the wave knew about it: its tag, whether it committed,
    shipped, reverted or declined, its no-commit class, its merge-stage fact, and
    the entry's chain-declared payload as the queue held it — the shipped type is
    the roster. `mergeOutcome` is the entry's merge-stage fact as the verdict records it
    (`merged`, `not-shipped`, `cherry-pick-conflict`, …), so a handoff can tell a park
    from a conflict without reading the verdict log — the same
    facts the wave already folds into `shippedTags`, `revertedTags`,
    `noCommit`, and `declined`, reported before the fold. The fold stays: the
    top-level fields are the wave's summary and remain byte-identical. What
    `entries` adds is the per-entry `noCommit` mode that the summary loses
    whenever a sibling shipped — a bailed entry on a wave that also landed
    work is otherwise invisible to `handoff`, which re-picks it with the bail
    undrained. Absent on a singleton tick and on a wave that provisioned
    nothing. An entry whose provisioning failed — at create, or in the chain's
    `setupWorktree` hook — is on **`provisionFailures`** under its tag instead
    (`spec/worktrees.md`, *`setupWorktree` and `teardownWorktree`*), never a
    record here with every flag false.
  - **`provisionFailures`, `gateFailures`, `mergeFailures`** — the three
    stage-failure classes the tick verdict carries, folded from the same
    value and keyed by tag: an entry whose provisioning failed, one an
    `afterMerge` gate reverted, one whose span could not be cherry-picked.
    Each carries the entry, the message, and the failure's signature, and
    says whether the engine blamed the entry — a gate that disowned the span
    (*What a gate returns*, `blamesSpan`) produces a failing row in
    `gateResults` exactly like one that did not, and only here is the
    difference stated. A handoff counting how many of a wave's entries fell
    to one gate on one message reads these rather than re-pairing failing
    rows against `revertedTags`. A fact, never a verdict.
- **`ShipContext`** (`shipped`; `spec/pending.md`, *Ship detection trusts the
  agent's own account*) — entry, merged sha, touched paths, gate results,
  worktree path before teardown, and the same `baseSha`.

Every addition is a fact the dispatcher already computed for its own use. None
is an interpretation: the engine says which entries it *would* pick and which
records *exist*; whether to wake, decline, or reconcile stays the chain's.

## The builtin gates

The set is deliberately small — the gates most chains reach for, so a chain
does not rebuild exec plumbing to run `tsc`. `chainLoadGate` is above;
`pendingGate` and `writablePathsGate` are `spec/pending.md`.

- **`shellGate({ name, when, cmd, args, maxBuffer?, failHint?, env? })`** — the
  escape hatch, and what the others are built from. Verdict is exit code alone,
  and so is blame: no shell-backed gate observes a base, so none can declare
  `blamesSpan: false` (*What a gate returns*), and over a trunk already red a
  shell gate blames whichever span happened to be gated. What bounds that is
  the consecutive-identical-failure abort (`spec/loop.md`), which holds while
  the wave's failures share a signature — true of a constant `failHint`,
  not of a `message` carrying per-entry text.
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
  (`PkgManagerGate`): used bare (`gates: [tscGate]`) each
  *is* a pnpm-flavored `Gate`; called with `{ cmd?, args? }` each returns the
  same check through another package manager. `cmd` alone only suffices for a
  binary that accepts pnpm's arg shape — npm has no bare `npm tsc --noEmit` and
  needs the `args` override too. The chain supplies the binary, the engine
  supplies the enforcement.
- Gate binaries are spawned direct-then-shell-on-win32-`ENOENT`; the reason is
  `.claude/rules/platform-facts.md`.

## Per-run artifacts belong under `FLUME_DIR`

The teardown promise — one `rm` removes the whole footprint — holds only if
**every** mutable artifact lives under the state root. The runtime resolves
that root and hands it to the chain; it does not decide what a chain writes
into it.

- **The runtime canonicalizes, then loads.** `flumeDir` and `configDir` are
  resolved to **absolute** paths before any code path constructs the chain.
  This holds for every verb that
  loads a chain — `tick`, `loop`, `status`, `wake`, `sleep`, and `check`
  alike. The resolved values are also written back to
  `process.env.FLUME_DIR` and `process.env.FLUME_CONFIG_DIR` so spawned
  children (an agent, a gate's shell) inherit one answer; the env is a
  child-process channel, not the chain's read path.
- **The engine hands the chain its roots.** `FlumeApi.paths` carries
  `{ repoRoot, configDir, flumeDir }`, absolute, the identity-same values the
  dispatcher was constructed with (`buildFlumeApi` takes them
  as its argument), and `stateRootRel`, the state root's repo-relative offset in
  git's alphabet — the same value the tick and gate contexts carry — so a chain
  roots a fence or a pathspec at the state root without deriving the offset
  itself; absent when the root is relocated outside the repository. A chain that places a per-run artifact resolves against
  `api.paths.flumeDir`. It never reads `process.env.FLUME_DIR`, and it never
  falls back to its own directory: a chain with a `?? CHAIN_DIR` leg is
  re-deriving a fact the engine already resolved
  (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
- **Whether to capture is the chain's; where the root is, is not.** Session
  capture stays an opt-in decorator (`withSessionCapture`) whose `dir` is
  required and has no default: the runtime ships no opinion on whether a
  chain keeps transcripts or under what name. What it removes is the
  resolution: `withSessionCapture(agent, { dir: resolve(api.paths.flumeDir,
  "sessions") })` is the whole placement, and `examples/` shows it. An
  absolute path still matters — a fanout tick runs inside the worktree base
  (`<flumeDir>/worktrees/` by default, relocatable), so a relative dir would
  land in a worktree git later removes.
- A relocated state root is expected to live outside the working tree, so no
  in-repo gitignore glob is added for it; the default `<repoRoot>/.flume`
  receives the runtime-ignore merge (`spec/jobs.md`, *Runtime ignores*). The
  harness package does not support a relocated root
  and refuses it at load (`spec/harness.md`, *Committed-path discipline*).

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
- **Git 2.36 or newer.** The engine reads `worktree list --porcelain -z`, which
  git grew in 2.36; on an older git worktree reclamation degrades loudly and
  nothing else does. `flume loop` reads the version at
  start and, below the floor, warn once naming the version, the floor, and
  what degrades — a warning, not a refusal, because the degrade is bounded to
  reclamation and the loop is otherwise a working one. A version the run
  cannot read — no git on the path, a wrapper answering in its own words —
  warns the same way, naming the floor as unconfirmed rather than met;
  silence is reserved for a floor that was read and cleared. Stated here beside the node floor so the README's
  prerequisite line derives from one place.
- **ESM-only.** `"type": "module"`, Node 22+. `attw --pack . --profile esm-only`
  is the accurate *profile* — the default profile's `CJSResolvesToESM` finding
  is the expected shape, not a defect — but it runs non-blocking in CI while
  the upstream crash stands; the binding declaration-shape check is the
  consumer-install smoke.
- **A strict, enumerated `exports` map.** `"."` and `"./harness"`
  (`spec/harness.md`, *Where it lives*) — no subpath patterns,
  no `./internal/*` escape hatch; a consumer needing an internal export files
  for promotion. The conditions are `types` then **`default`** — *not* `import`.
  This is load-bearing: flume's own chain loader resolves the bare package
  specifier through `tsImport`, which takes a require-ish resolution path, and
  an `import`-only map fails it with `ERR_PACKAGE_PATH_NOT_EXPORTED` — breaking
  the prescribed consumer pattern (`import … from "@dtmd/flume"` inside
  `.flume/chain.ts`) while remaining invisible to tsc, vitest, and attw. Only a
  consumer-install smoke catches it. `default` is the catch-all condition,
  each entry resolving to one ESM build.
- `"main"` and `"types"` are duplicated outside `"exports"` because npm only
  shows the TS-package icon when top-level `"types"` is set.

**Standing acceptance:** a fresh consumer project resolves and typechecks
`import { … } from "@dtmd/flume"`; deep paths (`@dtmd/flume/src/Dispatcher.ts`,
`@dtmd/flume/dist/Dispatcher.js`) fail at module resolution.
