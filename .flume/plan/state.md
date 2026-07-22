# State

Phase: **v0.4 ACTIVE** (`spec/RELEASE-v0.4.md` opened `d2371fe`; v0.1/v0.2/v0.3 frozen). Mode this tick: **audit**.

## This tick — audit the second v0.4 ship wave (2 build commits + chore drain)

Delta = 3 commits since `519ed9f`, no spec change, empty inbox, no blocked entries.

- `40852cc` **ENTRY-SCOPED-GUARD vs §5: conformant.** All mandates verified at source: `Phase.entryChannelPaths` (default `[]`), gate narrows to entry∪channel with phase globs as ceiling — both checks apply (`writablePathsGate` + `EntryWriteScope`, `src/builtinGates.ts`), singleton ticks untouched, failure details name each path with which check it fell outside, PendingSchema obligation text lands in both the zod JSDoc and `renderSchemaForPrompt`. §7 §5 matrix fully tested (4 cases, incl. persisted §5 record + retry-prompt path naming). Verified the literal-path-through-glob-matcher claim: `globToRegex` escapes regex specials; `*`/`?` unescaped but illegal in win32 filenames — no finding. Cherry-pick-conflict test re-plumb via `entryChannelPaths`: necessary §5 consequence, accepted. **Confessed incidental** (`tests/PendingSchema.test.ts` snapshot moved with the mandated schema text, undeclared by the entry): plan defect last tick, **ACCEPTED AS DEBT** — the obligation text is now standing; plan declares snapshot-covered incidentals henceforth, and the example feeds the §5-dogfood OQ's prompt line.
- `57b99bd` **TEST-PR5-SURFACE vs §2c: conformant.** Tests only, both files declared. Loop-lock: both mandated outcomes via one real CLI spawn each (`--max 0`, `hermeticEnv`, `node <tsx cli.mjs>` per §6), plus pidfile-lifecycle asserts. Worktree-base: override + default cases asserting agent cwd placement and teardown. **FINDING** (from commit body, verified at `src/Dispatcher.ts:1367`) → **`FIX-RELOCATED-PENDING-COMMIT`**: `commitPendingUpdate` stages `pendingPath` into the repo chore commit unconditionally; with flumeDir relocated outside the repo (v0.3 §11) the `git add` fatals *after entries already merged* — relocated-dock fanout ship bookkeeping is broken. Derived at queue head (bites the imminent flume-dock consumer: out-of-tree docks per v0.3 §13 + fanout).
- `52186ef` chore drain: removed exactly the 2 shipped tags; clean.

**Derive**: 1 entry from the build-flagged finding (`FIX-RELOCATED-PENDING-COMMIT`, per v0.3 §11, fix shape unambiguous — §13's out-of-tree-dock posture decides it, no OQ). **Drain**: none (inbox empty). **Promote**: none (no blockedBy gates).

## Queue (3)

Head: `FIX-RELOCATED-PENDING-COMMIT` (shipped-surface correctness first). Then `PHASE-AGENT`, `FIX-EXTRAENV-JSDOC-SCOPE`. All open, no gates.

## Active plan target

`spec/RELEASE-v0.4.md` — decomposition current; underived surface: none. Shipped so far: §3, §2c tests + docs, §5 guard, §6 lane (CI proof still pending push). Remaining spec work: §4 (`PHASE-AGENT`).

## Open questions

**3**: §7a gate-move (PARKED, `chore(flume):`), v0.4-§5 dogfood adoption (PARKED — **precondition satisfied** this tick, `chore(flume):` actionable, can share a commit with the §7a move), §3 loop-78/mixed-flag recording (NEEDS AMENDMENT, two one-line spec edits).

## Writable-paths / trunk

- Wrote `.flume/plan/{pending.json,state.md,open-questions.md}`; inbox.md untouched (empty). New entry targets `src/` + `tests/` (build-writable ✓).
- Trunk: HEAD `52186ef` at tick start, tree clean. **origin/main 30 behind** — windows lane and everything post-PR#5 unexercised in CI; human push still pending.

Plan continues: no
