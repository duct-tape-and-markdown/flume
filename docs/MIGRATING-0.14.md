# Migrating to 0.14.0

> **Dated record.** Describes the `0.13.0` → `0.14.0` upgrade as it stood at
> the cut, not flume as it ships now.

**This note covers `0.13.0` → `0.14.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.13.md`](MIGRATING-0.13.md) (`0.12.0` →
`0.13.0`); before it, [`MIGRATING-0.12.md`](MIGRATING-0.12.md) (`0.11.0` →
`0.12.0`), [`MIGRATING-0.11.md`](MIGRATING-0.11.md) (`0.10.x` → `0.11.0`) and
[`MIGRATING-0.10.md`](MIGRATING-0.10.md), which routes any pin on `0.2.x`,
`0.6.x`, or `0.9.0`. If your pin is below `0.13.0`, work those first and
return here — `0.13`'s § 1 is a `pending.json` rewrite the first tick after
the bump refuses without, and nothing on this page substitutes for it.

It does not cover what comes after either: `0.15.0` ships breaking changes
with no note of its own, and [`MIGRATING-0.16.md`](MIGRATING-0.16.md) picks
the series back up at `0.15.0` → `0.16.0`. Jumping past `0.14` means reading
`0.15.0`'s `### Breaking` section in [`../CHANGELOG.md`](../CHANGELOG.md) as
well.

From **0.13.0**: **one** breaking change, and it is a single option passed to
a single gate. Everything else 0.14 ships is additive — § 2 is the roots and
verdicts the engine now hands the chain, each one a block you can delete
rather than a change you owe it, and § 3 is what moved under an operator with
no chain edit at all.

Note that **a caret range on a `0.x` version pins the minor** — `^0.13.0`
resolves within `0.13.x` and will never pick up `0.14.0` on its own. Change
the pin explicitly.

## Which sections apply to you

```sh
grep -n 'pendingPath' .flume/chain.ts                             # § 1 — the one break
grep -n 'pending.json' .flume/chain.ts                            # § 1.4 — a gate opening the queue
grep -n 'FLUME_DIR\|import.meta.url\|__dirname' .flume/chain.ts   # § 2.1
grep -n 'isPickableNow\|gate.kind' .flume/chain.ts                # § 2.2, § 2.3
grep -n 'prior-attempts\|readdir' .flume/chain.ts                 # § 2.4
grep -n 'shippedTags\|revertedTags' .flume/chain.ts               # § 2.5
grep -n 'extraArgs' .flume/chain.ts                               # § 2.6
```

A hit on the first two is work you must do before the gate judges the right
file. Every other hit is code 0.14 lets you delete.

## 1. `PendingGateOptions.pendingPath` is `Chain.pendingPath`

**Affects** any chain that passed `pendingPath` to `pendingGate` — and most
sharply, any chain that used it to *relocate* the queue away from
`plan/pending.json`.

### Before and after

```ts
// 0.13 — the path is an argument to one gate
export default (api: FlumeApi): ChainModule => ({
  chain: {
    phases: [
      plan(
        api.pendingGate({
          pendingPath: "queue/entries.json",
          targetFence: build,
          extension,
        }),
      ),
    ],
  },
});
```

```ts
// 0.14 — the path is declared once, on the chain
export default (api: FlumeApi): ChainModule => ({
  chain: {
    pendingPath: "queue/entries.json",
    phases: [plan(api.pendingGate({ targetFence: build, extension }))],
  },
});
```

A chain that passed the default explicitly drops the option and declares
nothing: undeclared still resolves to `plan/pending.json`, which stays the
one default the engine keeps, because its own mechanics — fanout selection
and the wave-end queue rewrite — cannot run without a queue.

### Why it moved

On 0.13 the option could only move the reader it was attached to. The
dispatcher resolved `join(flumeDir, "plan", "pending.json")` with no
declaration to consult, and `flume status`, `flume check` and `flume job
status` did the same. So `pendingGate({ pendingPath: "queue/entries.json" })`
did not relocate the queue at all — it pointed the gate at a file nothing
else read, and the gate then passed every commit on the strength of a queue
it had never opened while the dispatcher dispatched from a different one.
One value, declared once and resolved by every reader, is the only shape in
which the gate and the dispatcher cannot disagree.

### The declaration is checked at load

`Chain.pendingPath` takes the same refusal `Chain.friction` already had:
state-root-relative, and it must resolve inside the state root. An absolute
path or one that escapes throws out of the chain load, before any tick runs:

```
chain declares pendingPath '/srv/queue.json' as an absolute path;
Chain.pendingPath must be a state-root-relative file path (e.g. "plan/pending.json")
```

