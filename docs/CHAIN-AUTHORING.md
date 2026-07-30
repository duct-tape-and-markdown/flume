# Authoring a Flume chain

The long-form walkthrough for writing your own `.flume/chain.ts`; assumes
you've read the README. The running example,
[`examples/cascade-chain.ts`](../examples/cascade-chain.ts), is the
spec → plan → build pipeline this repo dogfoods — every section quotes a
slice, so open it in a second pane. For the bare-minimum shape (no fanout,
no spec separation), see [`minimal-chain.ts`](../examples/minimal-chain.ts).

## Where the chain lives

The harness re-resolves `.flume/chain.ts` (relative to your repo root) at
the start of every tick — disk is truth, so a tick that rewrites the chain
is governed by the new chain on the next tick. The reload mechanism is a
process boundary: `flume loop` is a supervisor that spawns one `flume tick`
child process per iteration, and each child loads the chain exactly once at
its start. There is no in-process memoization or cache-bust — one
`tsImport` of `chain.ts` per tick, a cost dominated by orders of magnitude
by the tick's own agent invocation. Default-export a `Chain` value — the
resolver rejects modules without a default export. Prompts referenced by
`Phase.promptPath` resolve relative to `.flume/`.

```
.flume/
  chain.ts
  prompts/
    plan.md
    build.md
  plan/
    pending.json
    state.md
    open-questions.md
```

`awake/`, `worktrees/`, `sessions/`, and `inbox.md` are harness-managed
state — you don't author them.

**One chain governs every job, too.** Job resolution (`--job`/`FLUME_JOB`)
retargets only the mutable state root (`.flume` → `.flume/jobs/<name>`) —
never `configDir`. There is no per-job chain resolution: `.flume/chain.ts`
is the chain for every job in the repo, resolved fresh from whichever
branch is checked out. See the README's "Chain residency" section for the
full contract.

### Chain-declared seed and harvest

There is no job-local chain, and no `--template` flag. `.flume/jobs/<name>/`
holds job *state* only — job resolution never retargets `configDir` (see
"Where the chain lives" above), so every job under this repo ticks the one
chain at `.flume/chain.ts`, and that chain is the sole author of what a
fresh job dir contains and what a dying one gives up. Two optional `Chain`
fields carry the declaration:

- **`Chain.seedDir?: string`** — a `configDir`-relative directory (the
  `promptPath` idiom: stubs are real files beside the chain, e.g.
  `.flume/job-seed/`). `flume job new <name>` copies it into the fresh job
  dir verbatim, skip-existing: a re-run fills gaps (a stub added to the
  seed dir reaches jobs already created) and never clobbers a worked file.
  Absent `seedDir` → a bare job, no warning — state accretes from ticks,
  and bare is legitimate. No interpolation and no seed-function form: the
  copy is dumb by design, and `chain.ts` is already code if you need
  logic.
- **`Chain.harvest?: string[]`** — job-dir-relative paths `flume job
  extract` reads off the dying job branch (`git show`, not the working
  tree) and prints to stdout for operator routing, before the job is
  consumed. Absent `harvest` → nothing is harvested. There is no default:
  a default would re-house the exact domain opinion (`friction.md`,
  `open-questions.md`, or whatever your chain cares about) that this field
  exists to evict from the machinery.

`flume job new` loads the repo chain before doing anything else — no chain
at `<configDir>/chain.ts` is a usage error (a job that could never `run`
must not be creatable), and a declared-but-absent `seedDir` is the same
class of error, checked before the state root is touched.

**What the runtime still owns, unconditionally, on every `job new`** — the
line between this and `seedDir` is the same line as "machinery vs.
opinion" everywhere else in this doc:

- Merging the runtime `.gitignore` entries (`awake/`, `prior-attempts/`,
  `worktrees/`, `node_modules/`, `loop.pid`) into the job dir — creating
  the file if `seedDir` carries none, preserving any lines it does.
- Linking `node_modules/@dtmd/flume` inside the job dir to the running
  flume's own package root, so `import … from "@dtmd/flume"` in the chain
  resolves to the exact flume that ticks it — a seed needs no dependency
  manifest.
- Pinning `core.longpaths true` repo-locally on Windows.
- Baseline-committing the seeded harness so subsequent plan/build ticks
  produce clean deltas.

A dir your chain writes that the runtime doesn't know about is still your
declaration to make: `sessions/` is the canonical case (session capture is
the `withSessionCapture` decorator's convention, not the runtime's), so its
ignore line belongs in your `seedDir`, same as it belonged in a `--template`
directory before this line.

**Migrating off a per-job shim chain.** Before this line, a job's state
root carried its own one-line shim chain
(`export { default } from "../../chain.ts"`) purely so job resolution had
something to load from the job dir, plus `import.meta.url`-based path
gymnastics in the repo chain so `promptPath` could still find the shared
`prompts/` dir regardless of which copy loaded. Neither is needed anymore:
job resolution never reads a job-local `chain.ts` at all — it's inert,
unpoliced leftover if one exists — and `promptPath` always joins
`configDir`, which is now always the directory the chain actually lives in.
Delete the shims; delete the gymnastics. Loading the repo chain directly is
behaviorally identical to loading last line's shim, so there's no rush and
no compatibility window to observe.

## 1. Declaring a Phase

A `Phase` is plain data the dispatcher interprets. No per-phase imperative
code path; the harness owns the tick lifecycle and reads the fields you
set. The full interface lives in `src/Phase.ts`. The fields that matter:

