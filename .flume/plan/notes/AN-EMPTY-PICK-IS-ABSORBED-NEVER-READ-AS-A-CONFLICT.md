# The absorbed shas reach the log and no reporting surface

Shipped as specced: `cherryPickRange` (`src/git.ts`) returns the commits it
skipped, both merge legs stop reading an emptied pick as a conflict, and a
wholly-held span merges with no commit to add.

Three observations for the next derive.

1. **The skipped shas are reported to the leg and nowhere else.** Both legs log
them; no `TickResult` or verdict field carries them. For the whole-span case
the merge row's equal shas are the fact (per the ruling), but a *partial*
absorption — span of three, trunk held one — leaves no on-disk trace at all, so
a chain wanting to route on it re-derives from the span's commit count against
the range it landed (`engineering.md`, *A fact the engine holds is reported,
never rediscovered*). Whether that wants a field is an engine-surface decision,
not mine.

2. **Singleton reports `committed: false` with no `noCommit` mode** on a
wholly-absorbed span — the shape `tipMoved` already has, and no mode was added
per the acceptance. A chain treating `!committed` as implying one of the four
modes sees an unclassified no-commit tick. Ours does not; a downstream one
might.

3. **afterMerge failure over a wholly-absorbed span digests a commit the tick
never made.** Both legs pass `mergedSha` to `buildGateRevert`, and with nothing
added that sha is the foreign tip — so the prior-attempt record can name
another writer's diff as the reverted work. The revert itself is safe
(`resetKeepTo(preCherry)` is a no-op, the ownership guard never fires). Edge of
an edge (whole span absorbed *and* an afterMerge gate failing), so not built
around; filed here rather than decided.

Mechanism note: the probe is `CHERRY_PICK_HEAD` present with `diff-index
--cached HEAD` clean. A pick git refused before starting (dirty tree over a
touched path) writes no `CHERRY_PICK_HEAD` and still throws; a conflict leaves
unmerged entries. Both measured on git 2.43. `--empty=drop` is 2.45, above the
2.36 floor.
