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
| `writablePaths` | Globs the agent's commit must stay inside. Outside-of-glob writes revert the commit.                                              |
| `gates`         | Validation steps the harness runs post-commit. See §2.                                                                            |
| `promptArgs`    | Builds the `{{KEY}}` substitution map. Receives the per-tick `TickContext`.                                                       |
| `handoff`       | Returns sibling phases to wake based on the tick's `TickResult`.                                                                  |
| `setupWorktree` | Optional fanout hook to provision a fresh worktree's gitignored deps the gates need — runs `pnpm install`, copies `.env`. See §3. |

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
  `gateResults`, `pendingAfter`, `shippedTags`. Return `[]` to leave nobody
  awake — the system hibernates when no flag files are present.
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
per entry under `.flume/worktrees/<phase>/<tag>/`. Agent + `afterCommit`
gates run in parallel; the wave then merges to trunk and runs `afterMerge`.

```ts
partitionByFileOverlap(entries, { maxParallel: 4 });
// => [[entryA, entryC], [entryB]]   // A and C disjoint; B overlaps both
```

The partition reads `entry.files.new[].path`/`.edit[].path`/`.retire[]`
(see `touchedPaths()` in `PendingSchema.ts`); declare files truthfully
when hand-authoring entries.

Failure modes handled: an `afterCommit` fail drops that worktree's commit
(siblings continue); a merge cherry-pick conflict leaves that entry in
pending (others merge); an `afterMerge` fail reverts only the offending
entry's commit — the clean siblings stay shipped and that entry returns to
pending.

### `setupWorktree` for fanout

A fresh worktree holds only tracked files; provision the gitignored deps
the gates need first. **Default:** run `pnpm install --frozen-lockfile` in
the worktree (`promisify(execFile)("pnpm", ["install", "--frozen-lockfile"], { cwd: worktreePath })`);
pnpm hardlinks from its global store, so it costs seconds, not a
re-download. Copy plain files (`.env`) directly.

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
declared capabilities:

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

## Putting it together

```ts
const cascadeChain: Chain = {
  phases: [plan, build, spec],
  humanOnly: ["spec"],
};
export default cascadeChain;
```

`phases` is the ordered list. `humanOnly` lists phases the dispatcher
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