| Field           | Role                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | Stable id. Matches the awake-flag file `.flume/awake/<name>`.                                                                     |
| `description`   | One-line description shown in `flume status`.                                                                                     |
| `promptPath`    | Prompt file path, relative to `.flume/`.                                                                                          |
| `concurrency`   | `"singleton"` or `"fanout"` — see §3.                                                                                             |
| `agent`         | Optional per-phase `Agent` override; resolution `phase.agent ?? chainModule.agent ?? dispatcher default`. See §4.                  |
| `writablePaths` | Globs the agent's commit must stay inside. Outside-of-glob writes revert the commit.                                              |
| `gates`         | Validation steps the harness runs post-commit. See §2.                                                                            |
| `promptArgs`    | Builds the `{{KEY}}` substitution map. Receives the per-tick `TickContext`.                                                       |
| `handoff`       | Returns sibling phases to wake based on the tick's `TickResult`.                                                                  |
| `setupWorktree` | Optional fanout hook to provision a fresh worktree's gitignored deps the gates need — runs `pnpm install`, copies `.env`. May return `{ extraEnv }`. See §3. |
| `teardownWorktree` | Optional fanout hook, `setupWorktree`'s cleanup mirror — best-effort, runs before the worktree is removed. See §3. |

The `plan` phase from `examples/cascade-chain.ts`:

```ts
const plan: Phase = {
  name: "plan",
  description: "Re-derive .flume/plan/pending.json + state.md from disk.",
  promptPath: "prompts/plan.md",
  concurrency: "singleton",
  writablePaths: [
    ".flume/plan/pending.json",
    ".flume/plan/state.md",
    ".flume/plan/open-questions.md",
    "specs/_aligned/**",
    "specs/active/**",
  ],
  gates: [pendingParseGate],
  promptArgs() {
    return { PENDING_SCHEMA: renderSchemaForPrompt() };
  },
  handoff(result) {
    const hasPickable = result.pendingAfter.some((e) => e.gate.kind === "open");
    return hasPickable ? ["build"] : [];
  },
};
```

Things to notice:

- **`writablePaths` is a hard boundary.** The harness diffs each commit and
  reverts on out-of-glob paths. This replaces "You may NOT modify X" rules
  in prompts.
- **`handoff` reads the `TickResult`.** Fields: `committed`, `commitSha`,
  `gateResults`, `pendingAfter`, `shippedTags`, `revertedTags` (entries a
  fanout wave reverted at merge — lets a handoff distinguish merge-thrash
  from a clean wave). Return `[]` to leave nobody awake — the system
  hibernates when no flag files are present.
- **`promptArgs` returns strings only.** Pre-stringify JSON yourself.

A fanout phase's `promptArgs` reads the `assignedEntry` for the tick:

```ts
promptArgs(ctx) {
  if (!ctx.assignedEntry) throw new Error("build requires assignedEntry");
  return {
    ENTRY_JSON: JSON.stringify(ctx.assignedEntry, null, 2),
    TAG: ctx.assignedEntry.tag,
    PER_PATH: ctx.assignedEntry.per.path,
    PER_SECTION: ctx.assignedEntry.per.section,
  };
}
```

`TickContext` carries `cwd` (the worktree path), `assignedEntry` (fanout
only), and `pending` (the full list, for singleton phases reasoning about
queue state).

## 2. Writing a custom Gate

A `Gate` is a validation step the harness runs after the agent's commit
lands. The shape:

```ts
interface Gate {
  name: string;
  when: "afterCommit" | "afterMerge";
  run(ctx: GateContext): Promise<GateResult>;
}

interface GateResult {
  ok: boolean;
  message: string; // one-line verdict for dispatcher + agent
  details?: string; // captured output, fed into next tick's prompt as context
}
```

`afterCommit` runs on the worktree branch; failure drops the commit and the
entry stays pending. `afterMerge` runs on the trunk after a fanout wave
lands; failure reverts **only the offending entry's commit** — its clean
siblings stay shipped and that one entry returns to pending. Singleton
phases never run `afterMerge` (they commit straight to the trunk).

### Use the built-ins first

```ts
import { shellGate, tscGate, vitestGate, eslintGate } from "@dtmd/flume";
```

- `tscGate` — `pnpm tsc --noEmit`.
- `vitestGate` — `pnpm test --run`.
- `eslintGate` — `pnpm lint`. Opt-in.
- `writablePathsGate` — attached automatically by the dispatcher from each
  phase's `writablePaths`. Don't list manually.
- `shellGate({ name, when, cmd, args, failHint? })` — escape hatch for "run
  a command, fail on non-zero". The four built-ins above are all
  `shellGate` instances.

### When to write a bespoke Gate

Reach for one when the check needs structured logic (read a file, parse
JSON, summarize N issues) rather than just an exit code. Cascade uses one
to validate `pending.json`:

```ts
const pendingParseGate: Gate = {
  name: "pending.json parses",
  when: "afterCommit",
  async run(ctx) {
    const raw = await readFile(`${ctx.cwd}/.flume/plan/pending.json`, "utf8");
    const r = parsePending(raw);
    if (r.ok)
      return { ok: true, message: `parsed (${r.entries.length} entries)` };
    return {
      ok: false,
      message: `pending.json has ${r.errors.length} schema violations`,
      details: r.errors
        .map((e) => `  [${e.index}] ${e.path}: ${e.message}`)
        .join("\n"),
    };
  },
};
```

The shape to internalize:

- **Idempotent and side-effect-free.** No commits, no pushes. Read state,
  report a verdict.
- **`details` is feedback for the agent.** On failure, `message + details`
  are routed into the next tick's prompt as context. Write `details` for
  the agent to read on retry — concrete file paths and line numbers beat
  narration.
- **Respect `ctx.cwd`.** For fanout phases, gates run inside the per-entry
  worktree, not the main repo. `ctx.commitSha` is set if you need to
  inspect the commit (`git show`, `git diff`).

### Where to place a gate: cheap structural at `afterCommit`, expensive at `afterMerge`

