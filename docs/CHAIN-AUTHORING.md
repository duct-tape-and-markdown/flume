# Authoring a Flume chain

The long-form walkthrough for writing your own `.flume/chain.ts`. Assumes
you have read the README. The running example is
[`examples/cascade-chain.ts`](../examples/cascade-chain.ts) — the
workshop → spec → plan → build pipeline this repo dogfoods. Every section
below quotes a slice; open it in a second pane. For the bare-minimum shape
(no fanout, no spec separation), read
[`examples/minimal-chain.ts`](../examples/minimal-chain.ts) first.

## Where the chain lives

The harness loads `.flume/chain.ts` relative to your repo root. Default-
export a `Chain` value — `cli.ts:loadChain` rejects modules without a
default export. Prompts referenced by `Phase.promptPath` resolve relative
to `.flume/`.

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

| Field | Role |
| ----- | ---- |
| `name` | Stable id. Matches the awake-flag file `.flume/awake/<name>`. |
| `description` | One-line description shown in `flume status`. |
| `promptPath` | Prompt file path, relative to `.flume/`. |
| `concurrency` | `"singleton"` or `"fanout"` — see §3. |
| `writablePaths` | Globs the agent's commit must stay inside. Outside-of-glob writes revert the commit. |
| `gates` | Validation steps the harness runs post-commit. See §2. |
| `promptArgs` | Builds the `{{KEY}}` substitution map. Receives the per-tick `TickContext`. |
| `handoff` | Returns sibling phases to wake based on the tick's `TickResult`. |
| `setupWorktree` | Optional fanout hook to materialize gitignored files (`node_modules`, `.env`) in a fresh worktree. |

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
  message: string;   // one-line verdict for dispatcher + agent
  details?: string;  // captured output, fed into next tick's prompt as context
}
```

`afterCommit` runs on the worktree branch; failure drops the commit and the
entry stays pending. `afterMerge` runs on the trunk after a fanout wave
lands; failure reverts the wave. Singleton phases never run `afterMerge`
(they commit straight to the trunk).

### Use the built-ins first

```ts
import { shellGate, tscGate, vitestGate, eslintGate } from "flume";
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
    if (r.ok) return { ok: true, message: `parsed (${r.entries.length} entries)` };
    return {
      ok: false,
      message: `pending.json has ${r.errors.length} schema violations`,
      details: r.errors.map((e) => `  [${e.index}] ${e.path}: ${e.message}`).join("\n"),
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

## 3. Choosing concurrency

The choice is structural — it follows from what the phase outputs.

### Singleton

Pick `"singleton"` when the phase derives a shared artifact that can't
admit concurrent edits — plan derives the whole `pending.json` from disk;
spec derives a corpus. Two parallel ticks would step on each other.

Singleton phases run in the main repo (not a worktree) and commit directly
to the trunk. Their `afterCommit` gates run on the trunk.

### Fanout

Pick `"fanout"` when each tick is responsible for one independent unit of
work that touches a known file set. Build is canonical: each pending entry
declares the files it will write, and any two entries with disjoint file
sets can run in parallel.

The dispatcher uses `partitionByFileOverlap` to group pickable entries
into maximal disjoint batches, picks the first batch, and spawns one
worktree per entry under `.flume/worktrees/<phase>/<tag>/`. Agent +
`afterCommit` gates run in parallel; the wave then merges into the trunk
in commit order and runs `afterMerge` gates.

```ts
partitionByFileOverlap(entries, { maxParallel: 4 });
// => [[entryA, entryC], [entryB]]   // A and C disjoint; B overlaps both
```

The partition reads `entry.files.new[].path`, `entry.files.edit[].path`,
and `entry.files.retire[]` (see `touchedPaths()` in `PendingSchema.ts`).
If you author pending entries by hand, declare files truthfully.

Failure modes the dispatcher handles: `afterCommit` fail in one worktree
drops that commit (siblings continue); a cherry-pick conflict during merge
leaves the conflicting entry in pending (successful merges remain); an
`afterMerge` fail reverts the whole wave on the trunk.

### `setupWorktree` for fanout

A fresh worktree contains only tracked files. `node_modules/`, `.env`, and
other gitignored artifacts the gates depend on must be materialized before
the agent runs:

```ts
const build: Phase = {
  // ...
  async setupWorktree({ worktreePath, repoRoot }) {
    const { symlink } = await import("node:fs/promises");
    await symlink(`${repoRoot}/node_modules`, `${worktreePath}/node_modules`, "dir");
    await symlink(`${repoRoot}/.env`, `${worktreePath}/.env`);
  },
};
```

Singleton phases run in the main repo, so the hook is never invoked for
them.

## 4. The agent seam

`Agent` is the interface between the dispatcher and an LLM CLI. v0.1 ships
one implementation, `claudeCode()`, plus two decorators.

```ts
import { claudeCode, withSessionCapture, withTerminalRenderer } from "flume";

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
  withSessionCapture(
    claudeCode({ outputFormat: "stream-json" }),
    { dir: ".flume/sessions" },
  ),
);
```

Order matters: capture innermost so the file holds the full NDJSON;
render outermost so the terminal sees the human-readable summary.

### Wiring into the dispatcher

The chain doesn't reference the agent — the dispatcher does. The shipped
`bin/flume` wires the default agent against `.flume/chain.ts`; you only
invoke `Dispatcher` yourself for non-standard hosts (tests, custom CLIs):

```ts
import { Dispatcher, consoleLogger } from "flume";
const dispatcher = new Dispatcher({ chain, agent, log: consoleLogger, repoRoot: process.cwd() });
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
  Use inline-exec for *soft* context (recent commits, current state); use
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

### Dry-run

`flume render <phase>` evaluates the prompt without invoking the agent and
prints it to stdout. For fanout phases, it uses the first pickable entry
as `assignedEntry`.

## Putting it together

```ts
const cascadeChain: Chain = { phases: [plan, build, spec], humanOnly: ["spec"] };
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
