# The footprint half of the same composer is still unread

Both no-commit exits now drive real `commitPendingUpdate` calls through the
wave and their lines are asserted whole; the swap-the-arms mutation reds both.
Two adjacent facts for the next plan tick:

- `noCommitLine` (`src/waveMerge.ts`) composes its subject from two arms, and
  only the `shipped <tags>` one is read. The `footprints for <tags>` arm — a
  wave that shipped nothing and recorded a merge-failure footprint, then hit a
  dock or a no-op rewrite — is read by no test, and neither is the committing
  stage's sibling `[flume] footprint commit <sha>: <tags>` line. Same seam,
  same swap risk; a footprint-only wave against a relocated dock would reach
  it. Not filed here because the entry's acceptance fenced the committing line
  and the tip-claim warn line as unchanged.
- Reaching `nothing-to-write` from the wave needs the shipped entry's file to
  be gone from the tip by rewrite time, since the rewrite re-reads `HEAD`
  rather than the decide-read snapshot. The case drives that through the span's
  own commit retiring its entry file (the fence is `**`, so the phase is the
  queue's declared writer). That is the one deterministic route found — a
  concurrent hand fix on trunk mid-wave would also do it, but the ordering is a
  race and the tip move risks a different refusal.