The default: **cheap, deterministic structural gates run at `afterCommit`;
expensive correctness gates run at `afterMerge`.** `tscGate` and a
bundle-self-containment check are structural — fast, deterministic, worth
stopping before a commit ever reaches the trunk. A full test suite is
expensive correctness — and under fanout that cost multiplies.

The split is about contention, not preference. A fanout wave runs N
worktrees in parallel and each runs its `afterCommit` gates at the same
time, so an expensive gate is launched N-wide simultaneously: N full test
suites contending for the same cores. Under that load a suite that passes
comfortably in isolation can blow its own timeout — and a timeout is a
gate failure, so the harness reverts a commit that was never broken.
(Observed: a fanout wave where assertions blew vitest's 5 s timeout purely
under CPU contention, reverting three clean commits.)

`afterMerge` gates do not contend. They run on the trunk one entry at a
time, after the wave has merged — the expensive suite is paid once per
entry serially instead of N-at-once, so it gets the resources it needs and
a timeout means a real hang, not contention noise. And because an
`afterMerge` failure reverts only the offending entry (not the wave), the
cost of moving a flaky-under-load gate there is bounded to the one entry
that actually fails.

The tradeoff to weigh: an `afterMerge` gate runs _after_ the commit
reaches the trunk, so a genuinely bad commit is briefly on the trunk
before it is reverted, whereas an `afterCommit` gate catches it pre-merge.
Keep structural gates at `afterCommit` for exactly that reason — they are
cheap enough to run N-wide and you want type errors stopped before merge.
Split by cost: fast deterministic checks gate the merge; heavy or
timing-sensitive correctness gates gate the trunk.

This is a default, not a law. A small, fast suite can stay at
`afterCommit` — the cascade example keeps `vitestGate` there because its
suite is trivial. Move it to `afterMerge` once the suite is heavy enough
that running it N-wide is itself what makes it flake.

### Don't gate the in-worktree build on host-level integration tests

`vitestGate` runs `pnpm test` (= `vitest run`) **inside the fanout worktree** —
a freshly `pnpm install`'d tree, under full-suite parallel load. That is the
wrong place for tests that spawn real subprocesses (`flume tick`/`loop` via
`tsx`, real `git`) or otherwise need a warm host: their cold start-up costs
multiply under N-wide contention and can blow the suite's timeout, reverting a
commit that was never broken. The failure is an execution-environment artifact,
not a defect in the code under test.

Split the suite into two lanes instead of raising the timeout (a bigger timeout
masks nothing and leaves the worktree-hostility in place):

- **Fast lane** — unit + fast tests; the default `vitest run`. This is exactly
  what the build's `afterMerge` gate invokes, so it stays fast and worktree-safe.
- **Integration lane** — anything needing real subprocesses or a warm host.
  Mark it with the `*.integration.test.ts` filename convention and **exclude it
  from the default run** in `vitest.config.ts`, so the in-worktree gate never
  runs it. It runs at the **host** (main checkout, warm deps, no worktree) via a
  dedicated `pnpm test:integration` — pre-merge / CI, not the autonomous gate.

```ts
// vitest.config.ts — exclude the integration lane from the default (gate) run
import { configDefaults, defineConfig } from "vitest/config";
const integration = process.env.VITEST_LANE === "integration";
export default defineConfig({
  test: {
    include: integration
      ? ["tests/**/*.integration.test.ts"]
      : ["tests/**/*.test.ts"],
    exclude: integration
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
```

Integration coverage is **preserved, relocated** — not dropped. The
process-boundary guarantees still run, at the host where they are fast and
reliable. (A vitest workspace/projects split is an equivalent mechanism; the
boundary is what matters, not the vitest knob.)

### Anti-pattern: gate on the safety property, not on byte-equality of a generated artifact

A gate must assert the property you actually care about — not byte-identity
of a derived artifact against a checked-in copy.

Worked example: `bundleFreshnessGate`. The intent was reasonable — "the
committed bundle is in sync with source." The implementation was not: it
rebuilt the bundle and asserted byte-equality against the checked-in
`dist/`. It reverted a string of clean commits. The cause: pnpm's
virtual-store hashes leaked into esbuild's output, producing ~257
pure-reorder / hash-churn lines that changed the bytes without changing a
single runtime behavior. The property that actually mattered — _the bundle
is self-contained; no import escapes it_ — lived in a different gate,
`bundleSelfContainmentGate`, which inspected that invariant directly and
did not churn.

The lesson generalizes. Generated artifacts carry non-semantic entropy:
content hashes, declaration order, timestamps, embedded toolchain-version
strings. Byte-equality conflates _changed_ with _broke_, so the gate fails
on entropy and reverts work that was correct.

How to apply: before writing a gate over a generated file, ask "what would
a _bad_ version of this file actually do wrong?" and assert exactly that —
does it resolve, does it parse, does it satisfy its contract tests, does
any import escape it. If you cannot name the failure a byte-diff would
catch, the gate is testing your toolchain's determinism, not your code —
don't write it.

## 3. Choosing concurrency

The choice is structural — it follows from what the phase outputs.

### Singleton

Pick `"singleton"` when the phase derives a shared artifact that can't
admit concurrent edits — plan derives the whole `pending.json` from disk;
spec derives a corpus. Two parallel ticks would step on each other.

Singleton phases run in the main repo (not a worktree) and commit directly
to the trunk. Their `afterCommit` gates run on the trunk.

### Fanout

Pick `"fanout"` when each tick owns one independent unit of work over a
known file set. Build is canonical: each pending entry declares the files
it writes, and entries with disjoint sets run in parallel.

