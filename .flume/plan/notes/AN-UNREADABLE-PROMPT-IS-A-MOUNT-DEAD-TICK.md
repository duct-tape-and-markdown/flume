# A tick's refusal reaches the operator twice, on one surface

Shipped: readPhaseTemplate raises its own class, Dispatcher.tick reports
`TickOutcome.promptUnreadable` (both paths), tickExitCode gains a 69 arm that
names them, docs/CLI.md's tick and loop rows follow.

Two things for the next plan tick.

**1. The summary and the log line are one fact spelled twice.** Every
`return { failed, summary }` arm in `Dispatcher.tick` also calls
`this.log.error` with the same or near-same text, and `cliTick` prints
`outcome.summary` unconditionally — so an operator sees the refusal twice per
tick, once prefixed `[flume]` and once bare. Standing pattern (the
orphaned-awake and chain-resolution arms do it too), not introduced here. It
bit: the loop case's "one child spent, not three" count had to key on the
prefixed form, because the bare copy doubles every match. Derived-state shape
(`engineering.md`, *Derived state is computed, never restated beside its
source*) on a per-tick operator surface — worth a lens, not obviously worth an
entry, since which of the two is authoritative is a decision nobody has made.

**2. 69 now has three causes and one halt message.**
`src/loopSupervisor.ts`'s mount-dead halt said "the chain failed to load",
which is now wrong for two of the three (unparseable queue, unreadable
prompt). Reworded to point at the cause the child already printed rather than
restate one this process never read. If a fourth cause lands, the arm's phrase
is the only place it needs spelling — the help block and docs/CLI.md both
derive from `tickExitPhrases`/`tickExitCauses`.

**Not done deliberately:** `PromptTemplateUnreadableError` is not on
`src/index.ts` or `FlumeApi`. A chain reads the fact off
`TickOutcome.promptUnreadable`; exporting the class would be public surface
with no consumer (`engineering.md`, *An export earns its consumer*). If a
downstream chain wants to classify on the class, that is a surface ask.
