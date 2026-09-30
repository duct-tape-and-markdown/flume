# The snapshot's null-skip had one reachable producer, and it is a gitlink

The per-path skip in `snapshotReverted` (`src/priorAttempts.ts`) now warns with
the path. Reachability, measured: `git diff --name-only --diff-filter=d base
head` names a changed gitlink, and `readFileAtRef` answers a `160000 commit`
row with `null` — no listing/tree race, no mock. The fixture mints one with
`git update-index --add --cacheinfo 160000,<sha>,vendor/dep`, cheaper than a
real submodule for any future case needing a non-blob row at a ref; the case is
a full agreement gate (real span, engine's own listing and tip-read, snapshot
on disk as the verdict).

Two things for plan:

1. **Warn volume is bounded by the span listing, nothing declared.** A repo
   with several submodules reverts one span and gets one warn per gitlink in
   it. Correct as a fact, but it is the first per-path line on the revert path
   rather than a per-artifact one. If the loop grows a noise budget on the
   store's logger, this is the site that notices first.
2. **A gitlink in a reverted span has no recovery story**, and `spec/worktrees.md`
   ("Reverted prose survives the reset") does not say it should. A snapshot
   cannot hold a submodule pointer as file content, so the warn is the whole of
   what an operator gets. Not filed as a question — no prose promises otherwise
   — but the silence is silence, not a decision.

No debt observed nearby: the whole-artifact catch and the `excludeDeleted`
listing were already what their comments claimed.
