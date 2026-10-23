# The new fate reached two readers the entry did not name

Shipped as declared: `TrunkMove` now states which refusal it was instead of
leaving it to be read off an absent `movedTo`, and both legs plus the batch
row `uncommitted-work`.

Two sites outside `entry.files` had to move with it, both because the old
single fate was load-bearing there:

- `src/loopSupervisor.ts` — a dirty-checkout refusal counted as an errored
  tick via `verdict.tipMoved`. Leaving the allowlist alone would have dropped
  that signal silently, so the formula gained a disjunct over the new merge
  outcome. It is the stronger case of the two: no later tip clears it, so a
  run that keeps ticking past one ships nothing until a human commits or
  discards that work.
- `docs/CLI.md`, *`flume loop`* — the same sentence states that accounting to
  consumers, so it names the second cause now.

One existing case was already exercising this refusal under the wrong name
and now reads the new one: "a decide-read reflects the committed tip,
ignoring an uncommitted working-tree edit to an entry file"
(`tests/Dispatcher.test.ts`) — the ledger commit rewrites the very file the
operator has uncommitted, which is the dirty-checkout refusal, not a race.

Not done, and plan's call: the Dispatcher's one-line summary words
`tip-moved` only (`src/Dispatcher.ts`), so this fate reads as a bare
"no commit" there while the warn line and the verdict row both name it. A
summary that reads `MergeOutcome` is a wider change than this entry.
