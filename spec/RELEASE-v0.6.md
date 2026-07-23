# Flume — v0.6.0 Release Target

## 1. Purpose & scope

Make static-`.flume` + thin jobs the native shape. One theme: **a chain is
a repo-resident artifact** — one chain per `.flume`, known by location, with
job dirs holding only job state. Driven by the centercode-platform
static-`.flume` dogfood (inbox 2026-07-23; centercode `pr-571` @
1b1e5aa2cd): under v0.5 every job carries a one-line shim chain
(`export { default } from "../../chain.ts"`), a vestigial job-template to
seed it, and `import.meta.url` gymnastics to locate shared prompts.

Design record: the 2026-07-23 grilling session (inbox entry + this spec's
§9). Net configuration surface of this line is **negative** again:
`--template` deleted, the `HARVEST_PATHS` hardcode deleted, the
template-less warning deleted; added: two optional `Chain` fields. The
machinery exits this line with strictly less domain opinion than v0.5.

## 2. Chain residency — one chain per `.flume`

The invariant: the chain lives at `<configDir>/chain.ts` and **job
resolution never retargets `configDir`**. `--job`/`FLUME_JOB` moves only
`flumeDir` (state root → `.flume/jobs/<name>`); `configDir` stays
`<repoRoot>/.flume` (or explicit `FLUME_CONFIG_DIR`, §3). There is no
job-local chain.

