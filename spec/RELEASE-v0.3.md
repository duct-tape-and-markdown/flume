# Flume — v0.3.0 Release Target

## 1. Purpose & scope

A foundations governor for the build phase. Today an entry is pickable when its
`gate` is `open` and no sibling `blockedBy` upstream is unshipped. That is the
only dependency the dispatcher understands — an **entry→entry** edge. It has no
notion of an **entry→open-question** edge: an entry can cite a spec section whose
product/UX decision is still an unresolved fork in `.flume/plan/open-questions.md`,
carry `gate: open`, pass every validation gate, ship, and sit on an undecided
foundation. Across a long autonomous run this is the _build-laterally_ failure
mode: the loop, never allowed to idle while _something_ is buildable, accretes
surfaces on foundations it has itself flagged as open.

v0.3.0 closes that leak with the smallest mechanism that mirrors the existing
`blockedBy` machinery: a declared **entry→fork** dependency plus an **injected**
resolution predicate. The runtime stays format-agnostic about how a consumer
records or resolves forks; it only learns to _ask_. Scope is additive and
non-breaking (§6). Consumer adoption — including the cascade resolver and any
flume-on-flume self-adoption — is out of the runtime deliverable (§8).

## 2. The `dependsOnForks` declaration

- **New optional field on `PendingEntry`** (`src/PendingSchema.ts:79`):
  `dependsOnForks: z.array(z.string().min(1)).default([])`. Each string is an
  opaque **fork slug** — an identifier the consuming project uses to key its
  open questions (cascade: kebab slugs like `joincoach-5`; flume-on-flume:
  `OQ#` ids). The runtime never parses the slug; it is a token passed back to
  the consumer's resolver (§3).
- **Why a side-array, not a new `gate` kind.** `gate` is a discriminated union
  — one entry has exactly one gate state. But an entry can be simultaneously
  `open` (would build now) _and_ rest on two open forks _and_, later,
  `requiresDockerHost`. Foundations are a **cross-cutting predicate**, not a
  mutually-exclusive lifecycle state; folding them into `gate` would force the
  plan agent to choose between recording a fork dependency and recording any
  other gate, losing information. A composable array is strictly more
  expressive for the same code.
- **Additive by construction.** The field defaults to `[]`, so every existing
  `pending.json` entry stays schema-valid with no migration and no plan churn.
  An entry with no fork dependency is unchanged in every observable way.
- **Rendered in the plan schema** (`renderSchemaForPrompt`): one documented line
  so the plan agent emits it — _"open-question slugs this entry's foundation
  rests on; omit if none."_

## 3. The fork-resolution seam

Resolution detection is **consumer policy, injected**, never baked into the
runtime.

- **`DispatcherOptions` gains `forkResolver?: (repoRoot: string) => (slug: string) => boolean`.**
  It returns, for a given repo, a predicate answering "is this fork resolved?"
  The dispatcher calls it once per tick and threads the resulting predicate into
  pickability (§4). **Default: a predicate that returns `true` for every slug**
  — so a chain that supplies no resolver is behaviourally identical to v0.2, and
  a chain that declares no `dependsOnForks` never invokes it.
- **`ChainModule` gains an optional `forkResolver` of the same shape**, and the
  dispatcher resolves `chainModule.forkResolver ?? this.opts.forkResolver` once
  per tick — exactly as `agent` overrides the constructor default. This is the
  bridge a **stock-CLI consumer** uses: a project running the published `flume`
  binary cannot reach `DispatcherOptions`, so it exports `forkResolver` from its
  `.flume/chain.ts` and the governor picks it up per tick. A rewritten chain.ts
  changes the resolver on the next tick's fresh process, like every other chain
  export.
- **The runtime is format-agnostic.** It does not know that cascade marks
  resolution with `RESOLVED` on the slug line, or that flume-on-flume uses an
  `OQ#` header convention. Encoding either in the runtime would couple the
  generic harness to one project's prose format — the same coupling §2 of v0.1
  keeps out of the gate set. The resolver is where that knowledge lives, on the
  consumer side, exactly as chain gates already localize consumer policy.