The dispatcher uses `partitionByFileOverlap` to group pickable entries
into maximal disjoint batches, picks the first, and spawns one worktree
per entry under `<flumeDir>/worktrees/<entry-slug>/` (base overridable via
`FLUME_WORKTREES_DIR` — see below). Agent + `afterCommit` gates run in
parallel; the wave then merges to trunk and runs `afterMerge`.

```ts
partitionByFileOverlap(entries, { maxParallel: 4 });
// => [[entryA, entryC], [entryB]]   // A and C disjoint; B overlaps both
```

The partition reads `entry.files.new[].path`/`.edit[].path`/`.retire[]`
(see `touchedPaths()` in `PendingSchema.ts`); declare files truthfully
when hand-authoring entries. When a merge-time failure reverts an entry,
the dispatcher persists the attempt's *actual* commit footprint onto it as
`PendingEntry.observedFiles`, and the partition reads that alongside the
declared `files` — so the retry is separated from whatever it collided
with even where the declaration under-stated the reach.

Failure modes handled: an `afterCommit` fail drops that worktree's commit
(siblings continue); a merge cherry-pick conflict leaves that entry in
pending (others merge); an `afterMerge` fail reverts only the offending
entry's commit — the clean siblings stay shipped and that entry returns to
pending. On the success side, ship bookkeeping auto-opens `blockedBy`
gates whose blocker shipped in the same wave, so a chained entry becomes
pickable without waiting for an interim plan tick.

### `setupWorktree` for fanout

A fresh worktree holds only tracked files; provision the gitignored deps
the gates need first. **Default:** the exported `setupWorktree` helper —
sibling to the `builtinGates` precedent (`shellGate`, `tscGate`, …),
re-exported from `flume`'s top level — inspects the worktree for a
lockfile and runs the install it implies: `pnpm-lock.yaml` →
`pnpm install --frozen-lockfile` (pnpm hardlinks from its global store,
so it costs seconds, not a re-download); `package-lock.json` → `npm ci`;
neither → rejects instead of guessing a package manager.

```ts
import { setupWorktree } from "flume";

const chain: Chain = {
  // ...
  build: {
    // ...
    async setupWorktree({ worktreePath }) {
      await setupWorktree(worktreePath);
    },
  },
};
```

Copy plain files (`.env`) directly, alongside the helper call.

