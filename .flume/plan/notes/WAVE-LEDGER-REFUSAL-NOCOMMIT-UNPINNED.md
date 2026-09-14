# Refusal-site noCommit: one leg pinned, the rest still narrow

Pinned the shipped=0 leg of the refusal site's `waveNoCommitCause` call
(`src/Dispatcher.ts`, the `WaveLedgerParseFailure` catch). Reaching it at
all needs shipped=0 *and* a recorded footprint, because
`commitPendingUpdate` — and so the rewrite read that refuses — is skipped
when the wave has neither.

Observed while building it: only two mergeOutcome rows carry a footprint —
`afterCommit-reverted` and `merge-conflict` (`git.diffNameOnly` capture).
The first implies a per-entry `gate-revert`, so the only refusal-site
verdicts that reach the precedence chain below `gate-revert` are waves
carrying a merge-conflict entry alongside a render-refused /
platform-preempt / clean-exit sibling. Those three legs remain unexercised
at this site — a narrower gap than the one this entry closed, and probably
accepted debt rather than three more 20s fanout fixtures.

Also repointed a stale cite: the wave-noCommit-precedence block comment in
`tests/Dispatcher.test.ts` named `Dispatcher.ts:1836-1853`; it now names
`Dispatcher.waveNoCommitCause`.
