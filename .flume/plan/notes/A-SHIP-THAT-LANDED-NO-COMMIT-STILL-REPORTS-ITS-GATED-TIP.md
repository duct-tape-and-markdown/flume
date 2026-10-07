# The verdict cannot tell a ship that committed from one that did not

Three cases landed; all three red under the two mutations the entry named
(`gatedTip` moved inside the singleton commit guard; `exit !== "tip-claimed"`
narrowed to `exit === "committed"`). Arming: `gatedTipSingleton` gained an
`absorb` flag landing the span's content on trunk mid-tick, returning the
`landedFirst` sha; the two fanout exits reuse the no-commit-exit shapes from
the operator-line describe, and each reads the exit it took off the operator
line the rewrite's own exit composed (`noCommitLine`, `src/waveMerge.ts`) —
the only observable that separates the two, since both answer with the same
absent sha.

Observed while writing it, and the acceptance's wording assumed otherwise:
**`TickVerdict` carries no `commitSha` and no `ledgerCommitShas`.** Both live
on `TickResult` alone (`src/Phase.ts`). So "a gated tip beside no commit of
this tick's own" is unstateable from the on-disk artifact: the fanout arms
report `committed: true` (it is `shipped.length > 0`, `waveCommitted`,
`src/waveMerge.ts`) with no field saying whether a ledger commit landed, and
all three cases had to reach `outcome.result` for that half. A verdict reader
— the supervisor, `flume status`, a chain's `shouldRun` off
`readLatestVerdictsSync` — can see `gatedTip` and `headSha` and still cannot
tell a ship whose bookkeeping landed from one whose rewrite exited
`nothing-to-write` or `dock-outside-repo`. Candidate finding against
`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
rediscovered*: the engine holds `w.ledgerShas` and reports it on the handoff
surface only, where the artifact is the surface a later tick reads.

Not filed as part of this entry — the acceptance says no `src/` change — and
the gated-tip block's claims are complete without it.
