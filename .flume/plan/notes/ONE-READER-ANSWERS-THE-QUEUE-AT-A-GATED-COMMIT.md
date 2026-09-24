# The gated queue was three facts, not one listing

`readGatedQueue` (`src/pendingLedger.ts`) answers `{ rel, dirRel, files }`,
not just the listing the entry described. The pending gate needed the
repo-relative dir for a second job beyond the read: the claim check compares
`touchedPaths` against `<dirRel>/` (`touchedEntryFiles`). And both gates were
also spelling `relative(flumeDir, pendingDir)` for their refusal messages —
the same restatement family, one rung below the offset. Reporting all three
off the one read left nothing for either caller to compose.

Two follow-on facts for the next derive:

1. `FlumeApi.git.readQueueAtRef` is gone from the chain surface, replaced by
   the top-level `FlumeApi.readGatedQueue` (a gate-context read is not a git
   helper). It never shipped — it landed after the 0.18 cut — so
   `docs/MIGRATING-0.19.md` § 2 was retargeted to teach the new spelling
   rather than gaining a removal note. `readQueueAtRef` stays an internal
   `src/` export; its consumers are the gated reader, the dispatch read and
   two test files.
2. `rel` is folded through `gitPath`, where the two old copies were
   host-native, so a gate message names the queue in git's alphabet on win32
   as well. Behaviour-identical on posix, which is the only lane the suite
   runs — nothing pins the win32 spelling of a gate message, and I did not
   file one: the fold now has a single home, which is what the lens
   (`posture-sweep.md`, *A repo-relative path composed with `node:path`*)
   asks for.

No property filed, as the entry declared. Both callers are driven end-to-end
by existing suites (`tests/builtinGates.test.ts` over real repos,
`tests/harnessGates.test.ts` with the real engine wired in), and the export
and citation pins held the move.
