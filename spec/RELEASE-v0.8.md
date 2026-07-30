# Flume — v0.8 Release Target (minor: the boundary line)

## 1. Purpose & scope

One theme: **the engine ships mechanism, never convention** — the
second-implementation test (`.claude/rules/engine-boundary.md`, adopted
2026-07-30) applied to the whole engine surface. Origin finding
(operator audit, 2026-07-30): outside `PendingSchema.ts`, the engine
consumes exactly three things from a pending entry — `tag` (commit
identity, dedup, worktree slugs), `files` (the fence), and
`gate`/`blockedBy`/`dependsOnForks` (pickability). Everything else it
validates, caps, and renders without ever reading: `per`, `summary`,
`acceptance`, `tests`, `notes`, `schemaDelta` ("prisma diff summary" —
another project's stack frozen into the core schema), plus a hardcoded
`requiresDockerHost` enum variant and a tag grammar (`TAG_PATTERN`)
stricter than any mechanical need. Flume-develops-flume has been
steadily freezing its own loop's conventions into the engine; this
line extracts them and installs the injection points that keep them
out.

This line also claims v0.7's deferred structured-verdicts family
(v0.7 §1: engine-side pending validation at the plan gate, plan-time
path pre-checks, persisted revert verdicts) — reconceived under the
boundary rule: the engine **enforces mechanics and reports facts**;
chains own interpretation. §§5–6 carry it.

Blast radius: `src/` (PendingSchema, Prompt, Dispatcher, Phase, cli,
job), `tests/`, `examples/`, `docs/CHAIN-AUTHORING.md`, CHANGELOG.
Dogfood `.flume/chain.ts` adoption legs (§2, §3, §6) are
operator-applied — chain.ts sits outside every phase's fence, same
class as v0.7 §13/§15 — and no entry carries them. Pre-1.0 clean-slate
applies throughout: edit in place, no compat shims, no deprecation
cycles (per `.claude/rules/spec-plan-build.md`).

Explicitly not in this line: multi-chain registries; yarn/bun lockfile
support; any relaxation of the fence/baton/tick contracts themselves.

## 2. Entry schema splits: engine core + chain-declared extension

The core entry the engine owns shrinks to what its mechanics consume:

- `tag` — identity (§3 grammar).
- `files` — `new`/`edit`/`retire`, the fence declaration (the
  per-path optional `description` stays — generic payload within a
  core field, documenting why a path is declared).
- `gate` — `open` / `blockedBy` / `parked` / `deferred` /
  `requiresCapability` (§4).
- `dependsOnForks` — foundations-governor pickability (injected
  predicate, unchanged).

Everything else becomes a **chain-declared extension**: the chain
declaration gains an optional entry-extension block where each field
is declared **once**, carrying both its zod schema and its prompt
hint. The engine composes the merged validator and the rendered
schema block from that single declaration — the existing
`renderSchemaForPrompt` no-drift guarantee (prompt and parser cannot
disagree), preserved across the split. Unknown fields fail validation
exactly as today; a chain declaring no extension gets the bare core.

- `schemaDelta` and the engine's caps on prose it never reads
  (`summary` ≤200, `notes` ≤500) leave the engine with the split. The
  dogfood chain re-declares `summary`, `per`, `tests`, `acceptance`,
  `notes` — with whatever caps it wants — as its extension (operator
  leg).
- `renderSchemaForPrompt` becomes core-plus-extension composition; the
  plan-prompt injection path is otherwise unchanged.

Acceptance: dogfood plan/build ticks run green with the dogfood
extension declared in chain.ts and zero dogfood-specific fields in
`src/`; a chain with no extension validates and renders the bare core;
`grep -ri 'prisma\|schemaDelta' src/` is empty.

## 3. Tag grammar reduces to mechanical safety

`TAG_PATTERN` (`src/PendingSchema.ts:71`) enforces ALL-CAPS-WITH-DASHES
plus a lowercase-only parenthesized slice — convention, not mechanics.
Field burn: `DAL-REWIRE(usp_Filter_Get)` (DAL job mining, 2026-07-29),
a legitimate identifier-shaped slice rejected for grammar the engine
has no stake in; the drained park (TAG-PATTERN-SLICE-CONSTRAINT)
initially proposed widening the regex — still the engine owning
grammar, superseded by this section.

- The engine requires of a tag only what its mechanics need: non-empty,
  unique within the queue, and safe everywhere the engine writes it —
  a commit-message token, a worktree/branch slug, a filename.
  Concretely: a conservative charset (letters, digits, `._()-`), no
  whitespace, and a length bound; build derives the exact bound from
  the real consumers (branch/slug/path limits) and the rendered tag
  line states it.
- A chain wanting stricter grammar declares it in its extension (§2)
  as a refinement on `tag`. The dogfood chain keeps its ALL-CAPS
  convention there (operator leg).
- The rendered tag line states whatever constraint is in force — core
  alone, or core plus the chain's refinement — per §2's no-drift rule.

Sibling disposition, recorded so the park closes: the same inbox pass
reported the `notes` ≤500 cap as unrendered
(PENDING-NOTES-CAP-VISIBILITY). Premise false — both the `summary` and
`notes` caps have been rendered since init (`fa0a770`,
`src/PendingSchema.ts:219`, `:238`); those burns were agent
noncompliance with a stated cap. No work; with §2 the caps become the
dogfood chain's own declaration anyway.

Acceptance: `DAL-REWIRE(usp_Filter_Get)` validates against the bare
core; a tag containing whitespace or a path separator fails; the
dogfood chain's declared refinement still rejects lowercase top-level
tags in dogfood runs; the rendered tag line states the in-force
constraint.

## 4. `requiresDockerHost` generalizes to `requiresCapability`

The gate enum's `requiresDockerHost` variant (`src/Dispatcher.ts:2271`,
deferred "v1" since v0.1) is a hardcoded instance of a real
capability: environment-gated pickability. The mechanism stays; the
named environment leaves.

