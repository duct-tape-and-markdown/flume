# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Stale spec Drift notes — thirteen gaps this window's commits already closed

**NEEDS AMENDMENT**

Auditing this tick's commit-delta against the `> **Drift:**` notes each cited
commit claims to close shows the code caught up in thirteen places the spec
hasn't. Plan/build can't edit `spec/*.md` (`spec-plan-build.md`), so these
need a human pass to delete or fold into settled prose:

- `spec/loop.md:131` (refusal prints "HEAD is detached" for all three causes)
  — closed by `61bb614` LOOP-CURRENTREFPATH-CONFLATES-STATES.
- `spec/loop.md:348` (both halves: verdict-clear ordering, ledger-rewrite
  verdict loss) — closed by `5569e29` LOOP-DETACHED-HEAD-STALE-VERDICT +
  `9521069` LOOP-WAVE-VERDICT-LOST-ON-LEDGER-PARSEFAILURE.
- `spec/loop.md:418` (`erroredTicks` on-disk-verdict-only) — closed by
  `d2cbf17` LOOP-ERRORED-TICKS-SILENT-EXIT.
- `spec/loop.md:475` (backstop compares `signature[0]` only) — closed by
  `f29ff48` LOOP-BACKSTOP-SIGNATURE-INDEX0-ONLY.
- `spec/cli.md:48` (`HELP_SUB.tick` missing exit 2) — closed by `e085da2`
  CLI-HELP-TICK-MISSING-EXIT2.
- `spec/cli.md:211` (`job new` exits 1, not 2) — closed by `c92c105`
  CLI-JOBNEW-CJS-EXIT-CODE.
- `spec/cli.md:303` + `spec/chain.md:71` (pre-factory CI chain fixtures) —
  closed by `8e70115` CI-CHAIN-FIXTURES-FACTORY-MIGRATION. Caveat: the
  render-removal follow-up (`CLI-RENDER-REMOVAL-SMOKE-DOC-SITES`, filed this
  tick) still needs to land before those smoke steps are actually green.
- `spec/chain.md:360` (`prependHarnessBlock` renders `phase.gates`
  unfiltered) — closed by `f1305ad` CHAIN-AFTERMERGE-SINGLETON-PROMPT-FILTER.
- `spec/chain.md:420` (missing gate-option type exports) — closed by
  `e4beb25` CHAIN-EXPORT-GATE-OPTION-TYPES.
- `spec/worktrees.md:161` (unguarded `setupWorktree` `Promise.all`) — closed
  by `0c0742c` WORKTREES-SETUPHOOK-ISOLATION.
- `spec/worktrees.md:191` (retired postMerge/wave-revert JSDoc vocabulary) —
  closed by `a1e80a7` WORKTREES-GATEPHASE-RETIRED-DOC.
- `spec/worktrees.md:287` (`harvestFriction` retry collision) — closed by
  `3c5cfa2` WORKTREES-HARVESTFRICTION-COLLISION.
- `spec/pending.md:278` + `spec/prompt.md:105` (unconditional entry-scope
  narrowing) — closed by `04e1918` PENDING-SCOPEWRITESTOENTRY-OPTIN.

`spec/loop.md:173` (tip-moved) is deliberately **not** on this list — see the
next question, it isn't cleanly closed.

## LOOP-TIPMOVED-MULTICOMMIT-TICK now also reverts a legitimate concurrent commit

**PARKED**

`0b2c6f6` (LOOP-TIPMOVED-MULTICOMMIT-TICK) fixed the documented bug — a tick
landing 2+ commits only had the newest undone on tip-moved — by measuring the
real span (`git.commitsSince`) and soft-resetting that many. But
`checkTipMoved` still can't distinguish "our own tick made N commits" from
"an operator's real commit landed between our `preHead` read and `postHead`"
— both produce identical `parent(postHead) ≠ preHead` evidence. The fix's own
test changed to match: a scenario that previously asserted an operator's
concurrent commit *survives* the revert now asserts it's undone too (soft
reset — reflog-recoverable, but off trunk) alongside the tick's own commits.

`spec/loop.md`'s "Tip verify" section doesn't document this new behavior —
its Drift note there predates the fix and still describes only the old bug,
left alone pending this question rather than marked closed.

Options:

1. **Accept it.** A concurrent operator commit racing the exact tip-verify
   window is already a narrow, discouraged case — the tip claim's whole
   point is one writer at a time. Soft-reset is non-destructive (reflog holds
   it), and the tick's own multi-commit correctness is the common case this
   closes. Document the tradeoff in `spec/loop.md` instead of building around
   it.
2. **Distinguish the cases.** The dispatcher could count its own commits
   during the tick rather than inferring the span from git state alone —
   revert exactly that many, leaving any excess (an interloper's) alone.
   More precise, more machinery, and the excess commit still isn't gated by
   anything once left in place.
3. **Leave both bugs live.** Revert `0b2c6f6`, back to under-reverting a
   multi-commit tick. Worse on both axes — not seriously proposed.

Recommended: (1) — the case is narrow and self-inflicted (racing the tip
claim), the fallback is non-destructive, and (2)'s extra precision is
disproportionate machinery for a case the tip-claim mechanism already
discourages (`collaboration.md`'s complexity signal). Needs the human call
because it trades "never touch a third party's commit" against "always
fully undo our own multi-commit tick," and reasonable people could weigh
that either way.
