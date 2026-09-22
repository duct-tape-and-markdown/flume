# Re-ship after a collateral revert, and one reading I had to pick

**The prior revert was not this diff's.** The `named lines` afterMerge
gate reverted attempt 1 for a commentCitations failure the change never
touched — `tests/cli.test.ts` citing a posture-sweep.md bold span the
section resolver could not match, the red trunk already filed as
`2026-09-22-a-red-trunk-reverts-every-later-entry.md`. That citation is
green on today's tip; the full suite is green with this diff applied,
and both `tests[]` lines were re-verified red on the pre-fix `src/`.

**"the 69 classification stays the parse failure's alone."**
`tickExitCode` maps every `failed: true` to EX_MOUNT_DEAD, so the widened
arm exits 69 too; I read that line as scoping the parse failure's own
narration (the unparseable-queue repair), not asking for a second exit
class. A distinct code would need TickOutcome, cli.ts and loopSupervisor
— a separate entry. Consequence worth knowing: a non-parse ledger
refusal now fail-fasts `flume loop` as mount-dead, where the bare
re-throw used to exit 1 and let the run continue.
