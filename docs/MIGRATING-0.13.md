# Migrating to 0.13.0

> **Dated record.** Describes the `0.12.0` → `0.13.0` upgrade as it stood at
> the cut, not flume as it ships now.

**This note covers `0.12.0` → `0.13.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.12.md`](MIGRATING-0.12.md) (`0.11.0` →
`0.12.0`); before it, [`MIGRATING-0.11.md`](MIGRATING-0.11.md) (`0.10.x` →
`0.11.0`) and [`MIGRATING-0.10.md`](MIGRATING-0.10.md), which routes any pin
on `0.2.x`, `0.6.x`, or `0.9.0`. If your pin is below `0.12.0`, work those
first and return here — § 1 below is the whole of the `0.12` → `0.13` step
and none of what precedes it.

It does not cover what comes after either: `0.14.0` and `0.15.0` ship
breaking changes with no note of their own, and
[`MIGRATING-0.16.md`](MIGRATING-0.16.md) picks the series back up at
`0.15.0` → `0.16.0`. Jumping past `0.13` means reading those two releases'
`### Breaking` sections in [`../CHANGELOG.md`](../CHANGELOG.md) as well.

From **0.12.0**: **one** breaking change, in `pending.json`, not in the chain
factory. A `0.12` chain loads on `0.13` unmodified; it is the queue beside it
that may not parse. Everything else 0.13 ships is additive — § 2 is the
engine facts it now hands out, each one a block you can delete from your
chain rather than a change you owe it.

Note that **a caret range on a `0.x` version pins the minor** — `^0.12.0`
resolves within `0.12.x` and will never pick up `0.13.0` on its own. Change
the pin explicitly.

## Which sections apply to you

```sh
grep -rn '"kind": "blockedBy"' .flume/            # § 1 — the one break
grep -rn 'blockedBy' --include='*.ts' --include='*.md' .flume/   # § 1, prose and code
grep -rn 'noCommit\|pendingAfter' .flume/chain.ts # § 2.1 — livelock on a drained queue
grep -n 'prior-attempts\|slugify' .flume/chain.ts # § 2.4 — a copied path rule
```

Hits on the first two are work you must do before the bump can run a tick.
Hits on the last two are code 0.13 lets you delete.

## 1. `blockedBy` names every parent: `tag` becomes `tags`

**Affects** every consumer whose `pending.json` carries a `blockedBy` gate,
every prompt or rule that spells the gate shape by hand, and any chain code
that reads `entry.gate.tag` (`spec/pending.md`, *The entry core*).

The single-`tag` form is gone. It is not deprecated and no alias is shipped:
the list is the only spelling the schema accepts.

```json
// 0.12
{ "kind": "blockedBy", "tag": "PARSE-THE-FENCE" }
```

```json
// 0.13
{ "kind": "blockedBy", "tags": ["PARSE-THE-FENCE"] }
```

### Why it moved, and the rewrite that is not mechanical

A one-tag gate could only name one parent, so an entry genuinely waiting on
two was authored as a spine — `C` blocked on `B`, `B` blocked on `A` — which
destroyed at authoring time the parallelism the fanout partitioner exists to
find. `A` and `B` had no reason not to ride the same wave.

```json
// 0.12 — two parents flattened into a spine; three waves minimum
[
  { "tag": "A", "gate": { "kind": "open" } },
  { "tag": "B", "gate": { "kind": "blockedBy", "tag": "A" } },
  { "tag": "C", "gate": { "kind": "blockedBy", "tag": "B" } }
]
```

```json
// 0.13 — the DAG as it actually is; A and B ride one wave, C follows
[
  { "tag": "A", "gate": { "kind": "open" } },
  { "tag": "B", "gate": { "kind": "open" } },
  { "tag": "C", "gate": { "kind": "blockedBy", "tags": ["A", "B"] } }
]
```

So the port has two steps: wrap every surviving `tag` in a list (mechanical),
then look at each spine you authored *because* of the old shape and flatten
the ones that were never real dependencies (judgment — nothing in the engine
can do it for you, and leaving a spine alone is correct behavior, merely
slow).

### The semantics you get

- An entry is pickable once **every** named tag has shipped — a gate with
  several parents resolves only when all of them land, never on the first.
- Wave auto-unblock removes shipped tags one at a time: a wave that ships `A`
  rewrites `C`'s gate to `{ "kind": "blockedBy", "tags": ["B"] }` in place,
  and the gate flips to `{ "kind": "open" }` only when the list empties. No
  plan tick sits between a blocker landing and its child becoming pickable.
- **An empty list is a parse error, never an open gate.** If what you mean is
  "no blocker", the gate is `{ "kind": "open" }` — say it, rather than
  emptying the list and hoping.

### What skipping this looks like

`flume check` exits `65` (`EX_DATAERR`) and names the entry's index and the
field:

```
[flume] check: plan/pending.json has 1 schema violation(s)
  [4] gate.tags: Invalid input: expected array, received undefined
```

The dispatcher takes the same decode at resolution time, so an unmigrated
queue fails loudly rather than silently treating the stale gate as open. Run
`flume check` after the rewrite and before the first tick.

### Code and prose that spell the gate

- **TypeScript embedders** constructing a `PendingEntry` literal, or reading
  `entry.gate.tag` after narrowing to `blockedBy`, get a compile error — the
  typecheck finds these for you.
