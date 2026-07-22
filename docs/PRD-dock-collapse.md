# PRD — Collapse flume-dock into flume

Status: **draft for review** (uncommitted). On acceptance, the normative
content ingests into `spec/RELEASE-v0.5.md`; this document is the design
record. Decisions were pressure-tested in an adversarial source review and a
follow-up grill; §7 records the outcomes and their reversals.

## 1. Problem

The dock capability lives as a wrapper repo (`flume-dock`) around seams flume
half-has:

- **Trunk checkout dance** (`dock.ts`): `DispatcherOptions.trunkBranch` is
  dead code — stored, lazily defaulted, never consumed. The runtime's actual
  trunk mechanism is HEAD of the working tree the loop runs in
  (`Dispatcher.ts` ship path + singleton cwd), so dock forces the answer by
  checking out `dock/<effort>` before every run. That was never a workaround
  for a missing config seam; it is the only mechanism that exists.
- **`provisionFlume` linking** (`util.ts`): a target without `@dtmd/flume`
  in its dep tree can't resolve the template chain's imports, so dock
  junctions its own install into the harness dir.
- **`run.ts` argv gymnastics**: resolves flume's real `dist/cli.js` through
  pnpm symlinks and spawns plain node, because `flume loop` re-execs
  `process.argv[1]` per tick and the bin shim breaks the main-module guard.
- **Exclude machinery + manifest**: `.git/info/exclude` mutation and
  `dock.json` exist to manage a harness dir treated as foreign.

The premise being dropped: *the harness is foreign to the target repo*.
Dock's own state dir already lives inside the target (`.flume-dock/`,
tracked on the throwaway branch, runtime subdirs excluded) — the foreignness
was dirname-deep. Flume's own repo has run the fully-native version since
day one: `chain.ts`, `prompts/`, `plan/` tracked; runtime dirs gitignored.
Machinery is source-controlled; ephemeral artifacts are subject to cleanup.
Generalizing that layout to N named jobs dissolves the wrapper.

## 2. Unifying principle

**A job is a branch plus a state root, both named by convention:**
`.flume/jobs/<name>/` (tracked, runtime subdirs ignored) on branch
`job/<name>`. The v0.3 relocation seams (`FLUME_DIR`/`FLUME_CONFIG_DIR`)
make the state root a parameter; the job verbs are thin sugar over them.

**HEAD-is-truth is the documented trunk contract.** Commits land on whatever
branch the loop's working tree has checked out — this is how flume-on-flume
has always shipped to `main`. The verbs own checkout; the runtime never
switches branches.

**One kind of job, two endings:**

- **`job rm`** — cleanup commit removes the harness dir; the job branch
  integrates by merge/squash (squash makes harness commits vanish from the
  target history).
- **`job extract`** — cherry-pick the non-harness commits onto a fresh
  branch off a stated base; for deliverables where harness commits must
  never appear and squash isn't available (client repos). This is dock's
  undock, kept because it covers what `rm`+squash can't.

No manifest anywhere: in-repo identity is the directory + branch (git is the
record), and extract's inputs are explicit flags at the point of use.

## 3. Arms

### Arm A — Runtime core (flume)

Net-negative on config surface: one option deleted, one env var added.

1. **Purge dead `trunkBranch`.** Delete `DispatcherOptions.trunkBranch` and
   its lazy default (`Dispatcher.ts:373,385,456-457`) — nothing consumes it.
   Document HEAD-is-truth as the contract in its place.
2. **Job resolution sugar.** `flume --job <name> <cmd>` ≡
   `FLUME_DIR=FLUME_CONFIG_DIR=<repoRoot>/.flume/jobs/<name>` plus
   `FLUME_JOB=<name>`, all canonicalized and written back into env at CLI
   entry (the existing §12 pattern — loop-spawned tick children inherit env,
   not flags). `FLUME_JOB` alone is also honored directly.
