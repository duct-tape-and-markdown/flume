# Flume — v0.5.0 Release Target

## 1. Purpose & scope

Collapse the dock capability into flume. One theme: **a job is a branch plus
a state root, both named by convention** — `.flume/jobs/<name>/` (tracked,
runtime subdirs ignored) on branch `job/<name>`. The v0.3 relocation seams
(§11–§16) already make the state root a parameter; this line adds thin verb
sugar over them and deletes the machinery the wrapper repo existed to hold.
The wrapper (`flume-dock`) retires when this line ships; its retirement and
the private template repo's rewrite are coordinated outside this corpus.

Design record: `docs/PRD-dock-collapse.md` (accepted 2026-07-22, after an
adversarial source review; its §7 lists the reversals). Net configuration
surface of this line is **negative**: one dead option deleted, no manifest,
no trunk config, no branch overrides. Added: one env var, one global flag,
five subcommands.

## 2. Trunk contract — HEAD-is-truth, `trunkBranch` purged

`DispatcherOptions.trunkBranch` is dead code: stored and lazily defaulted
(`src/Dispatcher.ts:373,385,456-457`), consumed nowhere. The runtime's
actual trunk mechanism is HEAD of the working tree the loop runs in — the
singleton cwd and the ship cherry-pick both operate on `repoRoot`'s
checkout. This is how flume-on-flume has always shipped to `main`.

- **Delete `DispatcherOptions.trunkBranch`** and the lazy
  `currentBranch` default (pre-1.0 clean-slate: edit in place, no shim).
- **Document HEAD-is-truth as the trunk contract**: commits land on the
  checked-out branch of the working tree the loop runs in; the runtime
  never switches branches. Checkout is a human/verb act (§5).

## 3. Job resolution — `--job <name>` / `FLUME_JOB`

- **`flume --job <name> <cmd>`** (global flag, any subcommand) resolves
  `FLUME_DIR` = `FLUME_CONFIG_DIR` = `<repoRoot>/.flume/jobs/<name>` and
  sets `FLUME_JOB=<name>`, all canonicalized and written back into env at
  CLI entry — the §12 write-back pattern, so loop-spawned tick children
  inherit the resolution via env, not flags. `FLUME_JOB` set directly (no
  flag) is honored identically. Explicit `FLUME_DIR`/`FLUME_CONFIG_DIR`
  alongside `--job` is a usage error (exit 2): one resolution authority.
- **Wrong-branch guard.** Mutating subcommands under a job resolution
  (`tick`, `loop`) assert `HEAD == job/<name>` before dispatch and refuse
  loudly otherwise (non-zero exit naming both branches). Read-only
  subcommands (`status`, `render`, `wake`, `sleep`) skip the check. This is
  the verb-owned convention check — cheap because §1 makes the branch
  knowable — not a resurrected trunk config seam.

## 4. Job-scoped fanout branches

Fanout worktree branches are today repo-global `flume/<slug>` created with
`-B` and deleted with `-D` (`src/Dispatcher.ts` `createWorktree`, `git.ts`
`addWorktree`): two jobs sharing a tag slug silently clobber each other's
branches.

- With `FLUME_JOB` set, worktree branches become
  **`flume/<job>/<slug>`**. Without it, the legacy name stands (bare
  `.flume` harnesses unchanged).
- The dispatcher receives the namespace as an option resolved by the CLI
  from `FLUME_JOB` — no path-sniffing of `flumeDir`.

## 5. Lifecycle verbs — `flume job <verb>`

New subcommand family: `flume job new|run|rm|status|extract`. Machinery
only; no presets, no encoded checks, no harness content (v0.3 template-seam
posture holds — content arrives via `--template`, caller-owned).

### 5a. `flume job new <name> [--template <dir>]`

From current HEAD (no `--from`, no `--branch`):

1. `git checkout -b job/<name>` (reuse if it exists).
2. Seed `.flume/jobs/<name>/` from `--template` (verbatim recursive copy).
   Template absent → empty dir + warning to populate before `job run`.
3. **Ensure runtime ignore entries** in the job dir's `.gitignore`:
   `awake/`, `prior-attempts/`, `worktrees/`, `node_modules/`, `loop.pid`.
   Create or merge (idempotent, preserves template lines). Runtime-owned
   layout is machinery knowledge; chain-convention dirs (`sessions/`) are
   the template's to add.
4. **Provision unconditionally**: junction (win32) / symlink
   `<jobdir>/node_modules/@dtmd/flume` → flume's own package root
   (`resolve(HERE, "..")` from the running CLI). Version coherence: the
   chain resolves the exact flume that ticks it, even when the repo
   declares another version. Skip only if the link already exists.
