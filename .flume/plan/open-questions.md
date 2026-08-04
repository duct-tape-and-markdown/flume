# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## FLUME_DIR provenance-stamp ruling needs `spec/cli.md` amended before it can become a pending entry

**Status: NEEDS AMENDMENT**

Inbox (2026-08-04, operator ruling) closed `CLI-FLUMEDIR-CROSS-REPO-ROOT-REFUSAL`'s parked
question at option 2: replace `impliedRepoRoot`'s path-shape walk (`src/cli.ts`) with an
explicit provenance stamp — `resolveStateDirs`'s write-back also writes
`FLUME_DIR_RESOLVED_FOR=<repoRoot>`, and `CrossRepoFlumeDirError` fires only when that stamp is
present and disagrees with the freshly-resolved `repoRoot`.

The ruling is decided, but nothing in `spec/*.md` documents the cross-repo-refusal mechanism at
all — not even the original path-shape version shipped in `d9662a3` (verified: zero matches for
`impliedRepoRoot`/`CrossRepoFlumeDirError`/"cross-repo" across the whole spec corpus).
`spec/cli.md`'s *State-root and config-dir resolution* documents the `FLUME_DIR`/
`FLUME_CONFIG_DIR`/`FLUME_JOB` write-back (its "Canonicalization write-back" paragraph) but says
nothing about a fourth stamp var or a refusal case. Plan derives pending entries from spec, and
`spec/**.md` sits outside plan's and build's writable paths (`spec-plan-build.md`) — a human or
human-directed interactive session has to add the documentation before this becomes a clean,
citable pending entry.

Proposed addition to `spec/cli.md`'s *State-root and config-dir resolution*, after the existing
"Canonicalization write-back" paragraph:

> **Cross-repo refusal.** An absolute `FLUME_DIR` inherited from a parent flume process
> (loop→tick, or a nested invocation) carries a `FLUME_DIR_RESOLVED_FOR=<repoRoot>` stamp,
> written back alongside `FLUME_DIR`/`FLUME_CONFIG_DIR`/`FLUME_JOB`. `resolveStateDirs` refuses
> (`CrossRepoFlumeDirError`, exit 2) only when that stamp is present and disagrees with the
> freshly-resolved `repoRoot` — a value typed for this invocation carries no stamp and is never
> refused on that basis, regardless of what its path contains.

Once that (or the human's preferred wording) lands, plan derives the `src/cli.ts` +
`tests/cli.test.ts` pending entry next tick, citing it directly.

## `.flume/chain.ts`'s `setupBuildWorktree` docstring describes a fanout-isolation gap that `0c0742c` already fixed

**Status: NEEDS AMENDMENT**

Found sweeping `tests/chain.test.ts`'s neighborhood (its subject, `.flume/chain.ts`, is an
immediate-import read under the just-closed posture-sweep "module" ruling's option 1).
`setupBuildWorktree`'s docstring (`.flume/chain.ts`, the `setupBuildWorktree` const) says:

> "The dispatcher's per-entry provisioning isolation wraps `createWorktree` only. Chain
> `setupWorktree` hooks run in an unguarded `Promise.all` after it... the gap between the
> isolation's scope and what it should cover is filed in `.flume/inbox.md`."

Both claims are stale. `0c0742c` ("build: isolate setupWorktree hook throws to the offending
fanout entry", 2026-08-03) gave the hook the same per-entry try/catch `createWorktree` already
had — a throw now records a `ProvisionFailure` and drops that one entry; the wave continues.
`spec/worktrees.md` already reflects the fix ("Provisioning failure is isolated to the entry
that hit it") and carries no Drift note for it. The docstring's "filed in `.flume/inbox.md`"
claim is also stale — no such entry exists in the current inbox.

`.flume/chain.ts` sits outside every phase's writable paths (`buildFence` excludes it by name;
plan's lane is narrower still), so correcting the docstring needs a human-directed interactive
`chore(flume):` commit — same class as the harness-surface edits closed in `62bb03e`/`d8e4231`.

Proposed: delete the paragraph starting "The dispatcher's per-entry provisioning isolation wraps
`createWorktree` only" and replace with a one-line note that setup-hook throws are isolated
per-entry (citing `spec/worktrees.md`'s *Provisioning failure is isolated to the entry that hit
it*), dropping the "filed in inbox.md" sentence entirely.

## `spec/worktrees.md`'s test-lane section still names `VITEST_LANE`, which `6346bfb` retired

**Status: NEEDS AMENDMENT**

`6346bfb` ("build: select the integration test lane via vitest --mode, not an env-var prefix")
switched `pnpm test:integration` from `VITEST_LANE=integration vitest run` to `vitest run --mode
integration`, because the env-var prefix is POSIX-only shell syntax and fails on win32
(`spec/cli.md`'s win32-supported-host commitment). The commit's own body flags the fallout:
"spec/worktrees.md:309 still quotes the old `VITEST_LANE` invocation and goes stale as of this
commit — spec/ is outside build's writable paths, so that update needs a human-directed
interactive session." Confirmed still true at HEAD: `spec/worktrees.md`'s *The default test lane
must stay fast* still reads "They run via `pnpm test:integration`, which selects the lane with
`VITEST_LANE=integration`."

Proposed replacement text for that line: "They run via `pnpm test:integration`, which selects
the lane with `vitest run --mode integration`."
