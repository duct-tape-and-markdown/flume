# Migrating to 0.15.0

> **Dated record.** Describes the `0.14.0` → `0.15.0` upgrade as it stood at
> the cut, not flume as it ships now.

**This note covers `0.14.0` → `0.15.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.14.md`](MIGRATING-0.14.md) (`0.13.0` →
`0.14.0`); before it, [`MIGRATING-0.13.md`](MIGRATING-0.13.md) (`0.12.0` →
`0.13.0`), [`MIGRATING-0.12.md`](MIGRATING-0.12.md) (`0.11.0` → `0.12.0`),
[`MIGRATING-0.11.md`](MIGRATING-0.11.md) (`0.10.x` → `0.11.0`) and
[`MIGRATING-0.10.md`](MIGRATING-0.10.md), which routes any pin on `0.2.x`,
`0.6.x`, or `0.9.0`. If your pin is below `0.14.0`, work those first and
return here — `0.13`'s § 1 is a `pending.json` rewrite the first tick after
that bump refuses without, and nothing on this page substitutes for it.

The next note is [`MIGRATING-0.16.md`](MIGRATING-0.16.md) (`0.15.0` →
`0.16.0`). The series is continuous from `0.10` upward — every minor that
shipped breaks has a page of its own — so no release between these notes has
a `### Breaking` section in [`../CHANGELOG.md`](../CHANGELOG.md) you have to
work by hand. One item on the next page is due here anyway —
its § 0, the `package.json` beside your `chain.ts`, is what makes an
ESM-only package load under `tsx` on node 22, and a chain pinned to `0.15`
needs it exactly as much as one on `0.16`.

From **0.14.0**: **four** breaking changes. Three are shapes your compiler
resolves — a parameter that narrowed, a field that appeared, an internal
type behind a CLI listing. § 1 is the exception, and the reason this page
leads with it: the first consumer to take this upgrade reported the mode
rename as the one break their compiler did not catch, because a chain that
reads the mode as a bare string keeps compiling and simply stops matching.
§ 1.1 is how to find that by reading, since there may be no distinctive
token to grep for.

Everything else 0.15 ships is additive — § 5 is the engine facts it now
reports, each a block you can delete from your chain rather than a change
you owe it, and § 6 is what moves under an operator, including two
`.gitignore` lines a `flume tick`-only driver has to add by hand.

Note that **a caret range on a `0.x` version pins the minor** — `^0.14.0`
resolves within `0.14.x` and will never pick up `0.15.0` on its own. Change
the pin explicitly.

## Which sections apply to you

```sh
grep -n 'voluntary-bail\|noCommit\|\.mode\b\|constraint' .flume/chain.ts   # § 1
grep -n 'writablePathsGate' .flume/chain.ts                                # § 2
grep -n 'priorAttempts\|prior-attempts' .flume/chain.ts                    # § 3
grep -n 'quarantinedTags' .flume/chain.ts                                  # § 5.6
cat .flume/.gitignore                                                      # § 6.1
flume job status                                                           # § 4, if you run jobs
```

A hit on the first line is work; **no hit on it proves nothing** — the
whole of § 1.1 is that the read which breaks silently is the one that never
spelled the mode's name. Read § 1 either way. § 6.1's `cat` printing a file
without `rendered-prompts/` and `merging/` in it is the finding.

## 1. The no-commit mode `voluntary-bail` is `clean-exit`

**Affects** every chain that names the mode — a `shouldRun` brake, a
`handoff` branch, a log line — and every chain that read the record's
refused-constraint text. One rename across three surfaces, and **no alias is
shipped**:

| 0.14 | 0.15 |
| --- | --- |
| `NoCommitMode` member `"voluntary-bail"` | `"clean-exit"` |
| union variant `VoluntaryBailAttempt` | `CleanExitAttempt` |
| that variant's `constraint` field | `finalMessage` |

The variant interfaces are not on the package's `exports` map in either
version — you reach them by narrowing `PriorAttempt`, so the rename lands on
the discriminant you compare and the field you read, not on an import.

### Before and after

```ts
// 0.14 — the mode as an engine verdict, and the field that classified it
handoff: (r) => (r.noCommit === "voluntary-bail" ? ["plan"] : []),

shouldRun: async (ctx) => {
  const rec = ctx.priorAttempts?.get(api.slugify(tag));
  if (rec?.mode === "voluntary-bail") {
    log(`prior attempt refused: ${rec.constraint}`);
    return false;
  }
  return true;
},
```