5. Pin `core.longpaths true` (win32 only, repo-local, idempotent).
6. Baseline-commit the seeded harness (`git add <jobdir>` — the ignore
   entries keep runtime out) so plan/build produce clean deltas.
7. Stay on `job/<name>` (ready to tune, then run).

### 5b. `flume job run <name> [--max N]`

1. Assert-or-checkout `job/<name>` (error if the branch does not exist).
2. Wake `chain.phases[0]` **iff the baton is hibernating** — the entry
   phase is the chain's first by convention (content-free; no hardcoded
   phase names). A non-hibernating baton is left untouched (mid-job
   resume).
3. Run the standard loop under the job resolution (§3): lock, supervisor,
   exit codes all unchanged from `flume loop`.

### 5c. `flume job rm <name>`

1. Refuse while the job's `loop.pid` records a live pid.
2. `git rm -r .flume/jobs/<name>` + cleanup commit on the job branch;
   remove untracked runtime remnants; `git worktree prune`.
3. The job branch survives — integration (merge/squash) and branch
   deletion are the operator's acts.

### 5d. `flume job status`

Enumerate `.flume/jobs/*`: awake phases + pending count per job (per-job
`Baton` read; observational, no side effects).

### 5e. `flume job extract <name> --onto <base> [--intake <path>]...`

The clean-history ending, for deliverables where harness commits must never
appear and squash rights are absent. Ported undock semantics, manifest-free
— all inputs explicit at point of use; `--onto` is required, never guessed.

1. Refuse if branch `<name>` already exists (no clobber).
2. Fork `<name>` off `--onto`; **intake pass-through first** (sync each
   `--intake` file to the job branch tip, ship the delta as one commit —
   ordering prevents cherry-pick conflicts on plan-side appends), then
   cherry-pick, oldest-first, the commits in `<base>..job/<name>` touching
   any path outside `.flume/jobs/<name>` and outside the intake set.
3. On cherry-pick failure: abort, unwind to the job branch, delete the
   partial branch — extract is retryable, nothing lost.
4. Harvest `friction.md` and `plan/open-questions.md` from the job branch
   (git show, not worktree) to stdout for operator routing.
5. Delete `job/<name>` and the harness dir (extract consumes the job).

## 6. Concurrency posture

Spec statement, no new machinery:

- **One loop per working tree.** Singleton ticks, cherry-picks, and
  merge-gate reverts all mutate the working tree's HEAD; two loops in one
  checkout race it. The per-`flumeDir` loop lock guards state roots, not
  working trees — HEAD occupancy is the operator-visible signal.
- **Concurrent jobs = one working tree per job**, by recipe:
  `git worktree add .git/flume-jobs/<name> job/<name>`, then
  `flume job run <name>` from inside it (`.git/` placement is legal;
  probe-verified). Documented in README; no provisioning verb until
  friction proves the need.
- **Cross-job `.git/worktrees` metadata contention is accepted**: races
  fail a git command → a tick, not the repo; entries stay pending and the
  stateless-tick posture self-heals by retry.
- Cross-job `writablePaths` overlap is operator responsibility.

## 7. Tests

All ported behavior is **net-new test surface** — flume-dock has no suite.

- §2: `trunkBranch` gone from `DispatcherOptions` (type-level); ship path
  still lands on the checked-out branch.
- §3: `--job` resolution writes back all three env vars; child ticks
  inherit; explicit-`FLUME_DIR`-plus-`--job` rejected; wrong-branch guard
  refuses `tick`/`loop` off `job/<name>` and passes on it; read-only
  subcommands unaffected.
- §4: with `FLUME_JOB`, worktree branch is `flume/<job>/<slug>`; two state
  roots with identical tags produce disjoint branches; legacy name without
  `FLUME_JOB`.
- §5a: seeded job — baseline commit excludes runtime + junction; ignore
  ensure is idempotent and template-preserving; provisioning resolves
  `@dtmd/flume` from a **no-dep-tree fixture** (chain load succeeds);
  template-less new warns.
- §5b: run wakes `phases[0]` only from hibernation; asserts branch.
- §5c: rm refuses on live pid; removes dir; branch + history survive.
- §5e: extract on a scratch repo — intake-first ordering, non-harness
  selection, clobber refusal, conflict unwind (job intact), harvest output,
  job branch + dir gone.
- §6: covered by documentation + the §5 integration tests running inside a
  linked worktree (recipe viability); no race-injection tests.
