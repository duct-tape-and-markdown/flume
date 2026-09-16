# The no-instant reading was mine to choose

Two calls the entry did not make.

1. **A lock stating no instant.** spec/cli.md line 7 says the spend window is
   "the instant the lock states"; it is silent on a lock with no second line
   (pre-0.17, or hand-rolled). status now withholds the spend line and names
   it on stderr rather than total an unbounded log. Alternatives: refuse
   (breaks status's exit-0-always) or fall back to mtime (the defect this
   entry removes). Pinned in tests/cli.test.ts; a different ruling lands in
   the spec section.

2. **No CHANGELOG line.** The build prompt forbids one; the entry named
   CHANGELOG.md under 0.17's `### Breaking`. The commit body carries what a
   release note needs and docs/MIGRATING-0.17.md is the page. The cut still
   owes the heading — the coverage pin in tests/harnessPackaging.test.ts
   reads *released* minors only, so nothing reds until 0.17 ships.

Also: `liveLoopPid` (src/job.ts) and `liveTipClaimPid` (src/git.ts) stay
sibling probes as declared; what they now share is the statement they decode
(`parsePidClaim`, src/pidClaim.ts), not the probe.
