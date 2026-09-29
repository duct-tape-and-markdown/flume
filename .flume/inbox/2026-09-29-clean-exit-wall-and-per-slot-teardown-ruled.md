# Ruled: the clean-exit wall, and the per-slot teardown sections

- *Does the backstop reach a repeated clean-exit wall* — (1): the sentence was
  wrong, the behavior is right. `spec/harness.md`, *The default `handoff`*
  now says a wall recording a failure fact is the backstop's and a slice
  exiting clean every tick is bounded by the run's budget alone
  (`spec/loop.md`: a clean exit never joins the accounting). The
  `harness/handoff.ts` comment naming "an unroutable record" as a backstop
  case shrinks to match.
- *Do the two teardown sections restate as per-slot* — deltas 1-3 restated in
  `spec/worktrees.md` (per-slot teardown on the creation queue with its real
  warrant; the index-alignment clause gone; the harvest runs as each
  worktree's attempt ends). Delta 4 (2): what a thrown wave leaves standing
  is stated in the serialization section, pointing at *Startup sweep*.