**Never symlink `node_modules` in** — pnpm deletes a symlinked
`node_modules` on install
([pnpm/pnpm#9973](https://github.com/pnpm/pnpm/issues/9973)), silently
breaking the worktree the first time a fanout entry installs.

**Experimental opt-in:** `enableGlobalVirtualStore` in `pnpm-workspace.yaml`
([pnpm git-worktrees](https://pnpm.io/git-worktrees)) shares one virtual
store across worktrees, skipping the install — an opt-in only, never a
default. Either way, add a strategy-agnostic `afterCommit` `shellGate`
that fails loud if a sentinel dependency stops resolving from the worktree
root (`node -e "require.resolve('vitest')"`).

Singleton phases run in the main repo, so the hook is never invoked for
them.

### `{ extraEnv }`: per-worktree env for the agent

`setupWorktree` may return a `WorktreeSetupResult` — `{ extraEnv }` — and
the dispatcher layers those vars on top of its own `process.env` for **that
worktree's agent invocation**. This is the seam for an ephemeral resource
handle the chain provisions at setup time: a per-worktree `DATABASE_URL`, a
scratch dir, a short-lived credential — anything the agent needs at runtime
that shouldn't be baked into the worktree's tracked filesystem.

```ts
async setupWorktree({ worktreePath, entryTag }) {
  await setupWorktree(worktreePath);
  const dbUrl = await provisionScratchDb(entryTag);
  return { extraEnv: { DATABASE_URL: dbUrl } };
},
```

Scope notes:

- **Agent only.** `extraEnv` reaches the agent invocation; gates spawn from
  the dispatcher's own env. A gate that needs the handle should read it from
  disk state the setup hook wrote, not expect the var.
- **Fanout only.** Singleton phases never invoke `setupWorktree`, so they
  never carry `extraEnv`.
- **Void returns are fine.** An implementation that only provisions deps and
  returns nothing is unaffected.

### `teardownWorktree`: the cleanup mirror

`teardownWorktree(ctx)` runs after the agent exits and gates finish, just
before the harness removes the worktree. It receives the same
`WorktreeSetupContext` as setup (`worktreePath`, `repoRoot`, `entryTag`) —
use it to release whatever setup acquired: drop the scratch DB, return the
lease, delete the issued credential.

```ts
async teardownWorktree({ entryTag }) {
  await dropScratchDb(entryTag);
},
```

It is **best-effort**: a throw is logged and does not block worktree
removal. Don't put anything correctness-critical here — a crashed tick can
skip it, so acquired resources should also be reclaimable by an external
sweep (a TTL, a startup cleanup pass).

### Where worktrees live: `FLUME_WORKTREES_DIR`

Fanout worktrees are created under `<flumeDir>/worktrees/<entry-slug>/`;
the `FLUME_WORKTREES_DIR` env var overrides that base
(`FLUME_WORKTREES_DIR ?? join(flumeDir, "worktrees")`, resolved against the
cwd when relative).

Reach for the override when worktrees must sit **outside every repo-path
prefix**. The observed failure it exists for: an agent whose cwd contains
the root checkout's path as a prefix (the default
`<repoRoot>/.flume/worktrees/<entry>` does) derives the root from its own
cwd and operates there instead of in its worktree — writes the
writable-paths guard never sees, because they never land in the worktree
being diffed. An out-of-tree base (a sibling tmpdir) removes that vector.
Two chain-author consequences:

- `setupWorktree`/`teardownWorktree` receive absolute `worktreePath`s, so a
  hook that already uses `ctx.worktreePath` (rather than assuming
  `.flume/worktrees/…`) is unaffected by the override.
- Worktrees relocated outside `FLUME_DIR` leave the dock's one-`rm`
  footprint (see the README). They are ephemeral — created and removed per
  wave — but a crashed run can strand one at the override location.

## 4. The agent seam

`Agent` is the interface between the dispatcher and an LLM CLI. v0.1 ships
one implementation, `claudeCode()`, plus two decorators.

```ts
import {
  claudeCode,
  withSessionCapture,
  withTerminalRenderer,
} from "@dtmd/flume";

const agent = claudeCode({
  outputFormat: "stream-json",
  dangerouslySkipPermissions: true,
});
```

### `claudeCode(opts)`

Spawns `claude -p` with the rendered prompt on stdin. Options:

- `binary` — path to the `claude` binary. Default: resolves from PATH.
- `dangerouslySkipPermissions` — passes `--dangerously-skip-permissions`.
  Default `true`: every Flume tick runs in a worktree the harness controls.
- `outputFormat` — `"text"` (default) or `"stream-json"` (adds
  `--output-format stream-json --verbose`). Required for
  `withTerminalRenderer`.
- `extraArgs` — appended after the format flags.

### Decorators

Decorators wrap an `Agent` and return another `Agent`, so they compose.
Innermost = raw provider; outermost = last transform.

- `withSessionCapture(agent, { dir, filename? })` — tees stdout chunks to a
  file as they arrive.
- `withTerminalRenderer(agent, { tag? })` — parses NDJSON stream events
  and emits a one-line-per-tool-call summary. The wrapped agent must emit
  NDJSON (`outputFormat: "stream-json"`). Default `tag` prefixes each line
  with the basename of the invocation's cwd — what fanout worktrees want.

The canonical composition (disk capture + terminal rendering):

```ts
const agent = withTerminalRenderer(
  withSessionCapture(claudeCode({ outputFormat: "stream-json" }), {
    dir: resolve(process.env.FLUME_DIR ?? CHAIN_DIR, "sessions"),
  }),
);
```

Order matters: capture innermost so the file holds the full NDJSON;
render outermost so the terminal sees the human-readable summary.

### Per-phase agents

`Phase.agent` assigns an agent to one phase. Per-tick resolution is

```
phase.agent ?? chainModule.agent ?? DispatcherOptions.agent
```

— the phase's own value, else the chain's `agent` export, else the
dispatcher default. Phases without an `agent` field are unaffected.

The field takes an `Agent` value, not a model string, so it composes with
the decorators above — "same decorator stack, different model" is exactly
what a string cannot express. The canonical use is the architect/editor
split (plan on a stronger model, build on a cheaper one). A model-only
variation is `claudeCode({ extraArgs: ["--model", "…"] })` inside the
phase's agent value; a chain-local helper amortizes re-stating the
decorator stack:

```ts
const SESSIONS = resolve(process.env.FLUME_DIR ?? CHAIN_DIR, "sessions");

function modelAgent(model: string): Agent {
  return withTerminalRenderer(
    withSessionCapture(
      claudeCode({ outputFormat: "stream-json", extraArgs: ["--model", model] }),
      { dir: SESSIONS },
    ),
  );
}

const plan: Phase = { /* … */ agent: modelAgent("claude-opus-4-8") };
const build: Phase = { /* … */ agent: modelAgent("claude-haiku-4-5") };
// Phases with no `agent` field keep the chain/dispatcher default.
```

### Per-run artifacts go under `FLUME_DIR`

Note the `dir` above: it is **`process.env.FLUME_DIR`-relative**, not a fixed
`.flume/sessions`. This is a requirement, not a stylistic choice.

Flume's mutable state — baton, pending, worktrees, prior-attempts — relocates
under one root via the `FLUME_DIR` env var, so the whole footprint can live
outside the repo (a tmpdir) and be torn down in a single `rm` (the
attach-work-detach posture; see the README). That guarantee holds only if
**every** per-run artifact a chain writes also lives under that root. Session
logs are the canonical case: pin them at `configDir` (`CHAIN_DIR`) and a
relocated dock's `rm` leaves them stranded under the config dir whenever
`FLUME_DIR` and `FLUME_CONFIG_DIR` are relocated independently.

The runtime makes this reliable: after resolving the dirs, the CLI canonicalizes
the **absolute** resolved state root back into `process.env.FLUME_DIR`, so a
chain (loaded later in the same process via tsx) reads one authoritative value
rather than re-deriving the default. The `?? CHAIN_DIR` fallback above is
defensive only — in normal operation `FLUME_DIR` is always set. The runtime
supplies the root; **placement is the chain's job.**

**The rule:** if your chain writes any per-run artifact (session captures,
scratch logs, anything mutable that a run produces), root its path at
`process.env.FLUME_DIR`, not at the chain dir or a hardcoded `.flume/`.

The dogfood chain (`.flume/chain.ts`) is the worked example: its session dir is
`resolve(process.env.FLUME_DIR ?? CHAIN_DIR, "sessions")`, exactly the shape
above. `CHAIN_DIR` there is `dirname(fileURLToPath(import.meta.url))`.

#### Gates and prompts get `flumeDir` injected — don't reach into `process.env`

For per-run *artifact placement* (the sessions case above), `process.env.FLUME_DIR`
is the seam, because that placement is decided at chain-load before any tick
context exists. But **inside a gate or a prompt**, the runtime hands you the
resolved root directly, so you never reach into the global env or hardcode
`.flume/`:

- **Gates** receive `ctx.flumeDir` on `GateContext` — the absolute resolved
  state root. A gate that reads pending validates
  `join(ctx.flumeDir, "plan", "pending.json")`. The dogfood `pendingParseGate`
  is the worked example.
- **Prompts** can use the reserved `{{FLUME_DIR}}` placeholder with **no
  `promptArgs` boilerplate** — the dispatcher auto-injects it into every
  prompt's substitution map. Write `{{FLUME_DIR}}/plan/pending.json` (or
  `$FLUME_DIR` inside an inline-exec, which inherits the env). `{{FLUME_DIR}}`
  is reserved and dispatcher-authoritative: a `promptArgs` value of the same
  name cannot shadow it.
- **`promptArgs(ctx)`** also receives `ctx.flumeDir` if you need to derive a
  path programmatically.

`writablePaths` is the one place that stays `process.env.FLUME_DIR`-derived: it
is static config evaluated at chain-load, before any per-tick context exists.

**The boundary:** placement (chain-load, static) → `process.env.FLUME_DIR`;
reading/referencing at tick time (gates, prompts) → `ctx.flumeDir` /
`{{FLUME_DIR}}`. Hardcoding `.flume/` in a gate, prompt, or `writablePaths`
breaks under a relocated `flumeDir` — the dispatcher reads `<flumeDir>/plan/`
while your hardcoded site points at `.flume/plan/`, and the tick's writes land
where the harness isn't looking.

### Wiring into the dispatcher

The chain doesn't reference the agent — the dispatcher does. The shipped
`bin/flume` wires the default agent against `.flume/chain.ts`; you only
invoke `Dispatcher` yourself for non-standard hosts (tests, custom CLIs):

```ts
import { resolve } from "node:path";
import { Dispatcher, consoleLogger } from "@dtmd/flume";

// No prebuilt chain: the dispatcher resolves <configDir>/chain.ts in its
// own process, once at the start of every tick — no in-process memo or
// cache-bust (each `flume tick` is a fresh process).
const dispatcher = new Dispatcher({
  agent,
  log: consoleLogger,
  repoRoot: process.cwd(),
  configDir: resolve(process.cwd(), ".flume"),
});
await dispatcher.tick();
```

## 5. The prompt template format

A prompt file is markdown plus two extensions the renderer applies
per-tick.

### Placeholders: `{{KEY}}`

`{{UPPER_SNAKE_CASE}}` is replaced from the phase's `promptArgs(ctx)`
return value:

```md
<entry>
{{ENTRY_JSON}}
</entry>

The "why" cite: `{{PER_PATH}}` § `{{PER_SECTION}}`.
```

Keys must start with an uppercase letter and contain only `A-Z`, `0-9`,
`_`. If the prompt references a key `promptArgs` doesn't supply,
`renderPrompt` throws — mismatched contracts fail fast.

### Inline-exec: `` !`shell command` ``

Backtick commands prefixed with `!` execute in the tick's `cwd` and are
replaced with stdout (trimmed). The prompt bakes in dynamic context
without round-tripping through `promptArgs`:

```md
<recent-commits>
!`git log -n 5 --oneline`
</recent-commits>

<pending-json>
!`cat .flume/plan/pending.json 2>/dev/null || echo "[]"`
</pending-json>
```

Notes:

- Commands run through `sh -c`, so pipes, redirects, and `||` work.
- All inline-execs run in parallel; don't depend on ordering between them.
- Output is capped at 4 MiB.
- On failure, the placeholder becomes
  `<exec-failed cmd="...">stderr</exec-failed>` — the prompt still sends.
  Use inline-exec for _soft_ context (recent commits, current state); use
  `promptArgs` for required values.

### The `<harness>` block

The renderer prepends a `<harness>` block to every prompt with the phase's
declared capabilities. On an entry-scoped fanout tick (one carrying an
`assignedEntry`), it states the **effective** fence the write guard will
actually enforce — `entry.files ∪ phase.entryChannelPaths` — separately
from `phase.writablePaths`, the outer ceiling both checks must clear
(RELEASE-v0.7 §2):

```text
<harness>
Phase: build
Concurrency: fanout
Effective fence (your commit may touch exactly these; anything else reverts the commit whole):
  - src/Foo.ts
  - tests/Foo.test.ts
Outer ceiling (also enforced, independently of the fence above — a path must clear both):
  - src/**
  - tests/**
Gates (run automatically after your commit):
  - tsc (afterCommit)
  - vitest (afterCommit)
</harness>
```

A singleton tick, or a fanout tick with no `assignedEntry`, gets the
unscoped rendering instead — unchanged from before §2:

```text
<harness>
Phase: build
Concurrency: fanout
Writable paths (anything else you modify will revert the commit):
  - src/**
  - tests/**
Gates (run automatically after your commit):
  - tsc (afterCommit)
  - vitest (afterCommit)
</harness>
```

You don't write this block — the harness injects it. The contract: your
prompt states the task and output shape; the harness states what it will
enforce. Don't reiterate writable paths in your prompt.

### The `<prior-attempt>` block

When a tick commits and a gate reverts it, the next tick scheduled for the
same entry (fanout) or phase (singleton) gets a `<prior-attempt>` block
right after `<harness>`:

```text
<prior-attempt>
A previous attempt at this work committed and was REVERTED by a gate.
Read the failure below and change your approach — do not blindly
reconstruct the reverted change.
Reverted at: afterCommit
Failing gate: tsc
Verdict: tsc failed (3 errors)
Gate details:
  src/Dispatcher.ts(412,7): error TS2322: ...
Reverted change digest (git show --stat):
  build: wire prior-attempt persistence
   src/Dispatcher.ts | 48 ++++++++++++++++--
   1 file changed, 44 insertions(+), 4 deletions(-)
</prior-attempt>
```

Like `<harness>`, this is dispatcher-owned and structural — there is **no
`{{token}}` for it** and you don't reference it in `promptArgs` or the
prompt file. It carries the failing gate's `name`, its full `details` (not
just the one-line `message`), and a bounded `git show --stat` digest of the
reverted commit, so the retry doesn't re-derive the wall it already hit.
It is symmetric across `afterCommit` and `afterMerge`. The carry is
cross-process by construction — the record is persisted under
`.flume/prior-attempts/` (gitignored, beside the baton) and read back by
the next `flume tick`'s fresh process. The block is **absent on a first
attempt** (no false signal) and **cleared once an attempt ships clean**.
Both the gate `message` and `details` feed it — write `details` for the
retrying agent to read (concrete paths and line numbers beat narration).

### Dry-run

`flume render <phase>` evaluates the prompt without invoking the agent and
prints it to stdout. For fanout phases, it uses the first pickable entry
as `assignedEntry`.

## 6. The foundations governor (`forkResolver`)

A `gate: open` entry means "schema-valid, not blocked by a sibling entry." It
does **not** mean "the product/UX decision this work rests on is settled." When
an entry cites a spec section whose decision is still an open question, building
it ships a surface onto an undecided foundation. The foundations governor closes
that gap.

Two pieces wire it up:

1. **Plan declares the dependency.** A pending entry whose work rests on an open
   question carries `dependsOnForks: ["slug", ...]` — opaque slugs your project
   uses to key its open questions. The entry is skipped while any slug is
   unresolved, regardless of gate kind, and picked up automatically once they
   resolve. No new gate state; foundations cross-cut the gate.

2. **The chain supplies a resolver.** `DispatcherOptions.forkResolver` answers,
   per repo, "is this slug resolved?" The runtime is format-agnostic — it never
   reads your open-questions file itself; it calls your predicate. A chain that
   supplies no resolver is unaffected (every fork is treated as resolved).

```ts
// Where you construct the Dispatcher / assemble DispatcherOptions.
forkResolver: (repoRoot: string) => {
  const text = readFileSync(
    join(repoRoot, ".flume/plan/open-questions.md"),
    "utf8",
  );
  return (slug: string) => {
    // Match `(slug` at a boundary — tolerate `(slug)`, `(slug,`, `(slug —…`,
    // but never let a short slug match a longer one (`(foo` ≠ `(foo-bar`).
    const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\(${esc}(?![-A-Za-z0-9])`);
    const line = text.split("\n").find((l) => re.test(l));
    // Fail OPEN: an absent slug (answered and deleted) or a typo must never
    // permanently wedge its dependents — treat it as resolved.
    return !line || /\bRESOLVED\b/.test(line);
  };
};
```

**Fail open, never closed.** The recommended resolver treats an **absent** slug
as resolved (a fork answered and removed should _unblock_ its dependents) and an
**unknown/mistyped** slug as resolved (a bookkeeping error must never block the
loop forever). Every degradation is a _missed block_ — a surface that builds one
tick early — never a stuck loop. The runtime takes no position here; the bias
lives in your resolver.

**What happens when an entry is fork-blocked:** it is simply not selected this
tick. The dispatcher builds a foundation-settled sibling instead
(skip-to-settled); if _every_ `open` entry is fork-blocked, the tick idles with
no commit and the phase advances — a loud, visible signal (in `flume status`)
that the next move needs a human decision, which is strictly safer than shipping
onto sand. A fork-blocked entry is never marked failed and never reverted.

## 7. Capability gating (`requiresCapability`)

A `gate: { kind: "requiresCapability", capability: "docker-host" }` entry is
pickable only when the chain has asserted that capability. Unlike the
foundations governor (§6), which cross-cuts every gate kind, this is a gate
kind itself — mutually exclusive with `open`, `blockedBy`, `parked`,
`deferred`.

Two pieces wire it up:

1. **Plan declares the gate.** An entry whose work needs an environment fact
   the runtime cannot assume — a running daemon, a bound port, a mounted
   volume — carries `gate: { kind: "requiresCapability", capability: "..." }`
   instead of `open`.
2. **The chain asserts what's available.** `Chain.capabilities?: string[]` —
   the environment facts this chain has verified. `chain.ts` is TypeScript,
   so it may probe the environment at load time:

```ts
import { execFileSync } from "node:child_process";

function dockerHostAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const chain: Chain = {
  phases: [plan, build],
  humanOnly: [],
  capabilities: dockerHostAvailable() ? ["docker-host"] : [],
};
```

An entry gated on an unasserted capability is skipped, never silently —
`flume status` names the missing capability so a human sees why the queue is
stuck on it, rather than reading a bare `hibernating`/`awake` line and
guessing.

## 8. Reading tick history: `readTickVerdicts`

Every tick that actually runs a phase writes one **verdict** — a facts-only
record of what happened: phase name, entry tags, committed/no-commit class,
every gate that ran (name, ok/fail, message, and for a failing gate its
`details` — e.g. a writable-paths violation's offending paths), shipped
tags, and (fanout) each provisioned entry's cherry-pick/merge fate. The
engine writes it; nothing in the shape says what the facts *mean* — no
`park`, no `bail worth waking for`. That interpretation is the chain's job.

`readTickVerdicts(flumeDir, n?)` (exported from `flume`, alongside the
`TickVerdict` / `TickVerdictGateResult` / `TickVerdictMergeOutcome` /
`MergeOutcome` types it returns) reads the last `n` verdicts, oldest first,
from the bounded on-disk history log — default `n` is the log's own cap
(200). Absent or corrupt history reads as `[]`, never a thrown error.

A chain that wants a phase's prompt to carry recent tick history renders it
itself, from `promptArgs`:

```ts
import { readTickVerdicts } from "flume";

const plan: Phase = {
  name: "plan",
  // ...
  async promptArgs(ctx) {
    const recent = await readTickVerdicts(ctx.flumeDir, 5);
    const lines = recent.map(
      (v) =>
        `${v.phaseName}: ${v.committed ? "committed" : (v.noCommit ?? "no-op")}` +
        (v.shippedTags.length ? ` (shipped ${v.shippedTags.join(", ")})` : ""),
    );
    return { RECENT_TICKS: lines.join("\n") || "(no prior ticks)" };
  },
};
```

Whether to render history at all, how far back, and what to do with a
reverted tick's `gateResults[].details` (surface it verbatim? summarize it?
ignore it?) are the chain's calls, not the engine's — same split as every
other prompt-args decision (§1).

## 9. Supervisor policy (`supervisorPolicy`)

`flume loop`'s supervisor runs a pre-tick worktree-provisioning safety net
around every fanout wave (§3, "Fanout"): a tagged entry whose worktree fails
to provision is quarantined for the rest of the run so the supervisor stops
re-attempting a wall it already hit, and a consecutive-identical-failure
backstop aborts the run outright when the same signature repeats with no
successful tick in between — the non-entry-scoped class quarantine can't
isolate (e.g. a repo-level `git worktree prune` failure). Both knobs ship as
engine defaults; `Chain.supervisorPolicy` lets a chain choose otherwise:

```ts
const chain: Chain = {
  phases: [plan, build],
  humanOnly: [],
  supervisorPolicy: {
    quarantineScope: "none",
    abortThreshold: 5,
  },
};
```

- **`quarantineScope`** — `"run"` (default): a tagged provisioning failure
  quarantines that entry's slug for the rest of the run — later ticks skip
  it without touching `pending.json`, so a fresh run retries it from
  scratch. `"none"` disables quarantine outright: every entry stays
  pickable every tick regardless of an earlier provisioning failure. The
  consecutive-failure backstop below still applies either way — `"none"`
  only removes the per-entry isolation, not the run-level safety net.
- **`abortThreshold`** — the number of consecutive ticks the same
  provisioning-failure signature must repeat, with no successful tick
  between them, before the supervisor aborts the run rather than burning
  the remaining `--max` ticks against the same wall. Default 3.

Both fields are optional and independent; a chain declaring neither gets the
v0.7 §16 defaults, byte-identical. `flume loop` reads this block from the
resolved chain once at supervisor start — a chain that fails to load there
surfaces nothing new; the defaults apply for that run and the first child
tick still reports the load failure exactly as it does today.
## 10. Declaring an entry extension (`entryExtension`)

The engine's pending-entry schema is deliberately small: `tag` (identity),
`files` (the fence declaration), `gate` + `blockedBy` + `dependsOnForks`
(pickability), and the dispatcher-maintained `observedFiles`. That is
everything the engine mechanically consumes; it validates nothing else and
it renders nothing else. Whatever additional fields your workflow wants on
an entry — a summary, a spec citation, acceptance criteria — are yours to
declare.

Declare each field **once**, with both its zod schema and its prompt hint:

```ts
import { z } from "zod";
import type { EntryExtension } from "@dtmd/flume";

const entryExtension = {
  summary: {
    schema: z.string().min(1).max(200),
    hint: `"one-line what (≤200 chars)"`,
  },
  per: {
    schema: z.strictObject({
      path: z.string().min(1),
      section: z.string().min(1),
    }),
    hint: `{ "path": "specs/.../foo.md (the spec that justifies this work)", "section": "Section heading text" }`,
  },
} satisfies EntryExtension;

const myChain: Chain = {
  phases: [plan, build],
  entryExtension,
};
```

The single declaration drives both enforcement surfaces, so the prompt and
the parser cannot drift:

- **Validation** — the dispatcher composes the core schema with your
  declared fields; `parsePending(raw, entryExtension)` does the same in
  your own gates. The composed schema is strict: a field that is neither
  core nor declared fails loudly. (Silent stripping is how plan-authored
  fields would get destroyed when the dispatcher rewrites `pending.json`
  on ship.)
- **Rendering** — `renderSchemaForPrompt(entryExtension)` renders the core
  shape followed by each declared field as `"<name>": <hint>`, verbatim.
  Pass it through your plan phase's `promptArgs` exactly as before.

To read a declared field with types in your chain code, narrow it through
the same schema you declared:

```ts
const per = entryExtension.per.schema.parse(ctx.assignedEntry.per);
```

A chain that declares no `entryExtension` gets the bare core — entries
carry only the mechanical fields, and anything extra is rejected.

## Putting it together

```ts
const cascadeChain: Chain = {
  phases: [plan, build, spec],
  humanOnly: ["spec"],
};
export default cascadeChain;
```

`phases` is the ordered list, and the order is a contract:
`flume job run` wakes `phases[0]` when the baton is hibernating — the
first phase is the chain's entry point, by position rather than by name
(machinery never hardcodes a phase name). Put the phase a cold start
should begin with first; cascade leads with `plan` because a fresh job
must derive pending before anything can build.

`humanOnly` lists phases the dispatcher
cannot wake via another phase's `handoff` — humans wake them by touching
`.flume/awake/<name>` (or `flume wake <name>`). Cascade marks `spec`
human-only because it derives from human-authored workshop content.

## Where to look next

- [`examples/cascade-chain.ts`](../examples/cascade-chain.ts) — the
  example this walkthrough quotes from.
- [`examples/minimal-chain.ts`](../examples/minimal-chain.ts) — the
  single-phase starter.
- [`docs/INTENT.md`](INTENT.md) — design rationale.
- [`docs/CLI.md`](CLI.md) — every `flume <subcommand>` with exit semantics.
- `src/Phase.ts`, `src/Gate.ts`, `src/Agent.ts`, `src/Prompt.ts`,
  `src/PendingSchema.ts` — JSDoc on these types is the authoritative
  reference once you're past this introduction.