### What skipping this looks like

- **TypeScript embedders** get a compile error at the `pendingGate` call —
  `pendingPath` is an excess property on the options literal. The typecheck
  finds these for you.
- **Plain JS**, or an options object assembled by spread, does not: the key
  is accepted and ignored. A chain that had *relocated* the queue through it
  then finds the gate reading the chain-resolved path instead — which is the
  file the dispatcher was dispatching from all along. The symptom reads
  backwards: the gate starts failing entries it used to pass, because it is
  finally judging the queue the commit actually changed. Declare
  `pendingPath` on the chain and both ends resolve the same file.

### 1.4 A chain-authored gate that opens the queue itself

`GateContext.pendingPath` carries that one resolved value, absolute, under
`ctx.flumeDir`. A gate that spelled the path itself takes it from the context
instead — a hand-spelled literal is the same disagreement the break above
closes, one layer down, and it goes stale the moment the chain declares a
queue somewhere else.

```ts
// 0.13 — the literal, twice: once here and once wherever the chain declared it
const rel = join(ctx.stateRootRel, "plan", "pending.json");
```

```ts
// 0.14 — the resolved value, expressed relative to the state root
const rel = join(ctx.stateRootRel, relative(ctx.flumeDir, ctx.pendingPath));
```

Two things the builtin does that a hand-rolled gate should copy. Read the
queue **at the gated sha** — `git show <ctx.commitSha>:<rel>` from
`ctx.repoRoot` — never off disk: disk is the primary checkout's copy, which
under `afterCommit` is the queue before the commit under judgment. And key
that read by `ctx.stateRootRel`, never by rebasing `ctx.flumeDir` onto
`ctx.repoRoot`: `flumeDir` is the primary checkout's state root and is never
nested under the worktree, so the rebase climbs out of it and misreads every
ordinary tick as relocated. `ctx.stateRootRel` being `undefined` *is* the
relocated case — no shared tracked history to read the gated copy from — and
there the disk read at `ctx.pendingPath` is the honest answer.

## 2. Nothing else is breaking — what 0.14 lets you delete

Every item below is additive. None is required to take the bump; each retires
a block consumer chains were carrying by hand, and the engine now reports the
fact instead (`spec/chain.md`, *What a hook receives*; `spec/loop.md`, *The
tick verdict*).

**2.1 A chain finding its own state root.** Every chain surveyed this cycle
opened with the same two lines: an env read for `FLUME_DIR`, and a fallback
to the directory `chain.ts` itself sits in. Both are guesses at a value the
dispatcher had already resolved — and the fallback is wrong under `--job`,
which moves the state root and leaves `chain.ts` where it was.

```ts
// 0.13 — the chain re-resolves roots the dispatcher already has
const CHAIN_DIR = dirname(fileURLToPath(import.meta.url));
const flumeDir = process.env.FLUME_DIR ?? CHAIN_DIR;
const runLog = join(flumeDir, "run-log.jsonl");
```

```ts
// 0.14 — the factory is handed them
export default (api: FlumeApi): ChainModule => {
  const runLog = join(api.paths.flumeDir, "run-log.jsonl");
  // api.paths.repoRoot — the checkout the run was invoked from
  // api.paths.configDir — where chain.ts and its prompts live, never moved by a job
  ...
};
```

`api.paths` holds the identity-same values the dispatcher was constructed
with, required at construction, so there is no fallback leg left in which to
encode a wrong answer. `process.env.FLUME_DIR` stays what it always was — the
channel spawned agents and gates inherit — and is not a read path for chain
code.

**2.2 A `shouldRun` rebuilding the pickability verdict.** `TickContext.pickable`
is the entry set the dispatcher would select right now: the strict-read queue
with `blockedBy` resolved, every declared fork run through the chain's
`forkResolver`, `requiresCapability` checked against `Chain.capabilities`, and
this run's quarantine drop applied — the same computation fanout selection
uses, now run for singleton ticks too.

```ts
// 0.13 — two inputs missing, and a different verdict for it
shouldRun: (ctx) =>
  (ctx.pending ?? []).some((e) => isPickableNow(e, new Set())),
```

```ts
// 0.14
shouldRun: (ctx) => (ctx.pickable ?? []).length > 0,
```

A default `isForkResolved` answers "resolved" for forks the chain would have
refused, and a default empty capability set answers "unasserted" for
capabilities the chain declares — so the hand-rolled call and the next fanout
tick disagreed in both directions at once.

**2.3 A `handoff` re-deriving the same verdict after the tick.**
`TickResult.pickableAfter` is `pendingAfter` under that same filter, taken at
the same post-tick re-read.