- **Fail-open is the resolver's contract, documented, not enforced.** The
  recommended resolver treats an **absent** slug as resolved (a fork answered
  and deleted must _unblock_ its dependents, never wedge them) and a
  **mistyped/unknown** slug as resolved (a bookkeeping error must never
  permanently block the loop). The runtime takes no position; it trusts the
  predicate. `docs/CHAIN-AUTHORING.md` gains the resolver-authoring guidance
  with the fail-open rationale and a worked cascade example.

## 4. Pickability integration

- **`isPickableNow`** (`src/PendingSchema.ts:227`) gains a third optional
  parameter `isForkResolved: (slug: string) => boolean = () => true`. Before the
  existing `gate` switch it short-circuits: if any `entry.dependsOnForks` slug is
  unresolved, return `false`. The foundations check thus composes with — and
  precedes — every gate kind, including `open`.
- **The dispatcher's internal `isPickable`** (`src/Dispatcher.ts:1416`) gains the
  same optional predicate and applies the same pre-switch short-circuit, so the
  `blockedBy` filter and the foundations filter run side by side in one pass.
- **Wiring.** `tick()` resolves `chainModule.forkResolver ?? this.opts.forkResolver`
  once per tick (beside the `agent` override) and passes it into `runFanout`,
  which computes `resolve = forkResolver?.(repoRoot) ?? (() => true)` and threads
  it into the fanout selection: `pending.filter((e) => isPickable(e, pending, resolve))`.
  Selection is the sole site — `runSingleton` does not pick from pending.

## 5. Selection-time semantics

The governor runs **at selection time, before any agent is invoked or any
worktree is created** — the same place and shape as `blockedBy`. A fork-blocked
entry is simply _not pickable this tick_. The three consequent behaviors fall out
of the existing `runFanout` filter for free:

- **Skip-to-settled.** Because `runFanout` already filters the whole pending list
  before partitioning, a fork-blocked head entry is skipped and a deeper
  foundation-settled entry builds. No new code path.
- **Idle, not build-laterally.** If _every_ `open` entry is fork-blocked,
  `pickable.length === 0` and `runFanout` already returns the clean no-work
  outcome (`Dispatcher.ts:492`–`onward`) → handoff advances the phase → the loop
  drains to hibernation. **A hibernating loop here is the intended signal**, not
  a fault: it means the next work needs a human workshop decision, which is
  louder and safer than shipping onto an open foundation.
- **Never failed, never reverted.** A fork-blocked entry is not mutated, not
  marked failed, and burns no gate-revert. It is invisible to selection until its
  foundation lands, then picked up automatically on the next tick — exactly like
  a `blockedBy` entry whose upstream has not shipped. Workshop routing is a no-op
  by construction: the fork is _already_ in `open-questions.md`, the
  human-bound backlog.

## 6. Versioning & distribution

- **0.3.0**, a minor. The foundations governor (§§2–5) is wholly additive: a new
  defaulted schema field, a new optional `DispatcherOptions` member, and new
  trailing optional parameters on `isPickableNow` and the internal `isPickable`.
  No existing signature breaks; flume-on-flume's `.flume/chain.ts` (which imports
  `../src/`) typechecks unchanged. Governed by v0.1 §9: new backward-compatible
  functionality → minor.
- **0.3.0 also carries the relocatable-state deliverable (§§10–15)**, which adds
  the release's one **breaking** change — the `Baton(flumeDir)` constructor
  signature (§11). Pre-1.0 a minor may break the public surface (v0.1 §2, §9), so
  0.3.0 stays a minor and the break lands under a `### Breaking` subheading.
  Folding into 0.3.0 (rather than a new 0.4 line) is correct because **0.3.0 is
  unpublished** — `0.2.0` is the current npm release, so the still-in-repo 0.3.0
  is the right home for both deliverables.
- **`CHANGELOG.md`** records the governor field/seam/semantics under `### Added`,
  and the relocation surface + sessions closure under `### Breaking` / `### Added`
  / `### Fixed`, all citing 0.3.0.