- Gate kind becomes `{ kind: "requiresCapability", capability: string }`.
- The chain declaration gains `capabilities?: string[]` — the
  environment facts this chain asserts (chain.ts is TypeScript; it may
  probe the environment at load time). An entry gated on a capability
  is pickable iff the string is asserted.
- An entry gated on an unasserted capability is skipped and `status`
  names the missing capability — never a silent skip.
- `requiresDockerHost` is deleted (clean slate); docs show
  `requiresCapability: "docker-host"` as the worked example.

Acceptance: an entry gated on an asserted capability is picked; on an
unasserted one it is skipped and `status` names it; `grep -ri docker
src/` is empty.

## 5. Tick verdict: one facts artifact, engine-written, chain-read

v0.7 shipped three partial fact channels: the §4-amendment per-tick
outcome artifact (counts for the supervisor), §13's revert footprints
(trunk evidence), §15's `TickResult.noCommit` (in-process handoff).
This section unifies the on-disk leg: every tick writes **one verdict
artifact** — phase, entry tag(s), committed or no-commit class, gate
results (name, verdict, message, violating paths), shipped tags,
cherry-pick/merge outcome — at a stable path under the state dir.

- The supervisor's counts/exit-code behavior (v0.7 §4) reads from the
  verdict, superseding the §4-amendment artifact's ad-hoc shape; the
  contract itself is byte-identical.
- Footprint commits (v0.7 §13) remain unchanged trunk evidence, now
  generated from the same verdict record rather than separate capture.
- Engine exports a read accessor (last N verdicts) so a chain can
  render recent history into a prompt; whether and what to render is
  the chain's call.
- No interpretation fields: the artifact records what happened, never
  what it means — "park", "bail worth waking for" are chain readings,
  not engine vocabulary.

Acceptance: a committed tick, a gate-reverted tick, and a
voluntary-bail tick each leave a verdict artifact carrying the facts
above; supervisor exit-code/count behavior is byte-identical to
v0.7 §4, sourced from the verdict; a chain reading last-N verdicts
sees a reverted tick's violating paths.

## 6. `pendingGate`: composed validation and fence pre-check as a builtin

The remaining structured-verdicts items — engine-side pending
validation at the plan gate, plan-time path pre-checks against the
next phase's fence — ship as an opt-in **builtin gate** (the
`builtinGates` convenience library, not engine behavior):

- Validates `pending.json` against the composed core+extension schema
  (§2) at commit time of whichever phase the chain attaches it to.
- Pre-checks each entry's declared `files` against the target phase's
  `writablePaths ∪ entryChannelPaths`: an entry whose declaration
  cannot survive the fence fails the gate **at plan time, naming the
  offending paths**, instead of burning a build tick into a
  guaranteed revert — the GATECONTEXT-REPOROOT-TESTS /
  CLI-JUNCTION-SAFE-ENTRY-TESTS re-file class, extinct.
- The dogfood chain replaces its hand-rolled pending-parse gate with
  this builtin (operator leg).

Acceptance: a pending entry declaring a file outside the build fence
fails the plan-side gate with the path named; a valid queue passes;
dogfood runs the builtin with its extension schema enforced.

## 7. Second reference chain — the boundary's proof

One implementation always fits its engine; two is the test. Ship a
second reference chain of a genuinely different shape in `examples/` —
single-phase, no spec corpus, no plan/build split. E.g. a
backlog-groomer: one phase reads a TODO file, picks an item, ships
it — with its own small extension schema and its own tag refinement,
exercising §§2–4 from a second angle.

- It runs on the unpatched engine. Anything it needs that the engine
  cannot express is a §1-violation finding for this line — filed and
  fixed as mechanism, never special-cased.
