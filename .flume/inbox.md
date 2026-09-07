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

## 2026-09-06 — loss audit v0.3→v0.13: residue outside the spec edits (interactive session via human)

Filed alongside the spec edits that added `engine-boundary.md` *Surface, not
prescription*, `spec/chain.md` *What a hook receives*, `FlumeApi.paths`,
`ClaudeCodeOptions.model`, `AgentResult.finalMessage`, and `Chain.pendingPath`.
Those carry their own drift notes; plan derives them from the spec diff. What
follows is what the audit found that needs no spec change, or needs a human
ruling first.

1. **Stale ship-classification comments describe a removed inference.**
   `src/Dispatcher.ts` `AgentTermination` doc (~611-628) says a `clean`
   termination's final message keeps an entry out of `shipped` when it "states
   a park"; `runFanoutEntry`'s `termination` field doc (~2772-2781) says the
   ship site reads it. The park regex was removed (62bb03e); the call site
   consults only `phase.shipped`. Under *Told, not inferred* a comment that
   reads as mechanism is the named failure mode. Rewrite both to say
   `termination` feeds the usage row only.

2. **`FLUME_WORKTREES_DIR` is read inside the dispatcher** (`src/Dispatcher.ts`
   ~3473, ~3606) while the `namespace` doc (~1097) says the dispatcher never
   sniffs env. Embedders and tests cannot set it without mutating
   `process.env`. Ask: `DispatcherOptions.worktreesDir`, resolved in `cli.ts`
   beside `flumeDir`, same idiom as `namespace`. Engine hygiene, no chain
   surface.

3. **`docs/CLI.md` documents six of ten verbs.** `stop`, `log`, `check`,
   `friction` have no section; `spec/cli.md:87` still promises one entry per
   subcommand. Either add the four or amend the spec line to point at
   `flume --help` as the authority (as `PROTOCOL.md` already does). Human
   picks; the second is smaller.

4. **`docs/INTENT.md` contradicts the code in two places and carries executed
   decisions.** (a) The Provenance spine bullet says the harness verifies typed
   inter-layer citations; `per` left the engine core in 0.8.0 and is opaque.
   (b) "v0 success criterion" (line ~46) was never re-proven and cannot be:
   the comparison target (`bin/flume-bash`, gen2 specs) no longer exists in
   any live tree. (c) "Decided, not yet executed — spec corpus reform" has
   executed. Ask: (a) restate to match 0.8+, (b) retire or restate against a
   measurable target such as the dogfood ship ledger, (c) delete. Human edits;
   filing so it is not lost. Cascade's session raised (b) independently.

5. **`examples/prompts/spec.md` models a retired consumer shape** (workshop/ →
   specs/active → specs/_aligned). Cascade dropped that partition in June; no
   current consumer has a spec phase. A new adopter would build the shape
   flume's own consumer abandoned. Ask: cut it, keep plan/build examples only.
   Cascade's session raised this.

6. **Voluntary-bail is inferred intent — needs a ruling, not an entry.** A
   clean exit with no commit is recorded as "the agent refused a constraint"
   (`src/Dispatcher.ts` `classifyNoCommit` ~3956-3969) and that label is
   persisted into the prior-attempt record the next tick renders. An agent
   that ran out of turns, or found nothing to do, gets a block saying it
   refused to cross a constraint. Predates v0.3. Fix shape is a chain-declared
   bail signal with the engine recording only `clean-exit`, which is a
   taxonomy change. Parked here for the human; do not derive.

7. **Multi-minor jumps have no single lookup.** Fourteen releases in four months,
   four migration guides, one superseding two. A consumer pinned at 0.2 (cascade)
   faced a routing table. Ask: one cumulative index in `docs/` mapping each
   consumer-visible symbol to the release that changed it, so a jump is one
   lookup. Docs lane; build can derive. Cascade's session raised this.

8. **`docs/MIGRATING-0.12.md` §1 restores v0's gate placement without saying so.**
   "Put correctness gates at afterMerge" is where v0 put them before
   `afterCommit` became the documented placement. A v0-shaped chain that never
   moved is already compliant and cannot tell. Ask: one line in the guide or the
   0.12 changelog entry naming it a restoration. Cascade's session raised this.

## 2026-09-03 — three field observations from temper's 0.12 release round (temper-2d via human)

Filed after the 0.13.0 cut commit; next-line scope. Source: temper's dogfood chain,
~25 build ticks, 14 entries shipped on @dtmd/flume 0.12.0.