## 7. Tests

- **Schema** (`tests/PendingSchema.test.ts`): an entry parses with `dependsOnForks`
  defaulting to `[]`; a populated array round-trips; `isPickableNow` returns
  `false` when a declared fork is unresolved by the predicate and `true` when all
  resolve; the default predicate (no argument) preserves v0.2 behavior for every
  gate kind.
- **Dispatcher** (`tests/Dispatcher.test.ts`): in a fanout tick, an entry whose
  fork is unresolved is skipped while a settled sibling builds; when all `open`
  entries are fork-blocked the tick yields the clean no-work outcome (no commit,
  no revert, phase advances); a fork-blocked entry becomes pickable on the next
  tick once the predicate flips to resolved; with no `forkResolver` supplied,
  selection is identical to v0.2.
- **Resolver injection**: `forkResolver` is invoked once per tick with the repo
  root and its predicate governs selection; a chain that supplies none is
  unaffected.

## 8. Non-goals for 0.3.0

- **The cascade resolver is not shipped here.** Reading cascade's
  `open-questions.md` and the `RESOLVED`-on-the-slug-line convention is cascade's
  `.flume/chain.ts`, not the runtime.
- **No flume-on-flume self-adoption in this release.** Wiring flume's own chain to
  a resolver over its `OQ#` convention is a separate, optional adoption step; the
  runtime ships the capability and the always-resolved default.
- **No generic fork registry / `forks.json`.** Resolution stays a predicate over
  the consumer's existing human-owned source of truth — one home for the fact.
  A structured registry is revisited only if the predicate approach proves lossy.
- **No auto-derivation of `dependsOnForks`.** Plan declares the dependency
  explicitly when an entry's cited spec section rests on an open fork; the runtime
  does not infer it.
- **No slug-existence validation.** A slug that matches no fork is treated as
  resolved by the recommended resolver (fail-open, §3). An optional plan-phase
  lint warning is possible but out of scope.

## 9. Resolved decisions

- **Side-array, not a `gate` kind.** Foundations cross-cut gate state; an entry
  can rest on a fork and also need Docker and also be `blockedBy`. A composable
  `dependsOnForks` preserves all of that; a `gate: blockedByFork` kind would
  force false either/ors and destroy information. Rejected: the new-gate-kind
  shape.
- **Resolution is injected policy, not runtime knowledge.** The harness must not
  learn any project's prose convention for marking a fork resolved. The predicate
  seam keeps the runtime generic and puts format knowledge where every other
  consumer policy already lives — the chain. Rejected: a runtime that greps
  `open-questions.md` itself.
- **Fail-open bias lives in the resolver contract.** Absent slug ⇒ resolved
  (deleting a settled fork unblocks dependents, never wedges them); unknown slug
  ⇒ resolved (a typo must not permanently block). Every degradation is a _missed
  block_, never a stuck loop. The runtime is neutral and trusts the predicate;
  the bias is documented guidance in `docs/CHAIN-AUTHORING.md`. Rejected:
  fail-closed (a deleted or mistyped fork freezing its dependents forever).
- **Selection-time, not an `afterCommit` gate.** The check is a deterministic
  fact answered before work starts — cheapest, pre-worktree, and structurally
  identical to `blockedBy`. An `afterCommit` foundations gate would build the
  surface, then revert it — wasting a worktree and a commit to discover what
  selection already knew. Rejected: the build-then-revert backstop. Rejected
  also: a build-_prompt_ instruction to self-bail, which pays the
  `open-questions.md` read every tick and relies on the very agent compliance
  that has been failing.
- **Idle is the intended terminal, not a failure.** When all `open` work rests on
  open forks, hibernating is the correct outcome: it surfaces a loud, observable
  signal (visible in `flume status`/`state.md`) that the next move needs a human
  workshop decision. Shipping laterally onto an open foundation — the v0.2
  behavior — is the actual failure this release removes.
- **Additive minor, no shims.** All four touch-points are backward-compatible
  (defaulted field, optional option, trailing optional params). v0.1 §9 → minor;
  the pre-1.0 clean-slate posture forbids compatibility shims, and none are
  needed.

