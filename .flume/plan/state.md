# State

Phase: **v0.7 line in flight** — 1 entry in `pending.json`, `gate.kind:
"open"`. Mode this tick: **drain** (commit-delta since the last `plan:`
commit is one `chore(flume)` inbox-only commit; no spec-delta; the
meaningful dimension is inbox-drain, plus a fix surfaced while draining
it).

## This tick

**Commit-delta** (1 commit, `16155cb`): a `chore(flume)` commit that only
appended the inbox entry itself (`.flume/inbox.md`) — no `src/`, chain,
or prompt changes to cross-check against a `per.section`. Audit
dimension is a no-op this tick; nothing to route beyond the inbox drain
below.

**Spec-delta**: none (only a chore commit landed; no `spec/` changes).

**Drain** (`.flume/inbox.md`, 1 entry — "voluntary-bail waves carry no
plan-wake signal"): researched before parking, per `collaboration.md`.
Traced past the inbox's own framing ("chain handoff should treat
voluntary-bail as wake-plan") to the actual mechanism:

- `Dispatcher.tick` (`src/Dispatcher.ts:710-717`) destructures `{
  result, noCommit }` from the wave runner but only ever passes `result`
  into `phase.handoff(result)` — `noCommit` (the §6 classification:
  `voluntary-bail` / `platform-preempt` / `gate-revert`) is discarded
  before handoff ever sees it.
- `TickResult` (`src/Phase.ts:52-75`) has no field carrying that
  classification. On a pure-bail wave, `committed: false`, `shippedTags:
  []`, `gateResults: []` — indistinguishable from a genuine "nothing
  pickable" no-op wave.
- Conclusion: no chain author's `handoff`, however written, can act on
  bail today. This is an engine visibility gap, not a `.flume/chain.ts`
  authoring mistake — routed as **NEEDS AMENDMENT**
  (`HANDOFF-NOCOMMIT-BLIND`) in `open-questions.md` rather than filed as
  a pending entry, because the fix touches `Phase.ts`/`Dispatcher.ts`
  outside any shipped section's blast radius, and because step 3 of the
  fix (updating build's `handoff`) edits `.flume/chain.ts`, which v0.7
  §1 explicitly bars this line from touching ("No chain or prompt
  content ships from this line"). Candidate home: a v0.8 continuation of
  v0.7's "engine truth-telling" theme, or its own short section.
- While tracing the bail, checked whether the underlying entry
  (`SETUP-WORKTREE-HELPER`) that bailed twice had actually been fixed by
  a prior tick — it had not: `pending.json` still declared
  `.flume/chain.ts` under `files.edit`, which is structurally off-fence
  for build (verified against `writablePaths` in `.flume/chain.ts:189-250`
  — no `.flume/**` glob present beyond the one channel path). Per spec
  §11's own text, flume's dogfood chain.ts adoption is a named
  deliverable of that section, but the engine's phase fence makes it
  undeliverable *by build* regardless of how the entry declares its
  files — the same shape already closed once in this doc
  (`PROMPTS-BUILD-FENCE-INSTRUCTION`: applied directly via an operator
  chore commit, not routed through a phase). Acted on the clear answer
  directly (collaboration.md — skip the park when research converges):
  re-filed `SETUP-WORKTREE-HELPER` dropping `.flume/chain.ts` from
  `files.edit`; the dogfood-adoption bullet now ships via a follow-up
  `chore(flume)` commit once the helper entry lands, not folded into
  build's own commit. This should stop the bail loop the inbox entry
  described, independent of whether `HANDOFF-NOCOMMIT-BLIND` ever ships.

**Promote**: no entry in `pending-now` carries `gate.kind: "blockedBy"`
— nothing to flip.

## Queue (1)

1. `SETUP-WORKTREE-HELPER` — open, re-filed this tick (files no longer
   include `.flume/chain.ts`); should be pickable by build without
   bailing now.

Next tick's real work is a **build** tick picking off the queue head.

## Open questions (6)

- `HANDOFF-NOCOMMIT-BLIND` — NEEDS AMENDMENT (new this tick, see Drain
  above).
- `ENGINE-PIN-HANDSHAKE-JOB-DIR-MISMATCH` — PARKED, unchanged.
- `TAG-PATTERN-SLICE-CONSTRAINT` — NEEDS AMENDMENT, unchanged.
- `PENDING-NOTES-CAP-VISIBILITY` — NEEDS AMENDMENT, unchanged.
- `SUPERVISOR-PROVISION-FAILURE-QUARANTINE` — PARKED, unchanged.
- `SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP` — NEEDS AMENDMENT (2
  of 3 asks), unchanged.

## Writable-paths / trunk

- `pending.json`: rewritten this tick — `SETUP-WORKTREE-HELPER`'s
  `files.edit` dropped `.flume/chain.ts` (off-fence for build); all
  other fields unchanged. Verified parses (`node -e "JSON.parse(...)"`),
  `summary` 147/200 chars, `notes` 305/500 chars.
- `state.md`: rewritten this tick (this file).
- `open-questions.md`: appended `HANDOFF-NOCOMMIT-BLIND`; all five prior
  questions left byte-identical.
- `inbox.md`: the one drained entry removed; header preserved; file is
  now header-only again.
- Trunk: HEAD `16155cb` at this pass's start; tree clean besides
  untracked `.flume/loop.pid` (live supervisor's runtime artifact, not a
  plan concern).

Plan continues: no