- **Plain JS** does not: `entry.gate.tag` reads `undefined` and a predicate
  built on it quietly stops matching. Grep for it.
- **Prompt and rule prose** that restates the entry schema by hand needs the
  same edit, and this is the reason not to restate it: `renderSchemaForPrompt`
  already renders the new shape, so a prompt that renders the schema instead
  of transcribing it owes nothing here and will owe nothing next time.

## 2. Nothing else is breaking — what 0.13 lets you delete

Every item below is additive. None of it is required to take the bump; each
retires a block that consumer chains were carrying by hand, and the engine
now reports the fact instead (`spec/loop.md`, *The no-commit taxonomy*;
`spec/chain.md`, *What a gate receives*).

**2.1 A handoff on "anything open" that re-woke a phase picking nothing.**
A fanout tick that found nothing to run now says so outright, rather than
leaving the chain to infer it from a queue that still lists open entries the
supervisor quarantined. The observed failure was a livelock: the phase woke,
picked nothing, handed back, and repeated to `--max`.

```ts
// 0.12 — "the queue still has open entries, so wake build again"
handoff(result) {
  const anyOpen = result.pendingAfter.some((e) => e.gate.kind === "open");
  return anyOpen ? ["build"] : [];
}
```

```ts
// 0.13 — the engine already knows it found nothing
handoff(result) {
  if (result.nothingPickable) return [];
  const anyOpen = result.pendingAfter.some((e) => e.gate.kind === "open");
  return anyOpen ? ["build"] : [];
}
```

`result.quarantinedTags` names the entries this run's live quarantine dropped
from the pickable set, so a chain that wants to distinguish "quarantined" from
"genuinely nothing left" reads that rather than re-deriving it.
`pendingAfter` stays the queue exactly as it is on disk.

**2.2 A job whose every entry touches one file no longer serializes.**
`supervisorPolicy.partitionIgnore` declares globs the fanout partition treats
as touched by nobody — a per-member lock every ship re-pins, a generated
index — so a queue that collapsed to one-entry waves fans out again. It
narrows the partition set only: the fence, the write guard, and ship
detection are untouched, and it is read per tick like `maxParallel`.

**2.3 A prompt constant restating a gate's command line.** `shellGate` and the
package-manager gates built on it declare the command they will run, and the
`<harness>` block renders it beside the gate's name. A chain that wanted its
agent to self-check before committing can delete the parallel constant it
kept in sync by hand.

**2.4 A copied `prior-attempts/` path rule.** `slugify`, `priorAttemptPath`,
and `priorAttemptsDir` ride `src/index.ts` and `FlumeApi`. A chain scanning
that directory should call them — a hand-copied rule breaks silently the next
time the engine renames what it writes. Every prior-attempt record now carries
`headSha` and `at`.

**2.5 A gate reading a tracked file from the state root.**
`GateContext.stateRootRel` is the state root's path relative to the primary
repo root, set when the state root lives inside the repo. `flumeDir` is the
*primary checkout's* state root at both gate points and is not nested under an
`afterCommit` gate's `repoRoot` — the worktree lives inside it — so a gate
reading a tracked state-root file **at the gated sha** goes through
`stateRootRel`, not `flumeDir`.

**2.6 "Has the world moved since this phase last ran."** Every tick verdict
now carries `headSha` and `at`, so that question is a comparison against
engine state and a phase need not commit on a quiet tick to leave an anchor.
`invocations[]` holds one row per agent run — tag, model, turns, duration, and
input, output, cache-creation and cache-read tokens as separate fields,
because cost is unrecoverable without the cache split.
`readLatestVerdictsSync` serves the latest verdict per phase to
`shouldRun`/`handoff`, which cannot `await`.

**2.7 `GateResult.failingFiles` and `suspectFlake`.** A gate whose runner can
name the files it failed on may report them, and the engine marks a
gate-revert record `suspectFlake` when every named file is disjoint from the
reverted span's footprint. No builtin populates the field yet — this is a
surface for your runner, not a behavior change.

## 3. Operators

- **If you disabled `pendingGate` on 0.12 because it reverted the commit that
  repaired the queue, re-enable it.** Running inside the singleton worktree
  0.12 introduced, it read trunk's `pending.json` from `flumeDir` — the
  previous commit's queue, not the gated one — so it passed a plan commit that
  filed an off-fence entry and then reverted the commit that fixed it. It now
  reads the queue at `ctx.commitSha`, keeping the disk read only for a state
  root relocated outside the repo.
- **The friction harvest no longer re-delivers a committed note.** The bound
  is untracked-at-worktree-HEAD: a note the tick committed reaches you through
  its commit or its revert snapshot, not a second stamped copy you reconcile
  by hand (`spec/worktrees.md`, *Teardown harvest*).
- **`cherry-pick --abort` no longer fires blind** — it runs only when
  sequencer state exists, and staged bystander work on the primary checkout is
  captured as a dangling commit before the merge stage begins, its sha on the
  verdict as `bystanderCheckpointSha`. Nothing to do; it is the crash path
  getting quieter.

## See also

- [`CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md) — the full shape of every chain
  surface named above.
- [`CLI.md`](CLI.md) — `flume check`'s exit codes, `flume status`, `flume job`.
- [`MIGRATING-0.12.md`](MIGRATING-0.12.md) — the previous note in this series.
- [`MIGRATING-0.16.md`](MIGRATING-0.16.md) — the next one, from `0.15.0`.
  What lies between the two is named at the head of this page.