1. **A per-entry voluntary bail is invisible on a wave that also shipped.**
   `TickResult.noCommit` is the wave's one representative cause and is absent when any
   entry shipped, so a chain whose build handoff chains build-to-build on open entries
   never routes to plan for the bail — the bailed entry is re-picked with its capture
   undrained (one entry bailed three times on the same known gap, ~$0.5 each). Same
   class as `quarantinedTags`: a fact the engine holds per entry (each record's mode)
   and hands out only as a wave fold. Ask at the fact level: per-entry no-commit modes
   on `TickResult` (`bailedTags`, or an entries[] with mode) — the wake stays the
   chain's (`engineering.md`, *A fact the engine holds is reported*). Whether
   prior-attempts should block a re-pick is chain policy (`shouldRun`); flume's own
   chain does it on plan's side.

2. **Quarantine survives a re-scope.** The run-scoped quarantine is keyed by slug, so
   an operator's re-scope commit on trunk does not lift it; the fix is stop and
   relaunch. Ask: key the quarantine on the entry as read (slug + a hash of the entry
   content, or the sha the entry was read at) so a changed entry is a new key, and
   report the key on `quarantinedTags`' companion so a chain can see why it stands.
   Engine-computed from `pending.json`, nothing inferred.

3. **A supervisor killed mid-merge leaves a cherry-picked commit on trunk with no
   afterMerge gates and no ship bookkeeping.** Happened once (background task killed
   during a wave's merge stage). Recovery was manual — run every afterMerge gate from
   chain.ts by hand, then the ledger rewrite — and a gate was missed on the first
   pass. This is a hole in `spec/loop.md` *Crash equals stop*: the guarantee covers
   the worktree side but a commit already on trunk past the last verdict's `headSha`
   is neither gated nor recorded. Ask: a startup check under the tip claim that
   notices trunk commits past the last verdict with no ship row and refuses (or a
   `flume resume-merge` that finishes the gates + bookkeeping from the verdict's span
   shas — the same recovery idiom the verdict's `headSha` exists for). Needs a spec
   edit before derivation; the operator will open it. Filed as **gh#19** with the
   repro: kill landed after the first `cherry-picked <TAG> → <sha>` line and before
   `ship commit`; no verdict row at all for the tick (last row's `headSha` predates
   the trunk commit); `pending.json` still listed the entry open, so the next run
   would have re-picked and double-cherry-picked; four worktrees left behind, no
   lock or pid. Boundary note for the spec edit: the issue's "not operator commits"
   framing is an inference the engine must not make (`engine-boundary.md`, *Told,
   not inferred*) — the durable evidence is the surviving `flume/<slug>` branch
   whose tip the trunk commit was picked from (teardown never ran), plus the
   worktree dirs the startup sweep already enumerates. Detect from those, never
   from commit shape or author.

## 2026-09-06 — two field defects from temper's loop under 0.13.0 (temper-main via flume-main)

1. **The startup sweep and the ticks disagree on the worktree base whenever the
   chain declares it.** `flume loop` calls `sweepStaleWorktrees()` (`src/cli.ts:836`)
   before `resolveChain()` (~851). A chain that sets `FLUME_WORKTREES_DIR` at module
   load (temper chain.ts:43, off-repo per spec/worktrees.md *Placement*) is unread in
   the supervisor, so the sweep bases on `<flumeDir>/worktrees` (present, empty),
   removes nothing, then `git branch -D` fails for every `flume/*` branch:
   `error: cannot delete branch 'flume/<slug>' used by worktree at '<real base>/<slug>'`,
   logged and continued (`src/Dispatcher.ts:3566-3569`). Four instances at temper
   b8ad8bd0 after a WSL shutdown; tick children load the chain and reused the
   worktrees. Supersedes item 2 of the loss-audit entry above: a
   `DispatcherOptions.worktreesDir` resolved from env in cli.ts still misses a
   chain-set value. Fix shape: `Chain.worktreesDir`, read by the supervisor after
   chain load and before the sweep, same value `createWorktree` uses. Whether the
   env override survives beside it is a Placement ruling; do not derive until
   spec/worktrees.md and spec/chain.md carry the field.

2. **afterMerge revert rewinds over a foreign trunk commit.** spec/loop.md *Tip
   verify*, "One window stays a refusal, deliberately", rules that a foreign commit
   landing between an entry's cherry-pick and its afterMerge revert is refused loudly
   with both shas. The site (`src/Dispatcher.ts` ~2460, "reverting only that entry")
   calls `git.resetKeepTo(repoRoot, preCherry)` with no tip check; `reset --keep`
   moves the ref whatever sits on top. Guard lost in 6cb9948, which replaced the
   ownership-checked drop; `dropLastCommit` still guards the afterCommit leg only.
   Field instance: temper at flume 0.13.0, entry a385660a cherry-picked, operator
   commit 3da55a88 on top, `cargo test` failed afterMerge, trunk rewound to
   pre-cherry-pick; recovered by merge of origin plus revert 56bc6727. Fix: revParse
   the trunk before the reset, refuse when it is not `mergedSha`, route to the
   existing revert-refused set. Test: cherry-pick, foreign commit on top, failing
   afterMerge gate, assert tip unchanged and both shas in the refusal. Derivable now.
