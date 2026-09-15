# The bootstrap window still tells the tick to stamp a sha it resolves itself

The sweep window now ends naming its tip, and plan-sweep.md copies it. The
sibling path is untouched and carries the same shape: `bootstrap()` in
`harness/windows.ts` ends its header "read every file below and stamp HEAD" —
a rediscovered sha, which is what *The stamp* fences. It is shared by both
cursors, so the fix is one edit covering derive and sweep together: resolve
HEAD once inside `bootstrap` and name that sha, as the rendered windows now
name their tip. Left out here because the entry scoped to
`renderSweepWindow`, and this one lands on the derive window too.