```ts
// 0.15 — the mode as the fact the engine holds, and the message verbatim
handoff: (r) => (r.noCommit === "clean-exit" ? ["plan"] : []),

shouldRun: async (ctx) => {
  const rec = ctx.priorAttempts?.get(api.slugify(tag));
  if (rec?.mode === "clean-exit") {
    log(`prior attempt exited clean, last said: ${rec.finalMessage}`);
    return false;
  }
  return true;
},
```

The same rename reaches `FanoutEntryOutcome.noCommit` on a wave's per-entry
records and the `<prior-attempt>` block the retry's prompt carries, which now
introduces the record as *"exited cleanly and committed nothing … the harness
records that it exited and what it last said, never what the exit meant"*
and quotes the tail under **Prior attempt's final message (tail,
verbatim)**. A prompt of your own that told the agent to read a *refused
constraint* is describing a label the engine no longer applies.

### Why it changed

The engine held one fact — the agent exited 0 and committed nothing — and
shipped a name for what that meant. A refused constraint, a deliberate park,
and simply nothing to do are three readings of one chain's prompt, and one
exit code tells them apart in none of them; naming one is the engine
inferring intent from a side effect (`engine-boundary.md`, *Told, not
inferred*). `clean-exit` states the exit. `finalMessage` quotes the bounded
tail of what the agent itself said and stops there — the same bytes the old
`constraint` field carried, under a name that quotes rather than classifies,
so the reading moves to the chain that owns the prompt those words answer.

### 1.1 The read that keeps compiling

This is the break to hunt deliberately. Compare the two reads:

```ts
// named through the engine's own union — reds at the bump, at the line
import type { NoCommitMode } from "@dtmd/flume";
const STOP_ON: readonly NoCommitMode[] = ["gate-revert", "voluntary-bail"];
//                                                       ^ type error on 0.15
```

```ts
// never named it — compiles on both versions, matches on neither after
const rec = ctx.priorAttempts?.get(slug) as
  | { mode?: string; constraint?: string }
  | undefined;
if (rec?.mode === "voluntary-bail") return false;   // false forever
log(`refused: ${rec?.constraint ?? ""}`);           // empty forever
```

Nothing reds; the brake just stops braking, and the log line goes blank
rather than missing. A `shouldRun` written this way reads every tick as a
first attempt, which is a live-lock that looks like ordinary retrying.

Four places to read for it:

1. **Every `as` and every `: string` near a prior-attempt or verdict read.**
   The cast is where the union was dropped; `mode` typed as `string` accepts
   a spelling the engine no longer mints.
2. **Every read of `.constraint`.** That field name is gone. A cast-shaped
   read yields `undefined`; a `JSON.parse` of a record file yields the same.
3. **Comparisons against `noCommit`.** `TickResult.noCommit` and
   `FanoutEntryOutcome.noCommit` are both `NoCommitMode` — if the
   surrounding code widened either to a string before comparing, the
   comparison is unchecked.
4. **Anything reading `prior-attempts/*.json` directly** rather than through
   `TickContext.priorAttempts`. See § 3: on 0.15 such a reader also has to
   account for the new `key` field.

The fix is the same in each: delete the cast, name `NoCommitMode` or
`PriorAttempt`, and let the compiler find the remaining sites. 0.16's
[§ 3](MIGRATING-0.16.md) works the same repair through a full `shouldRun`,
because the next release's keyspace change lands on exactly these readers.

## 2. `writablePathsGate`'s entry scope is the resolved path list

