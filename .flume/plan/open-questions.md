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

## win32's ~260-char MAX_PATH fact has no home in platform-facts.md — restated at 6 call sites

**Status:** NEEDS AMENDMENT

Sweeping `tests/job.test.ts`'s neighborhood surfaced that the general win32 total-path (~260 char) limit — fixed via `namespacedJoin` (`src/paths.ts`) — is a genuine platform fact (CLAUDE.md: "a pnpm behavior, a git limit, a Node constraint, a measured platform failure") but is documented only as a restated code comment, independently, at 6 sites: `src/paths.ts:2`, `src/Dispatcher.ts:619,2424,2684,2767`, `src/job.ts:391`. Six test-side tags (`WRITEREVERTNOTE-`, `HARVESTFRICTION-`, `FRICTIONCOUNT-` ×2, `SNAPSHOTREVERTEDFILES-` ×2, `PRIORATTEMPT-WIN32-PATH-TOTAL-LIMIT`) show it was rediscovered per call site rather than read off one home — exactly the cost `.claude/rules/platform-facts.md`'s own preamble exists to avoid. It's a distinct fact from platform-facts.md's existing "`git worktree add` refuses long paths on win32, below MAX_PATH" section — that one is git's own ~200-char refusal, unreachable by `toNamespacedPath`; this one is the general Node `fs`-call limit that `toNamespacedPath` does fix.

Neither plan nor build can add this: `.claude/rules/**` sits outside every phase's `writablePaths` (`.flume/chain.ts`) — it's human-authored, same footing as `spec/**`. Proposed section, ready to paste into `.claude/rules/platform-facts.md`:

> ## Windows MAX_PATH (~260 chars) breaks fs calls even with no long single component
>
> Node's `fs` calls fail past Windows' ~260-character total path length even where no single path component is long — a worktree path nested under a friction dir, a job dir nested under a state root, a revert snapshot path under `prior-attempts/`. `toNamespacedPath` (`node:path`) prepends the `\\?\` extended-length prefix on win32 (no-op elsewhere), which lets fs calls survive it.
>
> Every call site that builds a path for an fs call wants both `join` and `toNamespacedPath` together: `namespacedJoin` (`src/paths.ts`) is the shared idiom — reach for it instead of a bare `join`, and instead of restating this fact in a new comment.
>
> This is a different limit from `git worktree add`'s own ~200-char refusal above — `toNamespacedPath` does not reach that one, since git builds the path itself.

Once this lands, pending entry `PLATFORMFACTS-WIN32-MAXPATH-POINTERS` (parked on this question) shrinks the 6 restating comments to pointers.
