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

- **0.3.0**, a minor. Every change is additive: a new defaulted schema field, a
  new optional `DispatcherOptions` member, and new trailing optional parameters
  on `isPickableNow` and the internal `isPickable`. No existing signature breaks;
  flume-on-flume's `.flume/chain.ts` (which imports `../src/`) typechecks
  unchanged. Governed by v0.1 §9: new backward-compatible functionality → minor.
- **`CHANGELOG.md`** records the field, the seam, and the semantics under
  `### Added`, citing this release.

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