---

# Second deliverable: relocatable state dir

## 10. Purpose & scope

A **relocatable state dir**. Flume's mutable runtime state — the baton
(`awake/`), pending (`plan/pending.json`), worktrees (`worktrees/`), and
prior-attempt records (`prior-attempts/`) — has always lived at the fixed
`<repoRoot>/.flume`. 0.3.0 also moves all of it under one configurable root,
`flumeDir`, so a fully self-contained, ephemeral harness can **attach** to a
repo, **run**, and be **torn down in a single `rm`** without its state bleeding
into `<repoRoot>/.flume` (the attach-work-detach posture).

The runtime surface — `DispatcherOptions.flumeDir?`, the `FLUME_DIR` /
`FLUME_CONFIG_DIR` env vars, the `Baton(flumeDir)` constructor change, and the
`flume render` `configDir` fix — **already landed** on `main` (unreleased). This
deliverable records that surface for traceability (§11) and closes the two gaps
it left open (§12, §13): the teardown promise leaked because session logs did
not track `flumeDir`, and the surface was undocumented. The dogfood chain
(`.flume/chain.ts`) and docs adopt the completed contract.

## 11. The relocation surface (landed; recorded here)

- **`DispatcherOptions.flumeDir?: string`** (`src/Dispatcher.ts`) — mutable-state
  root; default `<repoRoot>/.flume`. The dispatcher derives the baton, pending
  path, worktree root, and prior-attempt dir from it. Independent of
  `configDir`; set both equal to co-locate config and state.
- **`Baton(flumeDir)`** (`src/Baton.ts`) — constructs from the state dir, not the
  repo root; `awake/` is `<flumeDir>/awake`. **Breaking** vs v0.2 (the
  constructor previously took `repoRoot` and appended `.flume/awake`); for the
  prior location callers pass `join(repoRoot, ".flume")`.
- **CLI env vars** (`src/cli.ts`) — `FLUME_DIR` relocates the state dir,
  `FLUME_CONFIG_DIR` relocates the chain+prompt dir. Both default to
  `<repoRoot>/.flume`. They cross the `loop`→`tick` process boundary by env
  inheritance: `defaultTickRunner` spawns the child with no `env:` override, so
  the child inherits the supervisor's `process.env`.
- **`flume render` fix** — `render` resolved prompt files from
  `<repoRoot>/.flume`; it now honors `configDir` (and `FLUME_CONFIG_DIR`).

## 12. Sessions track `flumeDir`

The teardown promise — "one `rm` removes the whole footprint" — is only true if
**every** mutable artifact lives under `flumeDir`. Session-capture logs did not:
the chain configures their location, and the dogfood chain pinned them to
`resolve(CHAIN_DIR, "sessions")` — i.e. `configDir`, which diverges from
`flumeDir` whenever the two are relocated independently. A relocated dock's `rm`
would leave session logs behind under `configDir`.

The fix has two halves — one runtime (build lane), one chain (harness lane):

- **Runtime canonicalizes the resolved root into the env** (`src/cli.ts`, build
  lane). After resolving `flumeDir` and `configDir`, the CLI writes the resolved
  **absolute** paths back to `process.env.FLUME_DIR` and
  `process.env.FLUME_CONFIG_DIR`. A chain (loaded later in the same process via
  tsx) and any spawned child then read the **single resolved value** rather than
  re-deriving the default or falling back to a coincidentally-equal `configDir`.
  This makes `FLUME_DIR` a reliable, always-present source of truth for the
  state root, not a maybe-absent caller convenience.