- win32 lane (v0.4 §6) covers the junction + longpaths paths.
- **Type-level tests are gate-enforced.** `tsconfig.json` `include` gains
  `tests/**/*` so the tscGate typechecks the suite — a type-level
  assertion (e.g. §2's `trunkBranch` absence) that only binds under LSP is
  not a test. Known cost: one `exactOptionalPropertyTypes` error in
  `tests/Gate.test.ts` (probe 2026-07-23), fixed in the same entry.
  Resolves the parked OQ; option (a) — a second tests-only tsconfig was
  the fallback if the suite had been noisy, and it wasn't.

## 8. Docs

- README: the job flow (`new` → tune → `run` → `rm`/`extract`), the two
  endings, the concurrency recipe, HEAD-is-truth contract.
- CHAIN-AUTHORING / getting-started: template expectations under `job new`
  (what the runtime ignores for you vs what your template must carry),
  `phases[0]`-as-entry convention.

## 9. Non-goals for 0.5.0

- Trunk config seam, in any form — HEAD-is-truth + verb-owned checks only.
- Manifest files, in-repo or external.
- `--branch`/`--from` on `job new` — one shape; other shapes use the raw
  seams (`FLUME_DIR` et al., which remain fully supported, including
  out-of-repo state roots).
- Worktree-placement default change — nested gitignored worktrees are the
  proven dogfood layout; `FLUME_WORKTREES_DIR` remains the escape hatch.
- Multi-job scheduler, cross-job arbitration, worktree-provisioning verb,
  cross-job locking.
- Presets, encoded checks, harness content in machinery.
- Auto-integration of job branches.

## 10. Resolved decisions

1. **Noun is `job`**; dir `.flume/jobs/<name>`, branch `job/<name>`,
   fanout namespace `flume/<job>/…`. ("drive" rejected — disk collision;
   metaphor candidates rejected — don't self-explain.)
2. **`trunkBranch` purged, not exposed** — it was dead code; making it
   real would add a config seam the dogfood case has never needed.
   Reverses the PRD draft's first shape.
3. **One mode, two endings** (rm vs extract) — supersedes the draft's
   "external mode": dock's state dir was always in-repo; the external
   framing was a mischaracterization. Out-of-repo state roots remain a
   seam, not a verb path.
4. **No manifest** — in-repo identity is directory + branch; extract's
   inputs are per-invocation flags (`--onto` required).
5. **Provisioning is unconditional** — version coherence beats
   probe-first branching.
6. **Entry phase is `chain.phases[0]`** — content-free convention; a
   hardcoded phase name in machinery is the cross-contamination class this
   line exists to end.
7. **Cross-job worktree races accepted** — tick-scoped, self-healing;
   a lock is machinery for a failure mode that already converges.
8. **Runtime ignore entries are machinery's to write** — the runtime owns
   its layout; templates own chain conventions. Not a decision-20 breach.
9. **One consolidated 0.5.0 cut** (§11): 0.4.0 was never cut or published,
   so the still-unpublished version is the right home for its surface —
   the v0.3 §6 reasoning, reapplied. Restores the v0.2/v0.3 pattern of the
   spec line anchoring its own cut.

## 11. Versioning — the 0.5.0 cut

One cut closes this line: **0.5.0**, consolidating the uncut v0.4 surface
with the v0.5 surface (0.4.0 never shipped to npm; frozen v0.1 §9 governs —
a public-API break lands as a minor bump with a `### Breaking` block).

Plan derives one CUT entry for build: reconcile `CHANGELOG.md` against the
commits since the `v0.3.1` cut, bump `package.json` to `0.5.0`, commit as
`chore(release): cut 0.5.0`. Block shape:

- **`### Breaking`** — `DispatcherOptions.trunkBranch` removed; HEAD of
  the loop's working tree is the trunk contract (§2).
- **`### Added`** — the `flume job` verb family
  (`new|run|rm|status|extract`, §5); `--job`/`FLUME_JOB` resolution + the
  wrong-branch guard (§3); job-namespaced fanout branches and worktree
  paths (§4); the v0.4 surface: Axis-C terminal misconfiguration (exit
  78), `Phase.agent`, entry-scoped write guard + `entryChannelPaths`,
  win32 support + CI lane, and the PR #5 reconciliation items
  (`FLUME_WORKTREES_DIR`, loop lock, `observedFiles`, `revertedTags`,
  wave auto-unblock).
- Exact wording is build's to derive from the log; the spec fixes the
  version, the block structure, and the breaking entry's presence.

Publishing to npm remains a human act (as 0.3.0/0.3.1 were); the cut
commit is the line's completion marker.
