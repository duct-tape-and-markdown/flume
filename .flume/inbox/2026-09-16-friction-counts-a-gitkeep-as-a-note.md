# The friction channel counts a zero-byte `.gitkeep` as a note awaiting routing (pilot report from a win32 consumer on node 22, relayed by the operator)

`flume job status` on a freshly seeded job: `friction: 1 note(s) await
routing`. The note is `friction/.gitkeep`, zero bytes, copied by the
consumer's own seed dir. Verified on this tree: `src/friction.ts` lists
`entries.filter((e) => e.isFile())` and nothing else, while
`harness/layout.ts` already rules that a `.gitkeep` in a record directory
is not a record. Two answers to "what is a note" one seam apart, and the
engine's is the one that reads work into a placeholder forever.

Fork: the engine's friction listing skips dotfiles (a placeholder is no note
in any implementation), or the count is the chain's to filter and the spec
says so. Recommended the first; `spec/chain.md`'s friction section states
which files count.