3. **Job-scoped fanout branches.** With `FLUME_JOB` set, worktree branches
   become `flume/<job>/<slug>` (today: repo-global `flume/<slug>`, created
   `-B`/deleted `-D` — two jobs sharing a tag slug silently clobber each
   other). Without `FLUME_JOB`, the legacy name stands.
4. **Wrong-branch guard on mutating sugar.** `--job X tick|loop` assert
   `HEAD == job/X` and refuse loudly otherwise (the verb-owned convention
   check — cheap because the branch is knowable by convention). Read-only
   subcommands (`status`, `render`) skip the check.
5. **Concurrency posture (spec statement, no machinery).** One loop per
   working tree; concurrent jobs = one working tree per job via the recipe
   `git worktree add .git/flume-jobs/<name> job/<name>` + `flume job run`
   inside it (probe-verified `.git/` placement is legal). Cross-job races on
   `.git/worktrees` metadata are accepted: they fail a tick, not the repo,
   and stateless ticks self-heal by retry. Cross-job `writablePaths`
   overlap is operator responsibility.

### Arm B — Lifecycle verbs (flume CLI)

`flume job new|run|rm|status|extract`. Folds `dock.ts`/`run.ts`/`undock.ts`;
retires the wrapper repo.

1. **`flume job new <name> [--template <dir>]`** — from current HEAD:
   `checkout -b job/<name>`; seed `.flume/jobs/<name>/` from the template
   (verbatim copy, optional — absent, the dir starts empty with a warning;
   decision 20 holds, no presets or encoded checks); ensure runtime ignore
   entries in the job dir's `.gitignore` (`awake/`, `prior-attempts/`,
   `worktrees/`, `node_modules/`, `loop.pid` — runtime-owned layout, so
   machinery may write it; chain-convention dirs like `sessions/` are the
   template's to add); always junction `node_modules/@dtmd/flume` to
   flume's own install (`resolve(HERE,"..")` — version coherence: the chain
   resolves the exact flume that ticks it, even if the repo declares
   another); pin `core.longpaths` on win32; baseline-commit the seeded
   harness; stay on the job branch. No `--branch`, no `--from`.
2. **`flume job run <name> [--max N]`** — assert-or-checkout `job/<name>`,
   wake `chain.phases[0]` iff the baton is hibernating (content-free entry
   convention — no hardcoded phase names), then the standard loop (lock,
   supervisor, exit codes unchanged). The wrapper's process gymnastics
   dissolve; what remains is checkout + wake + loop.
3. **`flume job rm <name>`** — refuse if the job's `loop.pid` is alive;
   `git rm -r` the job dir + cleanup commit on the job branch; remove
   untracked runtime; `git worktree prune`. The branch survives for
   review/integration — deleting it is the operator's act.
4. **`flume job status`** — enumerate `.flume/jobs/*`: awake phases +
   pending count each (per-job `Baton` reads; observational).
5. **`flume job extract <name> --onto <base> [--intake <path>]...`** —
   ported undock semantics, manifest-free: fork `<name>` off `--onto`;
   intake pass-through first (declared per-invocation), then cherry-pick
   the commits touching paths outside the job dir; refuse to clobber an
   existing branch; unwind on conflict; harvest friction/open-questions to
   stdout; delete the job branch and the harness dir. `--onto` is required
   — extraction is consequential, the base is stated, not guessed.

### Arm C — Spec ingestion (RELEASE-v0.5.md)

Arms A–B become the v0.5 line in corpus style: purpose/scope, per-seam
surface sections, non-goals, resolved decisions. Tests are **net-new** for
everything ported from flume-dock (it has no test suite — extraction
ordering, intake pass-through, and ignore-ensure were only ever verified
in-situ): unit seams for `--job` resolution + wrong-branch guard + branch
namespacing; integration for new→run(tick)→rm and new→run→extract on
scratch repos; a no-dep-tree fixture proving provisioning; win32 lane
coverage. Plan/build ship it autonomously as usual.

