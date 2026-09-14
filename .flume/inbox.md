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

## 2026-08-06 — metrics.jsonl stopped recording merges under 0.10.x (jeff pass, asp-egress review)

Observed in the asp-egress job bay (ConnectRoot/worktrees/asp-egress,
`.flume/jobs/asp-egress/metrics.jsonl`): the file has exactly four lines,
all 2026-08-01/02 under engine 0.9.0. After the bay's 08-05 upgrade to
0.10.1, five shipped tags across three merge events
(territory-wiki-pilot-ledger, territory-sproc-surface,
territory-table-surface, census-errata-and-residue-classes,
orphan-caller-channel-sweep) recorded nothing. tick-verdicts.jsonl kept
recording correctly across the same upgrade (24 lines), so the loss is
specific to the metrics writer. Severity: cosmetic in that job, but it is
silent telemetry loss. Cross-ref: the same job's collector drop ("tip
moved (no commit)" on a valid base+1 worktree in a 3-way fanout) appears
FIXED by 0.11.0's per-entry ancestry tip-verify — if confirmed, the
metrics writer is the only remaining 0.10.x finding from this job.

## 2026-08-06 — CHAIN-AUTHORING candidate: the arena contract + prompt-audit checklist (jeff pass, temper handoff)

The temper session's "leave space for the agent" doctrine wants its
structural home in docs/CHAIN-AUTHORING.md — the convention surface chain
authors actually read. Transportable core: a chain prompt defines an arena
(inputs = rendered stateful artifacts, boundaries = fences, acceptance =
gates, exits = sanctioned ways to not-know) and leaves the middle vacant;
plus the four-step sentence-audit checklist (interface/duplicate/residue/
gate-ownable/sermon; every freedom names its exit; every prompt edit names
its observable; scaffolding prose files the structure it waits on). Field
evidence: temper build.md 107→63 lines same-day with three instructions
converted to structure (2026-08-05); asp-egress job as the counter-case
(healthiest behavior traced to artifact design — ground pins, friction
exits; stall traced to forks with no structural home). Full digest:
C:\Users\JohnC\Repos\jeff\spool\2026-08-06-leave-space-digest.md. Severity:
docs-only, no engine code implicated — same class as v0.11's
"convention gets documentation, not machinery."

## 2026-08-06 — 0.11.0 tarball ships stale "0.11.0 was never published" text (jeff pass, carto migration)

docs/MIGRATING-0.10.md §0 inside the PUBLISHED 0.11.0 package still
asserts "0.11.0 was never published … If you were waiting for a 0.11.0
tag: it isn't coming. Pin 0.10.0." It sits beside MIGRATING-0.11.md in
the same tarball, and it is the first thing a 0.9.x consumer reads —
it tells them to stop one version short. Docs-only, one paragraph.

## 2026-08-06 — renderSchemaForPrompt states a fence the engine doesn't enforce on unscoped chains (jeff pass, carto migration)

