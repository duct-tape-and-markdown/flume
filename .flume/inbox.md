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

## 2026-08-05 — proposal: verdict read-side in the CLI (human, via temper bay session; verified interactively)

Operator-facing tick history is renderer scrollback plus a terse `status`;
a supervising agent re-derives verdict/cost/duration/outcome per tick from
three files. The data already exists: `tick-verdicts.jsonl` written by the
dispatcher, `readTickVerdicts` exported on the public surface
(`src/index.ts`) — and **zero references in `src/cli.ts`** (verified). A
read verb (`flume log -n 5`-shaped) would close the gap.

Forks for routing: (a) verb name; (b) output shape — human table vs
JSONL passthrough; (c) boundary: shipped/parked are *chain* vocabulary —
the verb may print only facts the verdict records already carry as
declared statements, never re-classify (`engine-boundary.md`, told-not-
inferred). If the records don't carry the chain's interpretation, the verb
prints engine facts and stops there.

## 2026-08-05 — proposal: `flume check` — validate pending.json without spending an agent (human, via temper bay session; verified interactively)

Operator edits to `pending.json` (manual drain, plan re-authoring) get no
validation until the next tick pays an agent to find out. Verified: no
such verb (`src/cli.ts:280` SUBCOMMANDS); the pieces are pure
(`parsePending`, `touchedPaths`, `isPickableNow`, `matchesAny`), so a
working-tree dry-run is computable without a commit or an invocation.

Fork for routing, and it's the real question: **which checks does `check`
run?** A hardcoded parse+fence pair is the engine deciding which
validations matter — convention risk. Options: narrow verb running only
the engine's own mechanics (pending parse + fence arithmetic), vs a
chain-declared check surface (a `Gate` placement beyond
afterCommit/afterMerge — schema change). Needs a design decision, likely
open-question shaped.

## 2026-08-05 — proposal: `job new` prints the mount path (human, via temper bay session; verified interactively)

First-run failure shape: `job new` seeds and baselines but never wakes
(`src/job.ts:152-217`, ends silently on success), so the first tick greets
a new user with "no phases awake; hibernating." Verified — and refined:
the designed path already exists, `flume job run <name>` wakes the entry
phase iff hibernating (`src/job.ts:269`). So the fix is one next-step line
at `jobNew` success pointing at `job run` (or the documented tick path) —
not instructions to hand-wake. Smallest item in the batch; the
missing-declaration failure already names file and fix, this failure
should too.

## 2026-08-05 — proposal: friction read verbs (`flume friction` list/cat) (human, via temper bay session; verified interactively)

Friction notes are valuable (one downstream note documented a bug for a
future gate implementer) and live gitignored and per-machine — the harder
to read, the faster they evaporate. `status`/`job status`/loop-end already
print the count when the channel is declared and non-empty.

Boundary fork that must be decided first: `spec/chain.md` states the
engine "guarantees the channel's lifecycle **without ever reading its
content**." Listing filenames stays lifecycle-side; a `cat` verb crosses
the stated line (printing-without-interpreting, same class as the count,
but the spec sentence as written forbids it). Either the sentence is
amended to "without ever *interpreting* its content" alongside the verb,
or the verb stops at listing. Human call.

## 2026-08-05 — proposal: harvested chain-preset layer (human, via temper bay session)

Consumer chains converge by copy instead of by construction; a preset layer
would give the shared class an owning artifact. Evidence read from disk:
`temper/.flume/chain.ts` (761 lines, post-0.10-migration) vs this repo's
`.flume/chain.ts` (480 lines, main).

**The cost, three ways:**

1. **Migrations are O(repos).** Temper's 0.9→0.10 migration was ~800
   changed lines, nearly all mechanical restructuring of non-policy code.
2. **Fixes don't propagate.** Both chains hand-rolled the identical
   session-capture filename discriminator; 0.10 absorbed it as the engine
   default; this repo's chain still carries the dead override
   (`.flume/chain.ts` `filename:` in `phaseAgent`). Temper's chain
   regex-sniffs `Phase:` from the rendered prompt to route models —
   `Phase.agent` superseded that seam and nothing told the consumer.
