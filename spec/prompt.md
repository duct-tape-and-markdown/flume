# Prompt rendering

Every tick invokes its agent on exactly one rendered prompt. This file governs how
that prompt is produced: the transformation pipeline in `src/Prompt.ts:renderPrompt`,
the reserved `{{FLUME_DIR}}` substitution, the two dispatcher-owned structural blocks
(`<harness>`, `<prior-attempt>`) the engine prepends, and the inline-exec transport —
including the standing rule that a prompt which cannot be fully rendered never reaches
an agent. Prompt *content* is a chain's business; prompt *assembly and refusal* are the
engine's.

## The render pipeline

`renderPrompt` (`src/Prompt.ts`) reads the prompt file its caller resolved — `configDir`
joined with `phase.promptPath`, passed as `RenderOptions.promptFile` — and applies four
transformations in fixed order:

1. `{{KEY}}` placeholders — matched as `[A-Z][A-Z0-9_]*` only (`PLACEHOLDER_RE`) — are
   substituted from the phase's `promptArgs(ctx)` map, merged with the reserved
   `FLUME_DIR` key.
2. `` !`cmd` `` inline-exec spans are evaluated in the tick's cwd and replaced by the
   command's stdout, trailing whitespace trimmed.
3. The `<prior-attempt>` block is prepended, when the dispatcher hands one in.
4. The `<harness>` block is prepended.

The resulting block order is `<harness>`, then `<prior-attempt>` (if any), then the
task body: what is enforced, then what failed last time, then the work.

Both structural blocks are **dispatcher-owned and structural** — there is no `{{token}}`
for either in the prompt file, and no `promptArgs` key can produce or suppress one. A
chain cannot opt out; a prompt file that never mentions them still gets them.

A placeholder with no matching arg is left verbatim in the text and then
`substitutePlaceholders` throws, naming every missing key. The prompt is never sent with
an unsubstituted *placeholder*.

> **Gap:** the placeholder failure and the inline-exec failure are not classified alike.
> An unresolved span becomes a `render-refused` no-commit outcome with a persisted
> prior-attempt record; a missing arg throws a plain `Error` that the dispatcher
> rethrows (`src/Dispatcher.ts` catches only `InlineExecRenderError`), so it escapes the
> tick uncaught and leaves no record for the retry. The corpus never states the intended
> placeholder-failure semantics.
>
> The same asymmetry runs the other way, outside the grammar: a `{{token}}` that is not
> all-caps (`{{lower}}`, `{{Mixed}}`, `{{1ST}}`) is never a placeholder at all — never
> matched, never counted missing, shipped to the agent verbatim with no error — and a
> `promptArgs` key outside `[A-Z][A-Z0-9_]*` silently has no effect on the prompt.
> Neither side of that pair is loud.

## The reserved `{{FLUME_DIR}}` prompt arg

The dispatcher auto-injects the resolved flume state root into every prompt's
substitution map as `FLUME_DIR`. A prompt writes `{{FLUME_DIR}}/plan/pending.json` with
zero chain boilerplate; a prompt that never references it is unaffected.

`FLUME_DIR` is **reserved and dispatcher-authoritative**: `renderPrompt` merges it after
the chain's `args`, so a chain-supplied key of the same name cannot shadow the resolved
root. The same value reaches gates as `GateContext.flumeDir` and phases as
`TickContext.flumeDir` — one root, four agreeing sites: the dispatcher-resolved root,
`GateContext.flumeDir`, `TickContext.flumeDir`, and the `{{FLUME_DIR}}` token (see
spec/chain.md for
`writablePaths`, which stays derived from `process.env.FLUME_DIR` at chain-load because
it is static config evaluated before any per-tick context exists).

The point of the reserved token is to make state-root awareness a blessed affordance
rather than a reach into global `process.env`, and to remove the footgun where a chain
hardcodes `.flume/` while the dispatcher reads a relocated root.

## The harness block

`prependHarnessBlock` (`src/Prompt.ts`) states, in the engine's own voice, what the
engine will enforce on this tick. It renders the phase name, the phase's `concurrency`,
the write fence, and the gates that run automatically after the commit — each as
`name (when)`, or `(none)`.