### Arm D — Content layer adaptation (flume-template, private)

- `template/` gains a `.gitignore` adding chain-convention ignores
  (`sessions/`) atop the runtime set `job new` guarantees.
- GUIDE.md rewrites to the verbs: `job new` → tune the four knobs →
  `job run` → `job rm` (or `extract` for clean-history targets), plus the
  concurrency recipe.
- `~/.claude/skills/dock-effort` rewrites accordingly (rename to `run-job`);
  hygiene rules (no upstream domain flow, tune-before-run, personal email)
  carry over unchanged.

### Arm E — flume-dock disposition

- Frozen and archived (private) once the verbs land. No compat shim
  (pre-1.0 clean-slate).
- The local-only `interim/centercode` branch stays local-only; archiving
  changes nothing about its visibility.
- Zero new runtime deps in flume from the fold.

## 4. Non-goals

- No presets, encoded checks, or harness content in machinery (decision 20).
- No trunk config seam, no manifest, no `--branch`/`--from` on `job new` —
  convention over recorded state, per the simplicity lens.
- No worktree-placement default change: tracked-flumeDir with nested
  gitignored worktrees is the proven dogfood layout; `FLUME_WORKTREES_DIR`
  remains the escape hatch.
- No multi-job scheduler, no cross-job arbitration, no worktree-provisioning
  verb — concurrency is a documented recipe until friction proves more.
- No auto-integration of job branches.

## 5. Risks

- **Wrong-branch commits** — mitigated by the Arm A guard on mutating
  `--job` subcommands; bare `flume loop` retains HEAD-is-truth as today.
- **Cross-job `.git/worktrees` contention** — accepted: failures are
  tick-scoped and self-heal by retry (stateless-tick posture).
- **Bare-target import resolution** — covered by unconditional provisioning;
  proven by the no-dep-tree test fixture. Template chains import only
  `@dtmd/flume` (verified), so the single junction suffices.
- **MAX_PATH on win32** — `core.longpaths` pinned at `job new` (dock's
  observed failure + fix, ported).

## 6. Resolved decisions

- **D1 — noun `job`**: `flume job new|run|rm|status|extract`,
  `flume --job <name>`, `FLUME_JOB`, `.flume/jobs/<name>/`, branch
  `job/<name>`. ("drive" rejected: disk-drive collision; metaphor
  candidates rejected: don't self-explain.)
- **D2 — one mode, two endings**: rm (merge/squash) and extract (clean
  history). Supersedes "external mode folds into v0.5" — dock's state dir
  was already in-repo; the external framing was a mischaracterization.
  `FLUME_DIR` outside the repo remains a supported seam, not a verb path.
- **D3 — branch is always `job/<name>` from current HEAD**; no override.
- **D4 — cleanup is a verb** (`job rm`), with live-loop refusal.

## 7. Adversarial-review outcomes (design record)

- `trunkBranch` found dead → **purged**, not exposed (reverses the draft's
  Arm A item 1). HEAD-is-truth documented; verbs own checkout; convention
  guard on mutating sugar.
- "N independent loops" unsafe in one working tree (shared-HEAD races,
  merge-gate `reset --hard` blast radius) → concurrency = one working tree
  per job, shipped as a recipe.
- Fanout branch namespace repo-global → job-scoped via `FLUME_JOB`.
- Cross-job worktree-metadata races → accepted as self-healing tick
  failures; no lock.
- "Repo deps serve on Node targets" wrong (resolution requires the repo to
  *declare* `@dtmd/flume`) → unconditional provisioning.
- "Port flume-dock tests" impossible (none exist) → net-new test surface.
- `.git/flume-worktrees` placement empirically legal (scratch-repo probe) —
  used by the concurrency recipe as `.git/flume-jobs/`.
- Worktree-relocation default change dropped: the "hazard" is the working
  dogfood status quo.