**Affects** a chain that constructs `writablePathsGate` itself. The
dispatcher attaches it from each phase's `writablePaths` automatically, and
a chain that lets it — the documented shape
([`CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md), *Use the built-ins first*:
"attached automatically by the dispatcher … Don't list manually") — changes
nothing here.

### Before and after

```ts
// 0.14 — two lists, unioned inside the gate
api.writablePathsGate(phase.writablePaths, {
  entryPaths: [
    ...entry.files.new.map((f) => f.path),
    ...entry.files.edit.map((f) => f.path),
    ...entry.files.retire,
  ],
  channelPaths: phase.entryChannelPaths ?? [],
});
```

```ts
// 0.15 — one resolved allowance, already unioned
api.writablePathsGate(phase.writablePaths, [
  ...new Set([
    ...entry.files.new.map((f) => f.path),
    ...entry.files.edit.map((f) => f.path),
    ...entry.files.retire,
    ...(phase.entryChannelPaths ?? []),
  ]),
]);
```

The phase globs stay the outer ceiling in both versions; both checks apply.
Omitting the second argument is still "this tick is unscoped", and on 0.15
that is the *only* thing it means — `undefined` **is** the unscoped tick.

### Why it moved

The gate took the two inputs and unioned them; the prompt renderer decided
scoped-or-not and built the same union for the fence it showed the agent.
Two spellings of one decision, sharing only the final shape, so a one-sided
edit could render a fence the guard did not enforce. One derivation now
answers both — the dispatcher resolves the allowance once and hands the
gate the result — and the gate no longer re-decides whether a tick is scoped
or rebuilds anything (`.claude/rules/engineering.md`, *The fix lands at the
mechanism*).

### What skipping this looks like

TypeScript embedders get an error at the call: an object literal is not
`string[]`. Plain JS does not — the struct is accepted and carried as far as
the first scoped tick, where the gate hands it to the path matcher and the
run throws (`entryScope.some is not a function`). It fails loudly, at the
gate, on the first fanout tick after the bump; the cause is one argument.

## 3. A prior-attempt record states its keyspace

**Affects** the first tick after the bump, and any code that writes or
parses a record file directly. Reading records through
`TickContext.priorAttempts` needs no change — the key is still the bare
slug on 0.15 (the keyspace joins the *key* in 0.16, not here).

Every record now carries `key`, the keyspace it was written under, beside
the `headSha`/`at` anchor:

```jsonc
// 0.14 — .flume/prior-attempts/some-entry.json
{
  "mode": "voluntary-bail",
  "constraint": "…",
  "headSha": "9c1f…",
  "at": "2026-09-08T11:02:14.884Z"
}
```

```jsonc
// 0.15
{
  "mode": "clean-exit",
  "finalMessage": "…",
  "key": "entry",
  "headSha": "9c1f…",
  "at": "2026-09-14T08:17:03.512Z"
}
```

`PriorAttemptKeyspace` (`"entry" | "phase"`) is exported, so a chain can name
the field's type. The reader treats a record as **absent** unless its `mode`
is one the engine mints, `headSha` and `at` are strings, *and* `key` is one
of the two keyspaces — the same degrade an unrecognized `mode` already
earned, because a stale slot must never become a false signal.

**What you do:** nothing. Records are gitignored runtime state, so a state
root written by 0.14 simply starts clean — a 0.14 record fails the check on
two counts at once (its `mode` is the retired spelling, and it has no `key`),
reads as absent, and is overwritten by the next record under the same slug. A
repository upgrading mid-loop loses at most one retry's carried context. If
you have a tool that *writes* a record file by hand, stamp `key` or the
engine will not read what it wrote.

### Why the field exists

The key's own text cannot say which keyspace it belongs to: a stem the queue
no longer carries is a retired entry tag in one keyspace and a live phase
name in the other. The wave that clears stale entry-keyed records (§ 5.4)
needs that answer to be *stated* rather than guessed from a filename, so the
writer stamps it.

## 4. `flume job status` tells an unreadable baton from a hibernating one

**Affects** an operator, and any script parsing the `flume job status`
listing. `JobStatus` is internal — it is not on the package's `exports` map
— so no chain names the type; what changed is the row.

`JobStatus.awake` is `string[] | null`, and the listing has three readings
where it had two:

```
# 0.14 — two readings, and a job whose awake/ dir could not be read
#        threw out of the whole listing, taking its siblings' rows with it
docs-refresh  awake: build  pending: 3
api-sweep     hibernating  pending: 0

# 0.15 — the third reading, reported per job
docs-refresh  awake: build  pending: 3
api-sweep     hibernating  pending: 0
locked-out    awake: unreadable  pending: 1
```

An `awake/` directory that exists but cannot be read (permission denied, a
path too long for the platform) is neither a phase list nor a hibernating
baton, and printing it as `hibernating` was the lie the `null` exists to
prevent (`.claude/rules/engineering.md`, *Loud or nothing*). The wording
matches the `friction: unreadable` segment beside it. A script keying on the
exact string `hibernating` keeps working; one keying on "not `awake:`" now
has a third case to route.

## 5. Nothing else is breaking — what 0.15 lets you delete

Every item below is additive: none is required to take the bump, and each
retires a block consumer chains were carrying by hand. 0.15 is the reporting
release — two consumer chains were surveyed against the 0.14 engine and each
still rebuilt facts the dispatcher had in hand.

**5.1 A gate or `shipped` predicate rebuilding the span base.**
`GateContext.baseSha`, `TickResult.baseSha` and `ShipContext.baseSha` name
the commit the span was provisioned from, at both concurrencies and at both
gate stages.

```ts
// 0.14 — an afterMerge gate cannot tell an input the tick ignored
//        from one that landed after it branched
const changed = await api.git.showNameOnly(ctx.repoRoot, "HEAD~1");
```

```ts
// 0.15 — the engine's own number
// what landed after this tick branched:
//   git log <ctx.baseSha>..HEAD -- <inputs>
// the input exactly as the tick read it:
// optional on the type (hand-built fixtures); every dispatcher-built
// context sets it, and § 5.5's `skipped` is how a gate says it stood down
const base = ctx.baseSha;
if (base === undefined) return { ok: true, skipped: "no span base" };
const asRead = await api.git.readFileAtRef(ctx.repoRoot, base, rel);
```

**5.2 A hand-rolled `git show <sha>:<path>`.** `api.git.readFileAtRef(repoRoot,
ref, relPath)` is the engine's own bytes-at-a-sha reader, beside
`showNameOnly`: an absent path is `null`, an unresolvable ref **rejects**,
and the 16 MB buffer is the engine's. Two surveyed chains had rolled their
own and classified every failure as "absent from the commit", so a bad ref
read as a missing file.

**5.3 A chain rebuilding "was the last attempt declined" from the verdict
log.** A `shipped: false` verdict now writes a `not-shipped` prior-attempt
record under the entry's key — rendered into the retry's `<prior-attempt>`
block and served on `TickContext.priorAttempts` — carrying the merged sha and
the paths that commit touched. It is a sibling fact beside the four
`NoCommitMode` variants, not a fifth member: a tick that committed is not a
no-commit tick.

**5.4 A `handoff` telling a park from a cherry-pick conflict.** Those two read
identically on the committed/shipped/reverted flag triple.
`FanoutEntryOutcome.mergeOutcome` is the wave's own merge record per entry,
and `TickResult.provisionFailures` names an entry whose worktree or
`setupWorktree` hook failed — such an entry never reaches an agent and so is
*not* a `TickResult.entries` record with every flag false. Stale
prior-attempt records are also cleared at the wave's queue read now, so a
record whose entry left the queue unshipped no longer stands forever.

**5.5 A gate that passes without running.** `GateResult.skipped?: string` is
where it says so, copied verbatim onto the tick verdict; `ok` remains the
verdict. A gate returning `ok: true` without it claims it ran.
`GateContext.entry` carries the fanout entry the span was provisioned for,
at both stages, so a chain gate can hold a commit to its entry's own
contract without re-reading the queue.

**5.6 A `handoff` reading `quarantinedTags` as strings.** The run-scoped
quarantine now keys `slug@hash`, so re-scoping a held entry on trunk mints a
new key and lifts the hold inside the same run — and the field is
`readonly QuarantinedTag[]` (`{ tag, key }`) rather than `readonly string[]`.
This is a type change: an `includes(tag)` call reds at the bump, which is the
outcome you want.

```ts
// 0.14
r.quarantinedTags?.includes(tag)
// 0.15
r.quarantinedTags?.some((q) => q.tag === tag)
```

**5.7 The tick's input, on disk beside its output.** The exact bytes handed to
`agent.invoke` are persisted before the agent runs, under
`<flumeDir>/rendered-prompts/`, and the verdict's invocation row names the
file as `promptPath` (see § 6.1 for the ignore line this needs).

**5.8 A second copy of a gate, placed at the other point.**
`tscGate({ when: "afterMerge" })` is the same check at the trunk point;
omitted, `afterCommit` as before. The same option is on every builtin.

**5.9 A `shouldRun` paying for a decline.** A singleton's `shouldRun` is
consulted before provisioning, so a decline costs a `rev-parse` and the
pending read rather than a worktree and an install. Chain-load failure is
reported on stderr by `status`, `job status`, `wake` and `sleep` instead of
being swallowed; exit codes and stdout are unchanged.

## 6. Operators

### 6.1 Two ignore lines, added by hand on a `flume tick` driver

0.15 writes under two new directories in the state root:
`rendered-prompts/` (§ 5.7) and `merging/` (§ 6.2). `flume loop` and `flume
job run` merge the runtime ignore set into `<flumeDir>/.gitignore` at start
— idempotent, append-only, template-authored lines preserved — so a
loop-driven repository picks both up on its next start with nothing to do.

**A driver that only ever calls `flume tick` never reaches that merge.** Add
them yourself, in the state root's own `.gitignore`:

```sh
printf 'rendered-prompts/\nmerging/\n' >> .flume/.gitignore
```

Missing the lines is not a data-loss bug, but every tick leaves untracked
artifacts under the state root — enough for a clean-tree gate to red, or for
a tick to commit its own rendered prompt.

### 6.2 A merge a crash interrupted is refused at the next start

The merge stage stakes `<flumeDir>/merging/<slug>.json` before each
cherry-pick and retires it after the queue rewrite. A survivor means the
process died between the pick and the ship bookkeeping: the commit may
already sit on trunk, ungated, with its entry still open. `loop` and `job
run` now refuse on one, exiting **`EX_CONFIG` (78)**, naming the entry, its
branch and its span, and touching nothing — the startup sweep does not run,
so each abandoned branch still stands:

```
[flume] loop refuses: a merge interrupted before its ship bookkeeping is unreconciled
[flume]   .flume/merging/some-entry.json: entry SOME-ENTRY on branch flume/some-entry (span 9c1f2ab..flume/some-entry)
[flume] the picked commit may already sit on trunk ungated with its entry still
        open; reconcile (revert the commit, or mark the entry shipped), then
        remove the file to acknowledge. …
```

Removing the file **is** the acknowledgement; as with the stop flag, no
engine verb performs it.

### 6.3 A present-but-unreachable path no longer reads as absent

`existsSync` collapsed every stat error to `false`, so a stripped traversal
bit made a live `loop.pid` read as no supervisor, an unreadable `awake/` read
as hibernating, and an unreadable `.flume` print "no jobs". Twelve sites now
distinguish `ENOENT` from everything else — the stop flag, the tip claim, the
loop lockfile, `loop.pid`, the awake flag, both `pending.json` reads,
`chain.ts` at load, the `.flume` ancestor walk and job state root, the
worktree path, the prior-attempt record, and bay discovery. **What you
notice:** a permissions problem that used to present as a quiet wrong answer
now presents as an error naming the path.

### 6.4 Provisioning removes only a path git registers as this repo's worktree

The occupied-path fallback was a blind recursive delete, reachable by a
sibling job's live worktree under a shared `FLUME_WORKTREES_DIR`. One
registry probe now answers for provisioning and the startup sweep alike, and
an unreadable registry removes nothing and says so. If you run concurrent
jobs over one worktrees base, this is the release that stops them eating each
other.

### 6.5 Smaller operator-visible fixes

- **`flume check` on a chain with no fanout phase** passes its fence step
  explicitly instead of reporting every declared path as a violation against
  an empty fence.
- **A gate-revert digest keeps both ends** of long gate output, so a retry is
  told which tests failed rather than only how many.
- **A singleton's worktree-prune throw** enters the failure accounting, so the
  supervisor's consecutive-failure backstop can see a deterministic prune
  wall.
- **An unreadable `pending.json` on the post-tick re-read degrades** — warn
  with the errno, report an empty `pendingAfter` — instead of throwing away
  the `TickResult` for work that already landed.
- **The prior-attempt snapshot dir and record share one slug**, so a key
  carrying path separators cannot resolve the snapshot dir outside
  `prior-attempts/`.

## See also

- [`CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md) — the full shape of every chain
  surface named above, including every `TickContext` field and all six
  prior-attempt modes.
- [`CLI.md`](CLI.md) — `flume check`, `flume status`, `flume job`.
- [`MIGRATING-0.14.md`](MIGRATING-0.14.md) — the previous note in this series.
- [`MIGRATING-0.16.md`](MIGRATING-0.16.md) — the next one, from `0.15.0`. Its
  § 0 is due on `0.15` too.