3. **Defects propagate instead.** The backlog-groomer example is copied
   verbatim by instruction, and its error-swallow shipped to every
   downstream chain built from it (0.10 changelog). Copy-time convergence
   distributes bugs with the same fidelity as fixes.

**What the two-chain diff shows:** ~85% shared class (unmeasured read, not
a counted figure): entry-extension shape (summary/per/tests/acceptance/notes
schema+hint pairs), the `per`-narrowing `promptArgs` (character-identical),
the claudeCode + stream-json + `--exclude-dynamic-system-prompt-sections` +
session-capture stack rooted at FLUME_DIR, `pendingGate` with hoisted target
fence, the `Plan continues:` marker handoff idiom, the committed-park
`shipped` predicate shape, ~20 fence boilerplate paths, and the same lane
doctrine restated in NOTE comments in both files. Parameterized middle:
gate placement (cheap afterCommit / expensive afterMerge; tsc/vitest vs
cargo fmt/clippy/test), `setupWorktree` presence, ecosystem fence lists,
per-phase models, park vocabulary (park-file vs channel-only — genuinely
different policy, so a parameter, never a default). True repo policy is
~100 lines each (temper: plan-honesty + entry-refs gates, tag grammar,
metrics wrapper; here: inbox-`shouldRun`, install sentinel).

**Proposal:** a chain preset layer in this repo, versioned and CI-tested
with the engine (`@dtmd/flume/presets` or sibling package) — consumer
chains shrink to their policy; engine releases that reshape chain mechanics
land inside the preset and consumers migrate by version bump.

**Constraints that keep it from becoming a framework:**

- Harvest, don't invent: v1 is the verbatim intersection of the two
  existing chains; nothing enters that isn't already living in two
  consumers. The temper bay volunteers as port-proof.
- Pieces individually exported, escape-hatch-first: ejecting one piece must
  never require leaving the preset, or it's a template with extra steps.
- The bare-`ChainFactory` path stays first-class and tested; the
  engine/chain boundary does not move. Engine-boundary doctrine governs the
  engine; a preset is chain-side packaged convention a consumer opts into.
- Dogfood both: this repo's chain and temper's both port onto v1 in the
  adopting release, or the preset is wrong, not the chains.

**Non-goals:** no scaffold/template (copy-time convergence is the observed
failure mode, not the fix); the document half (prompts, PROTOCOL
conventions, span hygiene, marker vocabulary) is a contract problem checked
at author time — temper's lane, deliberately out of scope here. The halves
compose but don't depend on each other.

**First step (cheap kill-switch):** diff the two chains; extract just the
agent stack + entry extension + park predicates as exported pieces (no
`presetChain` wrapper yet); port both dogfood chains onto them. If the
residual diff isn't overwhelmingly policy, stop — the proposal disproves
itself for the price of one entry.

### Verification addendum (interactive session, same day)

Claims checked on disk before routing:

- **Confirmed:** line counts exact (480 / 761). Temper's `Phase:`
  regex-sniff is real (`temper/.flume/chain.ts:324`, `:749`) and is
  superseded by `Phase.agent` (`src/Phase.ts:141`). The backlog-groomer
  error-swallow and its fix are in CHANGELOG as described.
- **Correction to cost item 2 (flume half):** the `filename:` override
  (`.flume/chain.ts:284`) is **not dead**. It differs from
  `defaultCaptureFilename` (`src/Agent.ts:267`) by extension — `.jsonl` vs
  `.txt` — and this chain's capture content is stream-json, so the
  extension is live policy tracking content format. The engine default is
  format-blind by construction: `withSessionCapture` decorates any `Agent`
  and sees only `AgentInvocation`, never `ClaudeCodeOptions.outputFormat`.
  Do **not** derive a remove-dead-override entry from this claim; the
  harvest point it was evidence for stands on the temper half alone.
- **Missing constraint the proposal needs:** preset pieces must be
  api-parameterized — every exported piece takes `FlumeApi` (or values off
  it) as an argument, and preset modules import no engine *values* — or a
  walk-up-resolved second copy of the preset reintroduces exactly the
  dual-engine split the factory shape removed by construction
  (`spec/chain.md`, *The chain is a plugin, not a consumer*). This is
  decidable at design time and belongs beside the other four constraints.
