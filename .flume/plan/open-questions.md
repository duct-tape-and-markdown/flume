# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

<!-- none open this tick — all seven prior questions closed by the v0.7 drain amendment (5c67ee0), the v0.8 boundary line (5c67ee0), or the operator dogfood commit (b327db3):

- "SETUP-WORKTREE-DOGFOOD-ADOPTION: §11's dogfood chain.ts adoption bullet
  shipped nothing" — closed by operator commit `b327db3`: verified this
  tick, `.flume/chain.ts`'s `buildSetupWorktree` now calls the exported
  `setupWorktree` helper directly, hand-rolled `pnpm install` and the
  unused execFile/promisify imports gone. §11 fully landed. No residual
  work.

- "HANDOFF-NOCOMMIT-BLIND: TickResult can't distinguish voluntary-bail
  from a genuine no-op" — v0.7 §15 gives this its spec home; filed as
  TICKRESULT-NOCOMMIT-CLASSIFICATION (engine leg only — the dogfood
  chain.ts wake-condition edit is operator-applied per §15's own note,
  same class as §13's prompt bullet).

- "ENGINE-PIN-HANDSHAKE-JOB-DIR-MISMATCH: the local-install check path
  never matches what job new actually provisions" — v0.7 §10 gained an
  amendment (2026-07-30) ruling reading (2), the job-scoped derivation,
  confirming this park's own suspicion that reading (1) was a wording
  gap rather than a deliberate bay-root resolution point. Filed as
  ENGINE-PIN-HANDSHAKE-JOB-SCOPE.

- "TAG-PATTERN-SLICE-CONSTRAINT: rendered schema omits the [a-z0-9]+
  slice constraint" — v0.8 §3 gives this its spec home, superseding this
  park's own lean toward "widen the regex": the engine drops owning tag
  grammar at all past mechanical safety: a chain wanting ALL-CAPS
  enforcement declares it in its own extension (v0.8 §2). Not filed as a
  pending entry this tick — v0.8 §§2-3 (the entry-schema split the
  refinement mechanism depends on) haven't been derived yet; carries
  forward to next tick's v0.8 derivation pass, no open question remains.

- "PENDING-NOTES-CAP-VISIBILITY: derivation-time prompt never states the
  notes cap" — v0.8 §3's sibling disposition: premise false. Both the
  `summary` and `notes` caps have been rendered since init (`fa0a770`,
  `src/PendingSchema.ts:219`, `:238`); the two DAL-job burns were agent
  noncompliance with a stated cap, not a rendering gap. No work either
  way — v0.8 §2 subsumes both caps into the dogfood chain's own
  extension declaration regardless.

- "SUPERVISOR-PROVISION-FAILURE-QUARANTINE: pre-tick worktree-sweep
  EBUSY burns a whole --max batch" — v0.7 §16 rules both legs (per-entry
  quarantine AND the consecutive-identical-failure backstop), resolving
  this park's "pick one" framing — the operator ruled both, not either
  alone. Filed as SUPERVISOR-PROVISION-QUARANTINE.