- **Per-job chain variation is already served, twice over**: a job is a
  branch, and `.flume/chain.ts` is a repo file — edit it on `job/<name>`
  and the variation lives and dies with the branch (linked worktrees give
  concurrent divergence; `repoRoot` is `process.cwd()`, so each worktree
  resolves its own checkout's chain). And a chain is code: `FLUME_JOB` is
  env-written-back at CLI entry, before any chain load
  (`src/cli.ts:117` vs `:665`), so one repo chain can dispatch on it.
- **A `chain.ts` inside a job dir is inert, and stays unpoliced.** The
  runtime never looks there; machinery does not police caller-owned
  content (the v0.5 §5 posture, kept honest). No probe, no warning, no
  refusal — the invariant is what resolution *is*, not a rule to enforce.
  Migration is a CHANGELOG line; v0.5 shims re-export the repo chain, so
  loading it directly is behaviorally identical and shims delete at
  leisure.

## 3. Job resolution — the conflict narrows to `FLUME_DIR`

Supersedes v0.5 §3's conflict rule, which conflated two axes under "one
resolution authority." The authority was always over *state*; config never
belonged to the job.

- **`--job` + explicit `FLUME_DIR` remains a usage error (exit 2)** — two
  authorities for one state root.
- **`--job` + explicit `FLUME_CONFIG_DIR` composes**: env owns the
  chain+prompts dir (the dock seam), job owns state. No corruption
  scenario exists — state stays namespaced under the job dir.
- Under job resolution, `configDir` defaults to `<repoRoot>/.flume`. The
  §12 env write-back pattern is unchanged: all three vars canonicalized
  and written back at CLI entry; loop-spawned tick children inherit.
- **`promptPath` mechanics are untouched and the shared-prompts gap
  dissolves by consequence**: `promptPath` joins `configDir`
  (`src/cli.ts:792`, `src/Dispatcher.ts:508,934`), and `configDir` is now
  always the directory the chain actually lives in — a shared chain finds
  its sibling `prompts/` from any job, with no chain-dir token and no
  dynamic path computation.

## 4. Chain-declared seed — `job new` without `--template`

The chain declares what a newborn job contains; machinery materializes the
declaration and holds no content opinion.

- **`Chain.seedDir?: string`** (`src/Phase.ts` `Chain`, beside
  `humanOnly`): a **configDir-relative directory** — the `promptPath`
  idiom; stubs are real files beside the chain (e.g. `.flume/job-seed/`).
- `flume job new <name>`:
  1. Branch from current HEAD as today (§5a-1 unchanged).
  2. **Load the repo chain** (new — the invariant guarantees it exists
     before any job does). No `<configDir>/chain.ts` → usage error
     (exit 2): a job that could never `run` must not be creatable. A
     declared `seedDir` that is absent on disk → same class of error.
  3. Copy `seedDir` into the job dir **verbatim, skip-existing**
     (`cp` with `force: false`): re-run fills gaps — a stub added to the
     seed dir reaches existing jobs — and never clobbers worked files.
     This makes the documented "idempotent on re-run" true for the first
     time. No interpolation; the copy is v0.5's `--template` machinery
     with authority moved from a per-invocation flag to a repo-declared
     fact.
  4. Absent `seedDir` → bare job, **no warning** (state accretes from
     ticks; bare is legitimate).
  5. Runtime ignores, `@dtmd/flume` link, longpaths pin, baseline commit:
     all unchanged (runtime-owned layout is machinery's — v0.5
     decision 8 holds).
- **`--template` is deleted** (pre-1.0 clean slate; no deprecation stub).

## 5. Chain-declared harvest — `job extract`

Same eviction on the consume side: only the chain knows what is worth
saving off a dying branch.

- **`Chain.harvest?: string[]`**: job-dir-relative paths, replacing the
  `HARVEST_PATHS` constant (`src/job.ts:463`, deleted) — which was v0.5
  domain opinion (`friction.md`) leaked into machinery.
- **Absent = harvest nothing.** No default: a default re-houses the
  evicted opinion invisibly, which is worse than the constant it
  replaces.
- Extract loads the chain for the list (new). No ordering hazard: the
  repo chain survives job consumption. Harvest mechanics (git show off
  the job branch tip, stdout for operator routing) unchanged.

## 6. Tests

- §2/§3: under `--job`, `configDir` resolves to `<repoRoot>/.flume` and
  the tick loads the repo chain even when the job dir contains a
  `chain.ts` (inertness, asserted); `--job` + `FLUME_CONFIG_DIR`
  composes (state in job dir, chain from the env dir); `--job` +
  `FLUME_DIR` still exit 2; all three env vars written back.
- §3: `render`/`tick` under a job resolution read prompts from the repo
  `.flume/prompts/` via unchanged `promptPath` joins — the shared-prompt
  integration case.
- §4: `job new` with `seedDir` seeds + baseline-commits the skeleton;
  re-run against a modified job preserves the worked file and fills a
  newly added stub (skip-existing); absent `seedDir` → bare, no warning;
  missing chain → exit 2; declared-but-absent `seedDir` → exit 2;
  `--template` rejected as unknown flag.
- §5: extract harvests exactly the declared list; absent `harvest` →
  empty harvest, extract otherwise unchanged; `HARVEST_PATHS` gone
  (type-level, gate-enforced per v0.5 §7).
- Existing §5a/§5b/§5e suites updated in place for the new resolution
  (pre-1.0 edit-in-place; no compat lanes).

## 7. Docs

- README: chain-residency contract; static-`.flume` + thin jobs as the
  native repo shape; job flow updated (`new` no longer takes
  `--template`); the two endings updated for declared harvest.
- CHAIN-AUTHORING / getting-started: `seedDir` + `harvest` declaration;
  what the runtime still owns (ignores, link, baseline) vs what the
  chain declares; migration note — job-local `chain.ts` is no longer
  read, shims delete, `import.meta.url` prompt gymnastics unnecessary.

## 8. Non-goals for 0.6.0

- Job-local chain override, in any form — the branch mechanism is the
  override.
- Enforcement, warnings, or diagnostics for job-local `chain.ts` —
  evidence-first: reconsider only if dogfood shows real confusion.
- Seed interpolation or a seed-function form — chain.ts is code; add
  only when dogfood demands it.
- A harvest default.
- A repo config file beside `chain.ts` (`flume.json` et al.) — the chain
  is the config.
- A chain-selection surface — one chain dispatching on `FLUME_JOB`
  covers multi-flavor repos.

## 9. Resolved decisions

1. **Invariant over fallback** — chain resolution is a location, not a
   probe order. No job-dir probe, no "which chain ran?" ambiguity, no
   silent-fallback footgun.
2. **Authority split, not authority sharing** — `--job` owns state;
   config never belonged to the job. v0.5's conflict rule conflated the
   axes; narrowing it is the honest reading of "one resolution
   authority."
3. **Zero enforcement of the invariant** — upstream fix instead:
   `--template` (the mass-production vector for job-local chains) dies,
   and inert-by-construction needs no police. An enforcement check with
   a per-verb exemption matrix was rejected as patching a symptom.
4. **Chain-declared, machinery-materialized** — seed and harvest are
   chain declarations. The line between machinery and opinion:
   `plan/pending.json` and the baton are machinery (structured handoff
   is flume's identity); `friction.md` et al. are chain conventions.
   Evicts the v0.5 `HARVEST_PATHS` leak in the same release that could
   have doubled it.
5. **No harvest default** — a default is the evicted opinion, hidden.
6. **Seed copies skip existing files** — the only semantics under which
   "idempotent on re-run" is true; overwrite was a data-loss footgun,
   refuse-when-non-empty broke the documented branch-reuse flow.
7. **`job new` requires the chain** — loading it is the seed's price,
   and a chainless repo cannot run the job it would create.

## 10. Versioning — the 0.6.0 cut

One cut closes this line: **0.6.0** (frozen v0.1 §9 governs — public-API
breaks land as a minor bump with a `### Breaking` block).

Plan derives one CUT entry for build: reconcile `CHANGELOG.md` against the
commits since the 0.5.0 cut, bump `package.json` to `0.6.0`, commit as
`chore(release): cut 0.6.0`. Block shape:

- **`### Breaking`** — job resolution no longer retargets
  `FLUME_CONFIG_DIR` (chains are repo-resident; job-local `chain.ts` is
  not read, §2/§3); `flume job new --template` removed (§4); `extract`
  harvests only chain-declared paths (`HARVEST_PATHS` removed, §5).
- **`### Added`** — `Chain.seedDir` (§4); `Chain.harvest` (§5);
  `--job` composes with explicit `FLUME_CONFIG_DIR` (§3).
- Exact wording is build's to derive from the log; the spec fixes the
  version, the block structure, and the breaking entries' presence.

Publishing to npm remains a human act; the cut commit is the line's
completion marker.