**Unscoped ticks** — singleton phases, and fanout ticks with no assigned entry — render
the phase's `writablePaths` under `Writable paths (anything else you modify will revert
the commit)`. That is the whole fence, and it is exactly what the guard enforces.

**Scoped ticks** — a fanout tick carrying an `assignedEntry` — render two fences,
because the write guard enforces two independent checks:

- **Effective fence**: `entry.files ∪ phase.entryChannelPaths`, stated as "your commit
  may touch exactly these; anything else reverts the commit whole".
- **Outer ceiling**: `phase.writablePaths`, stated as also enforced, independently — a
  path must clear both.

When the union is empty the fence renders `(none)` — a fence permitting nothing, which
the guard enforces literally: any path clearing the ceiling still reverts the commit.

The narrowing exists because the guard's revert boundary on a scoped tick is a strict
subset of `writablePaths`, and the engine's one authoritative prompt surface must not
misstate its own enforcement exactly where it is narrowest.

The union is computed once, in `entryWriteScopeUnion` (`src/paths.ts`), and consumed by
both `effectiveFenceLines` (`src/Prompt.ts`, which renders it) and `writablePathsGate`
(`src/builtinGates.ts`, which enforces it). The two can never state a different fence
because there is only one derivation. `tests/Prompt.test.ts` carries the agreement case
— a path the rendered fence names is accepted by the real gate, and a ceiling-only path
the fence omits is rejected by it — driving the real writer's output through the real
consumer rather than a fixture. The unscoped byte shape is separately pinned.

See spec/pending.md for `entry.files` and `phase.entryChannelPaths` themselves.

> **Drift:** `flume render <phase>` resolves an entry into `ctx.assignedEntry` for
> `promptArgs`, but does not pass `assignedEntry` to `renderPrompt` (`src/cli.ts`, the
> `render` subcommand). A fanout phase previewed through `flume render` therefore prints
> the unscoped fence — `writablePaths` — while the real tick prints the narrowed one.
> The preview surface misstates the fence it exists to preview.

## The prior-attempt block

When a previous tick for the same entry (fanout, keyed by tag) or phase (singleton,
keyed by phase name) produced no usable commit, the next tick's prompt carries a
`<prior-attempt>` block immediately after `<harness>`. It is a mode-tagged record —
exactly one variant — rendered distinctly per mode so the retry reads what actually
happened instead of reconstructing a wall that may not exist.

The block's render slot is the prompt-surface half of this contract: the slot is
**absent entirely** on a first attempt (identity transform in
`prependPriorAttemptBlock`), so it never carries a false signal, and it is cleared once
an attempt ships. The carry is cross-process by construction — each tick is a fresh
process with no in-memory handoff, so the record is persisted to disk and read back at
the next render.

What is forwarded is a **bounded digest, not a transcript**: enough that the retry does
not re-derive the same wall, never a session.

The mode union, its persistence, and what each mode means are owned by spec/loop.md; the
render is the only part stated here. `render-refused` — the mode produced by this file's
own refusal — is defined below.

## Inline-exec spans reach `sh` through stdin, never argv

`runInlineExec` (`src/Prompt.ts`) spawns `sh` with **no command arguments** and writes
the span's command text to the child's stdin as UTF-8, then closes it. There is no argv
(`["-c", cmd]`) path.

Declared consequence, because it is a real semantic change rather than an accident:
**`sh` consumes stdin**, so a span whose command itself reads stdin sees EOF rather than
inherited input. No span in this repo's prompts or in either shipped example chain reads
stdin.

Each of the child's output streams is capped at 4 MiB (`INLINE_EXEC_MAX_BUFFER`),
enforced independently on stdout and stderr. `spawn` has no `maxBuffer`, so the cap is
enforced by hand: overrun kills the child and rejects — it never truncates silently.

Spans are matched by `!` — optionally followed by whitespace — then a backtick-delimited
command containing no backtick (`INLINE_EXEC_RE`); the captured text is trimmed before
execution. All spans in one prompt are evaluated in parallel. Replacement walks the
original string by computed offset, so two spans with identical text cannot alias.

## An unresolved inline-exec span fails the tick

A span that cannot be resolved — non-zero exit, spawn failure, `sh` not found, cap
overrun — **aborts the render**. The agent is not invoked. `InlineExecRenderError` names
every failing span's command text and its stderr, in its `message` as well as its
`failures` array, so a caller that only logs the message still surfaces the full picture.

There is no substituted marker (see "Why: the measured transport facts").

A tick that aborts at render classifies as the `render-refused` no-commit mode — a
member of the existing `NoCommitMode` union, not a parallel channel — so a chain's
`handoff` can tell "could not see" from "chose not to act". The dispatcher persists the
failing spans as a `render-refused` prior-attempt record at both the singleton and the
fanout callsite, so the retry's prompt says the prompt itself is broken rather than
implying the work was.

**Exit status decides, never output length.** An empty-but-successful command (`git diff`
with no changes) renders as the empty string and is not a failure.

## No cmd.exe on the inline-exec path

`execGate` (`src/builtinGates.ts`, module-private) retries through `shell: true` on a
win32 ENOENT. That is correct for gate binaries, where package-manager `.cmd` shims
cannot be spawned directly and the arguments are chain-authored flags.

It is wrong for shell script. `src/Prompt.ts` therefore does not share it — it spawns
`sh` directly and a missing `sh` is a render failure, not a fallback. Sharing one helper
across two use cases with opposite interpreter needs is the defect; the helper stays for
gates, unchanged.

No inline-exec path can reach cmd.exe.

## Why: the measured transport facts

The governing rule: **a tick never runs on a prompt it could not fully render.** Prompt
rendering either produces the digest the chain declared, or it fails loudly before the
agent is invoked. No substituted marker, no empty string standing in for output that
never came, no fallback to a shell that cannot parse the language the command is written
in.

The cost of the alternative was measured: a prompt missing its digest blocks still reads
as well-formed, so win32 plan ticks oriented on blinded digests for the life of a loop,
invisibly. The only defence that had ever worked was a prose convention telling the agent
not to trust a block — narration holding a property no mechanism held.

The transport choice is settled by measurement, not argument (win32 + MSYS2 `sh.exe`):

- `execFile("sh", ["-c", cmd])` fails for **any non-ASCII byte anywhere in `cmd`** —
  bare, single-quoted, and double-quoted spans fail identically, and `é` fails as readily
  as `—`. Quoting is not implicated.
- The corruption is **not** byte encoding alone: under `LC_ALL=C.UTF-8` the bytes arrive
  intact and the command still fails. The damage happens inside MSYS2's re-parsing of the
  Windows command line, which Node cannot influence from the spawn side.
- `windowsVerbatimArguments` and `shell: true` both exit **0 with empty stdout** — the
  silent-wrong-answer mode, worse than a marker because nothing marks it at all.
- Passing the command via **stdin** or via a **temp script file** both return the exact
  expected output, non-ASCII intact.

Rejected, and why, so they are not re-proposed:

- **Locale or argv-encoding fixes** — measured non-viable above; the failure is in MSYS2's
  re-parse, not in the bytes.
- **Temp-script transport** — verified working, not chosen: it buys stdin passthrough that
  nothing needs, at the cost of temp-file lifecycle and cleanup-on-crash.
- **A per-span tolerance knob** (an optional-span syntax, or a chain-declared tolerated
  list) — every span in this repo's prompts and both example chains is a digest whose
  failure means a blind tick; none wants tolerance. Additive if a real tolerance case
  appears, speculative before then.

Under the engine/implementation boundary this is engine business: an implementation
cannot choose its own prompt-render transport, and the engine reports the fact (a span
did not resolve) that a chain would otherwise have to infer from prompt text.

The transport is pinned by the U+2014 repro in `tests/Prompt.test.ts` and its
ASCII-hyphen twin — a non-ASCII case that passes on POSIX regardless pins nothing.