renderSchemaForPrompt describes entry `files` as the scoped-fanout fence
unconditionally ("the build tick may write ONLY these paths ∪ channel
paths"). For a chain leaving scopeWritesToEntry undeclared that is false
— and it argues plan into defensively over-declaring `files`, the exact
cost MIGRATING-0.10 §6 measured (wave width 3.17 → 1.99 at
maxParallel 4). Ask: condition that sentence on the phase's declared
scoping. Cartograph corrects it locally via promptArgs behind an assert
that fails render loudly if the engine rewords the clause — that local
correction retires when the engine conditions the sentence (flip
trigger recorded in cartograph PR #6).

## 2026-08-06 — MIGRATING-0.10 routing table misses §5 for a 0.9.0 start (jeff pass, platform migration)

The recipe's routing table for a 0.9.0-based chain names §§2, 6, 7, 8,
9 — but not §5 (Chain.harvest removal). A 0.9.0 chain declaring
`harvest` fails tsc against 0.11's Chain interface, so the gap is
caught loudly, but the table claims completeness it doesn't have.
One-row docs fix.

## 2026-08-06 — no render verb since 0.10; two seats built the same harness by hand (jeff pass, both migrations)

`flume render` was removed in 0.10 with no replacement, and prompt
verification is a real need every migration hits: both the platform and
cartograph migration seats independently had to drive the engine's own
`loadChainModule` + `renderPrompt` from a scratch host to compare
before/after renders (byte-identity checks, <exec-failed> counts,
unresolved-slot counts). Those two hand-built harnesses are a working
spec for what a read-only `flume render`-class verb needs to do. The
0.11 read-verb family (check/log/friction) is the natural home.

## 2026-08-06 — addendum: renderSchemaForPrompt + metrics loss corroborated cross-bay (jeff pass)

Two entries above gain independent second sightings from the platform
migration (PR #700): (1) the unconditional renderSchemaForPrompt fence
sentence was hit there too — that bay also leaves scopeWritesToEntry
undeclared, so its plan ticks read two contradictory statements about
`files` every tick; its prompt now states which wins (prose), where
cartograph corrects via promptArgs+assert. Same defect, two consumers,
two divergent local mitigations — engine conditioning retires both.
(2) The metrics.jsonl loss now has a cost: tickTimeoutMs adoption was
DECLINED on the platform bay because no duration corpus exists to size
the cap from (its metrics.jsonl predates the current chain, zero
duration_ms rows). The metrics-writer fix is the prerequisite for
sizing runaway brakes on every bay.

## 2026-08-06 — addendum 2: metrics loss ROOT-CAUSED — prefix-matching the result event; the documented decorator pattern ships the bug (jeff pass, platform PR #700)

The metrics.jsonl loss reported above is measured now, and it is not
0.10-specific: the platform chain's withTickMetrics found the result
event by testing whether a line literally starts with {"type":"result".
JSON key order is not a contract and the current CLI leads with
is_error, so the lookup resolves to -1 and the catch swallows it
silently — 48 of 48 real session captures parse as type:"result", zero
match the prefix, confirmed live today with a throwaway claude -p call.
Any bay whose rows stopped when the CLI's key order changed fits the
same mechanism. TRANSFERABLE: flume ships withSessionCapture and
documents this decorator pattern, so every chain copying it inherits
the dead lookup — CHAIN-AUTHORING wants one line: find the result event
by parsing type, never by prefix. Fixed on the platform bay in PR #700
(third commit), which then sized tickTimeoutMs=90min from the recovered
corpus (1.5min fastest / 9.8 median / 20.7 p90 / 29.1 longest across 48
invocations) — the session-capture replay method transfers to any bay
that wants to size its own cap.

## 2026-08-06 — operator ruling: tick sizing is the discipline; tickTimeoutMs is only the stopguard (jeff pass, chef's ruling)

Ruled at the pass: tickTimeoutMs is a stopguard, never a control we rely
on. Tick duration is an INDICATOR — a long tick means the task/slice
complexity handed to that tick was too high. Ticks should be frequent,
iterative rounds of work: not too long, not too short. Target per tick:
~<200k tokens, i.e. ~20% of the context cap. System-design and cost
driven. Implications worth routing: (1) plan owns slice sizing — entry
scoping should aim entries at the tick budget, and "was this entry
well-scoped" is exactly the record-visible quality the prior-attempts/
metrics layer exists to expose; (2) with the metrics writer fixed
(PR #700), token/duration rows per tick are recordable again — a
tick-budget signal (report, or budget-as-gate per the temper 30-line
precedent: breach → cut the slice, never raise the cap) becomes
buildable; (3) CHAIN-AUTHORING wants the doctrine line beside the arena
material already filed. Evidence in hand: platform's recovered 48-tick
corpus runs 1.5min–29.1min (median 9.8) — the long tail is the smell
this ruling names, not a sizing precedent for bigger caps.

## 2026-08-06 — files.retire[] accepts non-paths; failure surfaces at the fence, far from the cause (jeff pass, dal-resume-prep)

retire[] is typed string[] and feeds touchedPaths(), so authoring a
symbol name ("usp_User_Login (Function in dbw_Unsorted_5.html)")
instead of a path is accepted at write time and fails later at
pendingGate's fence pre-check as "declares files outside the fence" —
pointing at the fence, not the malformed value. Two DAL entries
carried prose in retire[] for weeks; under 0.11's stricter checks they
became latent wake-blockers. Ask: a schema refinement rejecting values
that cannot be repo-relative paths, so it fails where it's written.

## 2026-08-06 — MIGRATING guides miss the merge-inherited-pin case on long-lived job branches (jeff pass, dal-resume-prep)

A job branch that MERGES main (rather than bumping its own pin) gets
the pin bump as a merge side effect with no prompt to open the
migration guide — job/dal-migration inherited 0.11 this way and carried
two latent wake-blockers (schemaDelta fields, prose retire[]) that
flume check catches only after the pin moves, when "your next plan or
build tick fails at the parse gate." One MIGRATING note aimed at
long-lived job branches taking the harness by merge would surface it.

## 2026-08-06 — CHAIN-AUTHORING line: gate config resolves inside run, never at module scope (jeff pass, dal-resume-prep)

General shape found via the platform dal-equiv gate: the gate's
dependency validates env at import, so a missing .env fails the gate
with an error naming SQL, not the gate's subject — and the bay already
paid for it once (pilot tick 1: every gate run crashed "SQL_SERVER
missing" and reverted a green wave). A gate's config should resolve
inside run(), where failure reports as a gate verdict instead of an
import crash. Rides beside the arena/CHAIN-AUTHORING candidate.

## 2026-08-06 — operator ruling: fork resolution is basic harness behavior — exits are earned by a failed currency search (jeff pass, chef's ruling)

Extends the arena/CHAIN-AUTHORING candidate's exits section. Ruled: a
fork the loop surfaces should first be traced to its currency — an
invariant, a standard, or a similar example in code/git history. The
agent in the arena reasons, locates that authority, decides whether
the answer PROMOTES into the harness (becomes/extends a standard) or
is already correctly placed, and proceeds. Only the genuinely
impassable parks: defects, in-wrapper business logic too entangled to
rule on from the record. These resolution steps are not the job's to
instruct — they are basic harness behavior, and belong in the harness
layer (prompt/rule/skill), stated once, not restated per brief.
Implication for the exits design: an open-question entry should carry
evidence of the failed currency search that earned it — a park with
no search behind it is gap-filling wearing an exit's clothes.

## 2026-08-06 — operator ruling: channel registers are lean, active-only; git is the log (jeff pass, chef's ruling)

Extends the arena/CHAIN-AUTHORING candidate and gives the parked
state-budget ask its operator demand. Ruled: plan/open-questions.md
and plan/state.md are registers of ACTIVE items only — per entry: the
question, what it blocks, the failed-currency-search cite. Resolved
and historical content leaves the register when it resolves; git is
the log, the resolving commit is the record; a register never restates
what the tick already receives rendered (git history, queue, brief).
The cost is measured, not aesthetic: the dal-migration bay's
open-questions.md reached 621 lines and renders into every plan tick —
a per-tick context tax of exactly the accretion class the leave-space
doctrine names. asp-egress shows the same disease cross-bay (register
carries "historical record" sections + resolved forks kept in place).
Structure candidates: the register cap joins the state-ledger cap as a
gate (budget-as-gate — breach = prune, never raise), and MIGRATING/
CHAIN-AUTHORING carries the active-only contract so new bays inherit
it. With this ruling the platform bay's parked "~8 lines is advisory,
a gate needs a number nobody set" objection dissolves: the operator
has now set the direction — lean — and the number can be derived per
bay from its rendered-prompt budget.

## 2026-08-07 — zombie pickability: bailed/rescoped entries stay dispatchable and burn a session every wave (jeff pass, DAL efficiency review)

Measured on the dal-migration bay (wakes 1-2): an entry that SHIPPED
kept being re-dispatched (3 further sessions, each correctly verifying
its own commit is an ancestor and bailing) and an entry that
voluntarily bailed was re-dispatched until it had bailed FOUR times,
each bail re-verifying the prior one deeper. Agents behave per
contract; the queue keeps feeding them — cost grows linearly with wave
count. Ask: a needs-rescope or voluntary-bail outcome should suspend
the entry's pickability until plan routes it; ship-detection's
already-shipped case should close rather than re-dispatch. Evidence:
jeff spool 2026-08-07-dal-efficiency-review.md (D1).

## 2026-08-07 — friction doesn't travel to retry ticks; tip-moved dropped a complete build again at width 3 (jeff pass, DAL efficiency review)

Two coupled findings from the same $13 wrapper: (1) a complete, valid
scaffold build was classified tip-moved at fanout width 3 and fully
redone — SECOND live occurrence of the drop class (asp-egress was the
first; the 0.11 per-entry ancestry fix did not cover this shape); and
(2) the redo could not see the first attempt's friction — friction is
uncommitted loop-checkout state, invisible from a fresh fanout
worktree, while revert-on-failure resets git but leaves non-git debris
the retry then trips over. Prior-attempt records DO render into
retries (proven by the bail chain on the same bay); friction does not.
Ask: friction authored by a dropped/reverted attempt should reach the
retry the same way prior-attempts do — and the width-3 drop wants a
reproduction. Evidence: jeff spool 2026-08-07-dal-efficiency-review.md
(D2, D3).

## 2026-08-07 — correction to the zombie-pickability entry above: not an engine ask — the machinery shipped in 0.11 unused (jeff pass, simplify review)

Retracting the ask as filed. The altitude review verified against the
installed 0.11 engine: Phase.shouldRun (pre-render/pre-invocation
declined no-op), pending gate kinds requiresCapability and deferred,
and Chain.capabilities (load-time environment assertions) all exist —
the dal chain simply declares none of them, and its prompt enumerates
only parked/blockedBy. The zombie class is an unused-capability
problem; fix is chain-side. What REMAINS as engine asks from this
review, both narrow: (1) preserve reverted BUILD commits the way
plan.reverted/ already preserves plan's (prior-attempts for build
carry only a diffStat — the machinery exists for one phase); (2) a
mid-invocation token brake, same shape as tickTimeoutMs, for the
input-side budget (dispatch-side refusal is chain work via shouldRun).
The friction-transport ask above also narrows: a chain-side
{{OPEN_FRICTION}} prompt slot (briefDelta() pattern) solves it
locally; the engine generalization is optional.

## 2026-08-07 — operator doctrine: the configuration's product is multi-phase derivation; ticks execute the frontier (jeff pass, chef's theory, landed)

The CHAIN-AUTHORING chapter the earlier entries were circling.
Supersedes any phase-topology reading: plan→build stays the engine's
fixed idiom — the pipeline is DATA, not chain phases.

THE DIAGNOSIS. "Stateless ticks, disk is truth" has been implemented
literally as memoryless ticks: every tick re-derives the whole world
from disk, and the prompts compensate for missing structure with
unbounded re-verify instructions. Stateless was insurance against
trusting corrupted state — but the record of the last tick is
DETERMINISTIC every loop (committed, reproducible), so ticks should be
additive and incremental, building on the last. Derivation is not the
tick's job. The product of the flume configuration is multi-phase
derivation — factored, not repeated.

THE CONTRACTS. Each state artifact has a distinct origin of
derivation: one source, one deriver, one invalidation condition.
- git: the ground record — derived from nothing, append-only,
  deterministic.
- state doc: the fold checkpoint — derived from git-since-cursor;
  invalidated only by commits past the cursor; derived values in it
  (counts) are computed, never hand-typed (a hand-typed count was
  found wrong on disk while claiming verification).
- queue entries: derived from brief × committed territory facts;
  invalidated by brief deltas, fork resolutions, ship events — NEVER
  by time passing. Re-verifying an entry each tick is a category
  error, not diligence.
- open questions: derived from failed currency searches; invalidated
  by an answer arriving; resolved content leaves the register (the
  resolving commit is the record).
- proofs/ledgers: derived from the corpus by deterministic tools,
  hash-pinned; invalidated by hash mismatch; committed, so downstream
  ticks SPEND them instead of re-proving.
- prior-attempts/friction: episodic memory; worthless without a
  consuming edge (render into the retry's prompt).

THE TICK CONTRACT. A tick's input is checkpoint + deltas since
checkpoint — every delta deterministic (git log cursor..HEAD, an
inbox diff, a probe result). briefDelta() is this discipline applied
to one input; generalize it to all of them. A tick recomputes only
downstream of what changed, appends its increment, advances the
cursor. The loop is a fold, not a map over the world.

PHASES AS ENTRIES (the operator's nit, load-bearing). The derivation
graph lives in the queue and the artifacts, not in chain topology: a
derivation stage is an entry whose product is a committed, hash-pinned
artifact; a consumption stage is an entry that cites it via the
existing edges (dependsOn/blockedBy); shouldRun makes completed
stages free no-ops. Organic proof already on the dal branch: the
DAL-FIX entry regenerated and verified a work-source artifact that the
422-routing then consumed — phases-as-entries, done once naturally.

THE ECHO-GUARD (anti-accumulation). A derivation earns an entry ONLY
when a named downstream entry cites its product — never because a
prior toolkit version had that stage. Candidate stages resurrected
from retired sequences are the accumulation trap wearing new clothes.
Test per candidate: committed? hash-pinned? consumed by a named
consumer? All three or it waits.

EVIDENCE THIS IS THE MISSING DIMENSION: the DAL efficiency review's
five findings are each a missing edge — plan tax = world-input where
delta-input belongs; zombie dispatch = no invalidation edge from
ship-event to entry; retry amnesia = episodic memory with no consuming
edge; register bloat = no removal edge on resolution; hand-count drift
= a derived value maintained agentically. One absent concept, five
masks. Reviews: jeff spool 2026-08-07-dal-efficiency-review.md +
2026-08-07-dal-simplify-synthesis.md.
- 2026-08-07 (pass): earned-exit bar extended to capability bails, with a measured precedent. A DAL-job build entry voluntary-bailed three times (~$3, plus ~$4.40 of downstream plan re-derivation) claiming "no .env reachable" — the claim was false; the config resolver, one command, found the file, and the live DB answered. The bail's friction note was well-argued and evidence-free: filesystem listings and reasoning, no probe execution. Engine-shaped ask, narrow: the bail/no-commit record schema could carry an optional `probe` field (command + output) for capability-class bails, and prompts/docs should state the norm that a capability bail names its executed probe — the same evidence bar prior-attempt records already set for retries. Chain-side enforcement (a gate refusing evidence-free capability bails) is each repo's call; the record shape is the engine's.
- 2026-08-07 (pass): merge stage defeated by untracked files in the loop-home checkout — recovery worked, prevention wanted. A build entry's cherry-pick back to trunk failed with "untracked working tree files would be overwritten by merge" (five generated JSONs left uncommitted in the primary checkout by earlier plan-tick tooling runs; byte-identical to the build's committed versions). Engine behavior on failure was GOOD: footprint commit recorded the failure into the job record, entry quarantined for the rest of the run, work preserved reachable (operator recovered it with one cherry-pick after clearing the debris). Asks, narrow: (1) pre-merge, detect untracked collisions against the incoming range and — since the engine can compare hashes — auto-remove/stash exact-duplicate untracked files rather than aborting the wave (identical content is provably lossless); (2) surface non-identical collisions as their own no-commit mode with the file list, so the retry prompt carries it. Related config-side norm filed to the job: plan ticks never leave generated artifacts uncommitted.
- 2026-08-14 (pass): state.md goes stale between a ship and the next plan tick. Observed in connect job dev-9261-phone-pvo: the ship commit drained pending.json to [] but state.md still read "Queue: 3 entries - 3 open" until the next plan tick rewrote it. Plan's orientation digest re-injects both files, so the tick after any ship opens with a ledger contradicting the queue it describes. Harmless when the tick Reads the material before ruling (the prompt mandates this), but a plan tick that trusted the digest would re-gate entries that no longer exist. Engine-shaped ask, narrow: either the ship stage appends a mechanical one-line marker to state.md (e.g. "[stale - queue rewritten by ship <sha>]"), or the plan prompt's <state> span carries a freshness warning when pending.json's mtime/commit postdates state.md's. Chain-side workaround exists (prompt already says never rule on a digest line), so this is hardening, not a defect.

## 2026-08-19 — 0.12 field report: worktree plan tick inherits the primary's FLUME_DIR resolution, mandated `flume check` refuses (dal-migration seat)

First 0.12 plan tick on the dal-migration job (singleton-in-worktree, new
this release): the tick's environment carries `FLUME_DIR`,
`FLUME_CONFIG_DIR`, and `FLUME_DIR_RESOLVED_FOR` pointing at the PRIMARY
checkout, so the prompt-mandated `pnpm --dir .flume exec flume check` run
from the worktree refuses — "resolved for repo <primary>, not this
invocation's resolved repo root <worktree>". The escape hatch fails too:
`--job` with `FLUME_DIR` unset still trips the guard because
`FLUME_DIR_RESOLVED_FOR` survives and pins the old root. What works is
scrubbing all three (`env -u FLUME_DIR -u FLUME_DIR_RESOLVED_FOR -u
FLUME_CONFIG_DIR ... flume check --job <job>`), which the tick had to
discover at the price of a failed command; note a check resolved against
the primary would be validating the WRONG tree anyway — the tick's edits
live in the worktree. Downstream has patched its prompt to the scrubbed
form as interim. Engine ask: a worktree tick's child env should either not
export the primary's resolution triple, or re-point it at the worktree's
own .flume — the 0.12 changelog's hermeticEnv strip-by-prefix suggests the
former was already the intent somewhere. Full note:
centercode-platform @ .flume/jobs/dal-migration/friction/
plan--2026-08-19T21-36-27-274Z--2026-08-19-plan-flume-check-refuses-in-0.12-worktree.md

## 2026-08-19 — 0.12 field report #2: voluntary-bail prior-attempts record dies with the tick worktree, zombie brake never arms (dal-migration seat)

Under 0.11 a voluntary bail left `prior-attempts/<slug>.json` in the primary
checkout's flumeDir; the downstream chain's `shouldRun` zombie brake pairs
that record (mode=voluntary-bail) with an unrouted `## rescope:` register
heading to refuse redispatch until plan routes the note. Under 0.12 the
record is evidently written to the TICK WORKTREE's flumeDir and torn down
with it: the primary's `prior-attempts/` has gained nothing since the 0.12
relaunch, while `DAL-STANDARDS-lane-a-sweep-batch-7` voluntarily bailed
twice in consecutive waves (commits 1710000923, aaf5731644 — identical
rescope conclusion re-derived at full agent price, a duplicate register
heading each time; the second bail is precisely what the brake exists to
prevent, and its own comment cites the 4-bail incident that motivated it).
Same family as field report #1 above: per-tick engine state that used to
land in the primary's flumeDir now lands in the disposable worktree.
Suggested shape: bail/prior-attempt records (and anything else dispatch
predicates read next tick) belong to the durable state root, not the span —
either write them supervisor-side at merge/park time, or harvest them like
friction. Downstream stopgap: operator hand-wrote the record to re-arm the
brake. Chain-side we could also drop the record conjunct and brake on the
unrouted heading alone, but the pairing is deliberate (heading-alone is
plan's input-order concern) — flagging rather than unilaterally weakening it.

## 2026-08-20 — 0.12 field report #3: no rate-limit backoff — a rejected agent burns --max in seconds and kills the run (dal-migration seat)

Second reproduction of the retry storm (first: 2026-08-17, 61 wasted
launches at ~52 s intervals under 0.11). Under 0.12 it is worse in kind:
an unattended `flume loop --max 50` hit a rate-limited platform, and every
plan tick died in ~0.5 s with exit 1 / 0 tokens / $0.000
("non-work failure ... rate-limit surfaced as a non-zero exit" — the
engine already CLASSIFIES it correctly as platform-preempt). 49 consecutive
preempt ticks consumed the entire --max budget in under a minute and the
supervisor exited — the loop's operator was AFK precisely because the loop
was supposed to run itself. Ask: on a platform-preempt-classified tick,
back off (exponential, or parse the rejection's resetsAt when the CLI
surfaces it) instead of hot-respawning, and don't count preempt ticks
against --max — the budget is meant to bound WORK, and the engine already
knows these ticks did none. Evidence: dal-migration loop run 2026-08-19/20,
49 errored ticks in the exit summary.

- 2026-09-03 (platform bay, flume 0.12.0, census job build tick at 6dd65f5570): after a tick that committed a friction note properly under `friction/<date>-<slug>.md`, a byte-identical duplicate was left UNTRACKED in the working tree under an engine-internal filename `<entry-tag>--<ISO timestamp>--<slug>.md`. Looks like fanout/tick residue not cleaned after the commit. Operator deleted it; nothing lost. Reproduce: build tick that files friction.

- 2026-09-03 (platform bay, flume 0.12.0, job fork-rulings plan tick bc377269): `setupDirs: [".temper"]` provisioning appears not to reach the PLAN phase's singleton worktree — `.temper/node_modules` absent there, so a script gate run from plan exits 1 while the same gate passes in build's fanout worktree and on the primary checkout. Question: is setupDirs meant to provision the singleton worktree too? Plan running a build-declared gate is optional; reporting the asymmetry.
- flume: a job's brief cursor is a raw commit SHA; a between-run rebase of the job branch orphans it and the next plan tick re-presents the whole brief as a fresh delta (idempotent, but recurs on every rebase). A content-hash cursor would survive. — ref: developertools bay, job operability, plan commits 0910269→270d302, 2026-09-03
- flume: `job new` should assert the seed branch contains the brief's pinned Sources SHA; a job mounted on a stale base derives zero rows and parks (correct, but a wasted tick). — ref: developertools bay, job operability, plan commit dc98846, 2026-09-03
- flume: the plan prompt's continuation marker has no input for a standing multi-tick work order (e.g. a census walk); once brief deltas and inbox steers are routed, plan stamps 'continues: no' and hibernates with the register incomplete. Workaround: an inbox steer per run. Fix: a standing-work-order input or a declared plan-owned backlog file the prompt reads. — ref: developertools bay, job operability, plan commit dab803a, 2026-09-03
- flume: an entry whose build commit touches only channel-glob paths (e.g. .temper/feedback/**) lands on trunk but the engine's shipped check returns false, leaving it pending until a later plan tick closes it by hand. Channel-only commits that are the entry's whole acceptance should count as shipped. — ref: platform bay, job sql-feedback-promotion, entry promote.mark-note-headers, commit 2b029d8946, 2026-09-03
