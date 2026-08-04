# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## spec/cli.md's Drift note is stale — CLI-FLUMEDIR-PROVENANCE-STAMP shipped

**Status:** NEEDS AMENDMENT

The Drift note under "State-root and config-dir resolution" (spec/cli.md:152-157) describes `impliedRepoRoot`'s path-shape cross-repo detection and its `/mnt/state/.flume` misfire. That code is gone: `CLI-FLUMEDIR-PROVENANCE-STAMP` (336edb8, shipped eb79bf0) replaced it with the `FLUME_DIR_RESOLVED_FOR` stamp the section above it already documents, and the misfire repro is now a passing test (`tests/cli.test.ts` — "an absolute FLUME_DIR with no FLUME_DIR_RESOLVED_FOR stamp never throws, whatever its shape"). The note describes a defect that no longer exists.

Recommend deleting spec/cli.md:152-157 — the prose that hand-held the gap has a test pinning it now (`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*). Plan can't make this edit itself; `spec/` is human-maintained (`.claude/rules/spec-plan-build.md`).