```ts
// 0.13
handoff: (r) => (r.pendingAfter.some((e) => e.gate.kind === "open") ? ["build"] : []),
```

```ts
// 0.14
handoff: (r) => (r.pickableAfter.length > 0 ? ["build"] : []),
```

`pendingAfter` is unchanged and stays the queue exactly as it is on disk;
`pickableAfter` is the verdict over it.

**2.4 A hook scanning `prior-attempts/` by hand.** `TickContext.priorAttempts`
is every persisted record, keyed exactly as the files are — the entry tag slug
for a fanout record, the phase name for a singleton one — read with the
dispatcher's own reader and its own tolerance: a corrupt or unrecognized-mode
record is absent from the map rather than surfaced malformed. `PriorAttempt`
is exported, so a chain can name the map's value type. A `shouldRun` asking
"does a sibling phase have a standing bail to reconcile" reads the map; the
directory helpers (`priorAttemptsDir`, `priorAttemptPath`, `slugify`, shipped
in 0.13) remain for a chain that wants the paths themselves.

**2.5 A fanout `handoff` reading a bail out of the wave summary.**
`TickResult.entries` carries one `{ tag, committed, shipped, reverted,
declined?, noCommit? }` record per provisioned entry, reported before the wave
folds them into `shippedTags` / `revertedTags` / `noCommit` / `declined`. The
fold loses a sibling's bail the moment another entry ships — a wave of four
where one hits a wall and three land reports as a committed wave and nothing
else. `entries` keeps that entry's `noCommit` legible. Absent on a singleton
tick and on a wave that provisioned nothing. `TickResult.flumeDir` and
`TickResult.configDir` carry the resolved roots, so a `handoff` placing an
artifact needs no closure over § 2.1.

**2.6 A `--model` flag threaded through `extraArgs`.**

```ts
// 0.13
api.claudeCode({ extraArgs: ["--model", "opus"] })
```

```ts
// 0.14
api.claudeCode({ model: "opus" })
```

Undeclared, the flag is omitted and the binary's own default applies — no
engine default stands between you and it.

## 3. Operators

- **An `afterMerge` revert no longer rewinds over a foreign commit.** A gate
  can run long enough for someone to commit to trunk behind it; the revert
  reset the checkout to the pre-cherry-pick tip regardless, taking that commit
  with the entry's. The tip is now compared to the merged sha immediately
  before the reset, and a mismatch skips it: the entry's commit **stays on
  trunk**, the entry stays pending, and the verdict records
  `afterMerge-revert-refused` with both shas named in the warning. That is a
  commit on trunk whose `afterMerge` gate failed — yours to revert by hand,
  and the case where the operator, not the harness, is the safe actor.
- **A gate-revert digest keeps both ends.** The `<prior-attempt>` block
  carried the last 8 KB of a gate's output, which for vitest is per-test pass
  lines and the closing counts with the `Failed Tests` section elided whole —
  a retry told how many tests failed and never which. The digest now keeps the
  head plus a 1 KB tail with a visible elision marker. Nothing to do; retries
  get better input.
- **`FLUME_CONFIG_DIR` pointing outside the repo reaches `afterCommit` gates
  verbatim.** The worktree rebase had no escape test, so a repo-external
  `configDir` was rebased into a path the worktree never had. If you kept the
  chain beside the repo rather than inside it and gave up on gates reading it,
  try again.
- **The agent adapter, not the dispatcher, reads the provider's transcript.**
  `claudeCode` extracts the final message from its own stdout, so a bail
  record's closing prose no longer depends on the dispatcher re-parsing a
  stream format it does not own. A custom `Agent` that wants the field
  populated sets it; one that does not leaves it absent.
- **The state root's layout has one home.** Seventeen literal spellings of
  `awake/`, `prior-attempts/`, `loop.pid`, `stop` and the queue path across
  four engine modules now route through one record, and the runtime ignores
  `flume job new` writes into a job's `.gitignore` derive from that same
  record rather than a parallel list — so renaming a runtime path cannot
  leave the ignore behind pointing at the old one. That merge is append-only
  and idempotent: template-authored lines and their order survive a re-run,
  and only missing entries are added.

## See also

- [`CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md) — the full shape of every chain
  surface named above.
- [`CLI.md`](CLI.md) — `flume check`, `flume status`, `flume job`.
- [`MIGRATING-0.13.md`](MIGRATING-0.13.md) — the previous note in this series.
- [`MIGRATING-0.16.md`](MIGRATING-0.16.md) — the next one, from `0.15.0`.
  What lies between the two is named at the head of this page.