- "SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP: status can't see
  supervisor liveness; dropLastCommit doesn't check tip ownership" — v0.7
  §17 gives asks 2 and 3 their spec home (ask 1 was already verified
  implemented, no action, per this park's own research). Filed as two
  entries, split along their independent code paths: STATUS-SUPERVISOR-
  LIVENESS (ask 2, `src/cli.ts`) and DROPLASTCOMMIT-TIP-OWNERSHIP (ask 3,
  `src/git.ts` + `src/Dispatcher.ts` callsites).

- (earlier closures, unchanged from prior ticks:)

- "PROMPTS-BUILD-FENCE-INSTRUCTION: spec §13's `prompts/build.md`
  instruction has no phase writer" — closed by operator commit `6005318`
  applying the instruction directly (this park's own recommended path,
  precedent `b578a41`), and `spec/RELEASE-v0.7.md` §13 now carries a
  2026-07-29 delivery note confirming the bullet is operator-applied,
  not loop-derivable, and no entry should carry it. No residual work.

- "EXIT-CODE-CONTRACT: entry.files omits the test edits the spec-required
  behavior change forces, and two locked existing assertions directly
  contradict the new contract" — the write-up's own analysis already
  converged on option 2 (split, smaller blast radius) with reasoning, so
  per collaboration.md ("if research yields a clear answer... propose it
  directly, skip the park") this tick acted on it directly instead of
  re-parking: re-filed EXIT-CODE-CONTRACT as abort-only (test edits now
  folded into files per blocker 1) and split the shipped/errored counting
  into a new follow-up, EXIT-CODE-CONTRACT-COUNTS, blockedBy the first —
  its notes commit to a per-tick disk artifact (disk-is-truth) rather
  than a stdio-pipe change, so build isn't deciding that API surface.
- "SHIP-DETECTION-COUNTS-PARK-ONLY-COMMITS: a build commit touching only
  entryChannelPaths gets removed from pending.json as if shipped" — v0.7
  §12 gives this its spec home; filed as SHIP-DETECTION-DECLARED-FILES-DIFF.
  Near-miss confirming the urgency: 19be056 briefly shipped
  EXIT-CODE-CONTRACT off f5b60e1's park-only commit; an operator caught
  and reset it before this tick landed. Ship this one soon.

- "CLI-JUNCTION-SAFE-ENTRY: entry.tests names a file outside entry.files
  scope" — same shape as GATECONTEXT-REPOROOT-TESTS below: 08c2ace
  shipped src/cli.ts + CHANGELOG.md only (tests/cli.test.ts would have
  reverted the scoped commit). Routed to a filed follow-up
  (CLI-JUNCTION-SAFE-ENTRY-TESTS, files declares tests/cli.test.ts so the
  write guard allows the edit).

- "GATECONTEXT-REPOROOT: entry.tests names files outside entry.files
  scope" — routed to a filed follow-up (GATECONTEXT-REPOROOT-TESTS,
  files declares the two test paths so the write guard allows the
  edit). Option 2 from the prior write-up (tests[] paths belong in
  files[]) is already this doc's standing Derive-dimension rule, not a
  new decision — applied going forward, no amendment needed.
- "Engine-ownership requests from centercode-platform's chain" — v0.7 §1
  rules items #3 (GateContext.repoRoot) and #4 (exit-code contract) into
  this line (filed as GATECONTEXT-REPOROOT, EXIT-CODE-CONTRACT); items
  #1/#2/#5 (the structured-verdicts family: pending.json schema validation
  at the plan gate, plan-time path pre-checks, persisting revert verdicts)
  are explicitly declined for v0.7 and held for "a v0.8 line of their
  own" — an operator-level disposition already recorded in spec, not an
  open question anymore.
- "CLI entry silently no-ops through a directory junction" — v0.7 §3
  confirms the realpath-comparison fix; filed as CLI-JUNCTION-SAFE-ENTRY.
- "Harness block states the wrong (unnarrowed) revert fence on
  entry-scoped ticks" — v0.7 §2 confirms the effective-fence rendering;
  filed as HARNESS-BLOCK-EFFECTIVE-FENCE.
- "HARNESS-BLOCK-EFFECTIVE-FENCE: shipping breaks an existing
  out-of-scope test" — closed by applying option 1: re-filed the entry
  with tests/Dispatcher.test.ts + tests/Prompt.test.ts folded into
  files.edit (this tick, after the entry was found dropped from
  pending.json — see SHIP-DETECTION-COUNTS-PARK-ONLY-COMMITS above).
- HARNESS-BLOCK-EFFECTIVE-FENCE itself: this tick's commit-delta audit
  (c2a83e6 + eb631ec) traced the effective-fence union in
  src/Prompt.ts's effectiveFenceLines against the enforcing union in
  src/Dispatcher.ts's runAfterCommitGates (via builtinGates.ts's
  writablePathsGate) — identical entryPaths ∪ channelPaths construction,
  no drift possible. Docs example and both test files match §2's
  acceptance. This ship is genuine (entry.files were actually touched,
  unlike 8f11af9's park-only commit) — no reopening.
-->