- A smoke test drives one full tick cycle against a fixture repo (the
  existing smoke posture).
- `docs/CHAIN-AUTHORING.md` gains the two-chains framing: the
  spec→plan→build derivation chain is the flagship example of the
  engine, not the engine's assumption.

Acceptance: the example chain completes a tick cycle in CI against a
fixture repo with zero `src/` changes attributable to it; docs present
both chains as peers on one engine.

## 8. Supervisor policy knobs ride the boundary

v0.7 §16's quarantine scope and consecutive-identical-failure abort
threshold ship there as engine defaults (run-scoped; three). This
section opens them: the chain declaration carries an optional
supervisor-policy block; the engine's values become defaults, not
behavior.

Acceptance: a chain overriding the abort threshold changes supervisor
behavior accordingly; a chain declaring nothing gets the defaults,
byte-identical to v0.7 §16.

## 9. CHANGELOG

- 0.8.0 section, add to Added (2026-07-30 amendment): migration guide
  for 0.6.x chains, `docs/MIGRATING-0.8.md` (§10).
- 0.8.0 section: Changed — pending-entry schema splits into an engine
  core (tag, files, gate, dependsOnForks) plus chain-declared
  extension fields, one declaration driving both validation and prompt
  rendering; tag grammar reduces to mechanical safety with
  chain-declared refinements; `requiresDockerHost` becomes
  `requiresCapability(string)` matched against chain-asserted
  capabilities; supervisor policy knobs become chain-overridable
  defaults. Added — per-tick verdict artifact (facts only,
  engine-written, chain-readable) unifying the supervisor outcome
  artifact and footprint capture; `pendingGate` builtin
  (core+extension validation plus plan-time fence pre-check); second
  reference chain in `examples/`. Removed — `schemaDelta`; engine caps
  on prose fields the engine never reads.
- Version bump + `npm publish` stay human-performed at cut time; no
  phase writes the version field.

## 10. Migration guide — existing chains onto 0.8.0

Amendment (operator, 2026-07-30): the line shipped reference docs
(`CHAIN-AUTHORING.md` §§7–10 teach the new surfaces from scratch;
CHANGELOG's Breaking section describes the delta) but no upgrade path
for an *existing* chain. The gap has teeth: §2's strict schema means a
0.6.x-era chain hard-fails its first pending.json parse after a pin
bump unless its extension is declared **before** upgrading — and since
no 0.7.0 was ever published, a real bay (connect, temper, the DAL-class
jobs) crosses both lines in one jump.

Ship `docs/MIGRATING-0.8.md`, an ordered checklist written for the
person (or agent) upgrading a bay from 0.6.x. Every code claim verified
against current `src/` at build time — the guide teaches what the
engine does, not what the spec hoped. Source material: the dogfood
chain's own migration (the schema-split landing commit) is the one real
migration performed; mine it for the actual steps and failure modes.

- **Pre-upgrade, in pin order**: inventory every non-core field the
  bay's `pending.json` entries carry; author the chain's
  `entryExtension` declaration (per-field zod schema + prompt hint, one
  declaration) so it lands before or with the pin bump; strip retired
  fields (`schemaDelta`) from `pending.json` or declare them.
- **Mechanical renames**: `requiresDockerHost` →
  `{ kind: "requiresCapability", capability }` plus
  `Chain.capabilities`; `PendingEntry`/`PendingList` become type-only
  imports; extension-field reads narrow through the declared schema
  (`entryExtension.per.schema.parse(...)` — the chain.ts pattern).
- **Recommended adoptions, each with its one-line why**: the
  `pendingGate` builtin (composed validation + plan-time fence
  pre-check) replacing hand-rolled parse gates; the `setupWorktree`
  helper replacing per-repo `npm ci`/`pnpm install` hardcodes (v0.7
  §11 — connect's chain is the named consumer); `supervisorPolicy`
  knobs; wake-on-bail via `TickResult.noCommit` in build handoffs.
- **v0.7 operational deltas the bay will feel on the same jump**: the
  engine↔pin handshake arms (a pinned bay must have its local install
  provisioned or the CLI refuses — name the `job new` provisioning path
  and the unpinned escape hatch); the exit-code contract; bay-discovery
  walk-up.
- **Symptom → cause table** for the failure modes the migration class
  hits: "Unrecognized keys" at the parse gate → undeclared extension
  field; handshake refusal naming a pin → unprovisioned local install;
  tag rejection → chain-declared refinement vs the new mechanical core.

Acceptance: `docs/MIGRATING-0.8.md` exists and README links it; every
API name, gate kind, and code snippet in it resolves against current
`src/` (spot-checked by the build tick, cited in its commit body); the
checklist's pre-upgrade section is explicit that the extension
declaration precedes the pin bump. Non-goals: performing any downstream
bay's migration (each is its own repo's work); duplicating
CHAIN-AUTHORING.md's reference material — the guide links into it.