- **The chain points sessions at the canonical root** (`.flume/chain.ts`,
  harness lane — outside build's `writablePaths`, landed as `chore(flume):`):
  the session dir becomes `resolve(process.env.FLUME_DIR ?? CHAIN_DIR,
  "sessions")`. With the canonicalization above the `??` fallback is defensive
  only; in normal operation `FLUME_DIR` is always set to the resolved root. This
  is the **reference implementation** of the chain-author requirement documented
  in §13 — session placement is a chain concern, the runtime only supplies the
  root.

The `src/Dispatcher.ts` doc comment that locates prior-attempt records "beside …
session logs (`<flumeDir>/sessions/`)" becomes accurate under this change and is
verified (and clarified that placement is chain-supplied) rather than rewritten.

## 13. Documentation & posture

- **Dock lives outside the repo.** A relocated dock is expected to live outside
  the working tree (e.g. a tmpdir), so `.gitignore` needs no change: the default
  `<repoRoot>/.flume` stays ignored exactly as today, and an out-of-tree dock is
  invisible to git by construction. `README.md` and `docs/CHAIN-AUTHORING.md`
  document this expectation explicitly; no in-repo dock glob is added (§14).
- **README** documents `FLUME_DIR` / `FLUME_CONFIG_DIR`: what each relocates,
  their defaults, the attach-work-detach posture, and the one-`rm` teardown.
- **`docs/CHAIN-AUTHORING.md`** documents the chain-author requirement: a chain
  that captures sessions (or any other per-run artifact) must place it under
  `process.env.FLUME_DIR` for the dock to be fully self-contained, with the
  dogfood chain (§12) as the worked example.

## 14. Relocation tests & non-goals

- **Baton** (`tests/Baton.test.ts`) — already asserts a relocated `flumeDir`
  places `awake/` under the given dir and leaves `<repoRoot>/.flume` untouched
  (landed with §11). No change required; recorded here as the relocation
  invariant.
- **CLI env canonicalization** (build lane) — after resolution,
  `process.env.FLUME_DIR` and `process.env.FLUME_CONFIG_DIR` hold the **absolute
  resolved** root for both the default (env unset) and relocated (env set,
  possibly relative) cases, so a chain reading the var sees one canonical value.
  Asserted at the resolution seam in `src/cli.ts` (extract the resolver if
  needed for testability).
- **Process-boundary inheritance** (`tests/loop-process-boundary.test.ts` or a
  sibling) — a child `flume tick` spawned by the supervisor observes the
  supervisor's `FLUME_DIR`/`FLUME_CONFIG_DIR`, confirming the §11 inheritance
  claim end-to-end.
- **Non-goals.** The runtime does **not** own session-capture location (it stays
  a chain concern; the runtime only supplies the canonical root). No in-repo
  dock gitignore glob (e.g. `.flume-*/`) — docks live outside the tree. No
  migration of an existing `<repoRoot>/.flume`. No relocation of `.claude/` or
  `spec/` (human/harness territory, repo-tracked, not per-run state).

## 15. Relocation — resolved decisions

- **Sessions track `flumeDir` via env canonicalization.** The dock must be
  removable in one `rm`; sessions under `configDir` broke that. The runtime
  canonicalizes the resolved root into `process.env.FLUME_DIR` and the chain
  reads it — keeping placement a chain concern while making the root
  authoritative. Rejected: **narrowing the claim** (leaving sessions under
  `configDir` and documenting them out of scope) — it concedes the feature's
  headline promise. Rejected: **runtime-owned session capture** — needless
  blast radius on the `Agent` contract.
- **Dock lives outside the repo.** The attach-work-detach posture wants the dock
  off the tracked tree, which makes `.gitignore` a non-issue and keeps the
  default `.flume` ignore rules unchanged. Rejected: an in-repo `.flume-*/`
  convention glob — it legitimizes in-tree docks and adds tracked surface for a
  posture that wants none.
- **CLI canonicalizes rather than the chain re-deriving.** A chain falling back
  to `CHAIN_DIR` is correct only when `configDir == flumeDir`; the whole point
  of relocation is that they can differ. Writing the resolved root to the env
  once, at the CLI resolution seam, gives chains and child processes a single
  source of truth. Rejected: leaving the chain to guess the default.
- **Folded into 0.3.0, not a new line.** 0.3.0 is unpublished (0.2.0 is the
  current npm release), so the relocatable-state surface ships with the
  foundations governor under one minor. The `Baton` break (§11) is the only
  non-additive change and is permitted pre-1.0 (v0.1 §9). Rejected: a separate
  0.4.0 line for work that has not yet shipped to npm.

## 16. `flumeDir` exposure to gates & prompts (ergonomic primitive)

Relocation (§§10-15) moves the state root, and §12 canonicalizes the resolved
root into `process.env.FLUME_DIR`. That is already enough to author a
fully `flumeDir`-aware chain today: a gate can read
`join(process.env.FLUME_DIR, …)`, `writablePaths` can be computed from it at
chain-load, and a prompt can take it via `promptArgs` (`{{TOKEN}}`) or
`$FLUME_DIR` in an inline-exec. **No consumer is blocked on this section** — it
exists to make `flumeDir`-awareness a *blessed, first-class* affordance rather
than a reach into global `process.env` and a footgun where a chain hardcodes
`.flume/` while the dispatcher reads `<flumeDir>/`.

- **`GateContext.flumeDir: string`** (`src/Gate.ts`) — the absolute, resolved
  state root, threaded by the dispatcher into every gate context (it already
  holds `this.flumeDir`). A gate reads `join(ctx.flumeDir, "plan",
  "pending.json")` instead of hardcoding `.flume/` or reaching into
  `process.env`. The dogfood `pendingParseGate` (`.flume/chain.ts`, harness
  lane) adopts it as the reference use.
- **`TickContext.flumeDir: string`** (`src/Phase.ts`) — same value, surfaced to
  `promptArgs(ctx)` so a chain can derive prompt args from the state root
  programmatically.
- **Reserved `{{FLUME_DIR}}` prompt arg** — the dispatcher auto-injects
  `FLUME_DIR` into every prompt's substitution map, alongside the structural
  `<harness>` / `<prior-attempt>` blocks it already prepends
  (`src/Prompt.ts`). A prompt uses `{{FLUME_DIR}}/plan/pending.json` with **zero
  chain boilerplate**; a prompt that never references it is unaffected.
- **`writablePaths` stays `process.env.FLUME_DIR`-derived** — it is static
  config evaluated at chain-load, before any per-tick context exists, so the
  env (canonicalized in §12) is the correct seam there. Called out so it reads
  as a deliberate boundary, not a missing affordance.

This primitive only changes **where** the committed paths point; it never
changes **whether** pipeline state is committed — that invariant
(`docs/INTENT.md`, "the commit is the transaction") is upstream of it and
unchanged. A relocated chain still commits `pending.json`; `flumeDir` only moves
the location all four sites (dispatcher, gate, `writablePaths`, prompt) agree
on.

### 16a. Versioning & tests

- **Additive, 0.3.0.** New fields on dispatcher-*constructed* contexts
  (`GateContext`, `TickContext`) are additive for consumers (they receive more,
  never construct them), and an always-present reserved prompt arg breaks no
  existing prompt. No signature breaks.
- **Tests** (`tests/Gate.test.ts` / `tests/Prompt.test.ts` / `tests/Dispatcher.test.ts`):
  `GateContext.flumeDir` carries the resolved root in both the default
  (`<repoRoot>/.flume`) and relocated cases; `{{FLUME_DIR}}` resolves in a
  rendered prompt with no chain-declared arg; `TickContext.flumeDir` is
  populated at tick time.

### 16b. Resolved decisions

- **Expose via context + reserved token, not "every chain reads `process.env`."**
  `process.env.FLUME_DIR` works but is a global reach-around; a typed
  `ctx.flumeDir` and an auto-injected `{{FLUME_DIR}}` are the blessed seams,
  consistent with how the dispatcher already injects `<harness>` /
  `<prior-attempt>`. Rejected: leaving `process.env` as the only path.
- **`writablePaths` stays env-derived.** It is evaluated at chain-load with no
  per-tick context; threading a context into static config would be a larger,
  unmotivated change. Rejected: a context-bound `writablePaths` builder.
- **Optional, not a blocker.** Shipped because it is the right primitive and
  removes the hardcoding footgun, not because any consumer requires it — the
  dock and any relocated chain already function via §12's canonicalized env.
