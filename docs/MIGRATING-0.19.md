# Migrating to 0.19.0

**This note covers `0.18.x` → `0.19.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.18.md`](MIGRATING-0.18.md), which walks
`0.17.x` → `0.18.0`; before it, [`MIGRATING-0.17.md`](MIGRATING-0.17.md)
(`0.16.x` → `0.17.0`) and the notes behind it. If your pin is below `0.18.0`,
work those first and return here. The item on the previous page that is due
whether or not you take this upgrade is
[the retired suspect-flake marker](MIGRATING-0.18.md#1-gaterevertattemptsuspectflake-is-gone-a-gate-declares-blamesspan-false)
— a chain still reading that field reads nothing at all.

From **0.18.x**. **Two shared files became two directories, and for one
reason: a file every writer edits is a file no two writers can merge.**

The first is the pending queue, one JSON file per entry (§§ 1–5). One array
in one file was one file with every writer's hand in it — a producer rewrote
the whole array to add an entry, the ship rewrote it to remove one, and git
could merge none of that. One file per entry makes those edits disjoint. The
cut moves a chain field (§ 1), a gate-context field (§ 2), three parse
exports and one error field (§ 3), any fence glob or prompt span naming the
queue (§ 4), and the queue you already have on disk (§ 5).

The second is the harness package's plan state, one JSON file per plan slice
(§ 6) — the same shape for the same reason, and it moves the accessors, the
fence helper, one prompt arg, and the page you already have on disk.

A third artifact became a directory on the same line for a different reason:
the tick verdict, now one file per phase (§ 7), because a supervisor run
holds one child per awake phase and a single path lost every child's facts
but the last. Nothing in a chain reads it, so § 7 is an ignore line and a
stale file.

Your typecheck names §§ 1–3 and the API half of § 6; §§ 4, 5, 7 and the disk
half of § 6 are the halves nothing catches.

**This page is the `0.19` line's census as it stands, not the cut's.** A
break landing on `0.19` after this one joins the page as it ships, and the
`### Breaking` section of the release's own entry in
[`CHANGELOG.md`](../CHANGELOG.md) is the complete list at the cut — read it
beside this page if `0.19.0` has been released by the time you arrive here.

Note that **a caret range on a `0.x` version pins the minor** — `^0.18.0`
resolves within `0.18.x` and will never pick up `0.19.0` on its own. Change
the pin explicitly.

## Which sections apply to you

```sh
grep -n 'pendingPath' .flume/chain.ts                                    # § 1
grep -rn 'ctx\.pendingPath' --include='*.ts' .                            # § 2
grep -rn 'parsePending\|parsePendingLoose\|composePendingList' \
  --include='*.ts' .                                                      # § 3
grep -rn 'pending\.json' --include='*.ts' --include='*.md' .              # §§ 4–5
ls "$(git rev-parse --show-toplevel)"/.flume/plan/pending.json            # § 5
grep -rn 'PlanStateSchema\|readPlanState\|writePlanState\|planStatePath\|planArtifacts\|PLAN_STATE_PATH' \
  --include='*.ts' --include='*.md' .                                     # § 6
ls "$(git rev-parse --show-toplevel)"/.flume/plan/state.json             # § 6
grep -rn 'tick-verdict\.json' --include='*.ts' --include='*.md' \
  --include='.gitignore' .                                                # § 7
grep -rn 'flume tick.*[^-]-\?1\b\|exit 1' --include='*.sh' --include='*.yml' .  # § 9
```

The path greps are the ones to run even if the API greps come back empty: a
fence glob, a prompt span, or a doc naming `plan/pending.json` is a path the
engine no longer reads, and the queue on disk is a file the engine no longer
opens. Take § 5 in the same commit as §§ 1–4 — a tick between them reads an
empty queue. § 6 is independent of all of them and may land in its own
commit.

## 1. `Chain.pendingPath` is `Chain.pendingDir`, and it names a directory

**Affects** a chain declaring a queue location of its own. Undeclared chains
take the new default with no edit.

```diff
 export default () => ({ chain: {
-  pendingPath: "queue/entries.json",
+  pendingDir: "queue/entries",
   phases: [ ... ],
 } });
```

The default moves with it: `plan/pending.json` → `plan/pending`. The
refusals are the ones `pendingPath` already took — the value must be relative
and must resolve inside the state root — and the message now says
`directory path (e.g. "plan/pending")`.

## 2. `GateContext.pendingPath` is `GateContext.pendingDir`

**Affects** any gate reading the queue off its context. The field is the
resolved **directory**; every `*.json` directly under it is an entry, and a
subdirectory is not walked, so a chain may keep sidecars beside the entries.

A gate that read the queue at the commit it gates reads it through the
engine's own listing rather than composing its own:

```diff
-const raw = await api.git.readFileAtRef(
-  ctx.repoRoot,
-  ctx.commitSha,
-  join(ctx.stateRootRel, "plan", "pending.json"),
-);
-const parsed = parsePending(raw ?? "");
+const queue = await api.readGatedQueue(ctx);
+const parsed = parsePendingQueue(queue.files ?? []);
```

`readGatedQueue` takes the gate's own context and answers three facts about
the queue that commit holds: `rel`, the directory's name relative to the state
root, for a message; `dirRel`, its repo-relative spelling in git's alphabet,
for a pathspec or a touched-path comparison; and `files`, every entry file
already read out of the commit's tree. Nothing about the offset is composed by
the gate — including the one case that is not a tree read at all, a state root
relocated outside the repo, which no commit can name and which falls back to
the disk listing.

`files` is `null` when no queue was readable — absent from that commit's tree
(a git tree holds no empty directory, so absent and empty are one fact), or
unreadable on the relocated root's disk leg. It is the same value, from the
same read, that `pendingGate` refuses on.

## 3. The parse surface is per-entry, and a `ParseError` names a file

**Affects** a chain calling the queue parse directly. Three exports are
renamed and one takes a different shape:

| before                | after                      |
| --------------------- | -------------------------- |
| `parsePending(raw)`   | `parsePendingQueue(files)` |
| `parsePendingLoose(raw)` | `parsePendingQueueLoose(files)` |
| `composePendingList(ext)` | `composePendingEntry(ext)` |

`files` is a `QueueFile[]` — `{ file, raw }` per entry, the shape
`readGatedQueue` and the engine's own disk listing hand back. `ParseResult`
is unchanged otherwise: `ok`, `entries`, `errors`.

`composePendingEntry` validates **one entry**, not a list — a chain keeping
its own array in its own file (as `examples/backlog-groomer-chain.ts` does)
applies it per element itself.

`ParseError.index` is gone; `ParseError.file` takes its place, naming the
entry file the failure was read out of:

```diff
-r.errors.map((e) => `  [${e.index}] ${e.path}: ${e.message}`)
+r.errors.map((e) => `  [${e.file}] ${e.path}: ${e.message}`)
```

Queue-wide tag uniqueness is the filesystem's now — two entries claiming one
tag would be one file — so the composed schema no longer reports a duplicate.
What the parse refuses in its place is a file whose `tag` disagrees with its
filename, naming both.

## 4. Fence globs and prompt spans name the directory

**Affects** the phase that writes the queue, and any prompt that reads it.
Neither is typechecked.

The fence is the **glob**, never the directory: the producer writes entry
files, and a sidecar beside them is no phase's to write.

```diff
 writablePaths: [
-  `${stateRoot}/plan/pending.json`,
+  `${stateRoot}/plan/pending/*.json`,
   ...
 ],
```

A prompt span that `cat`s the queue now reads a directory. The shape
`examples/prompts/plan.md` ships:

```sh
!`d="{{FLUME_DIR}}/plan/pending"; test -e "$d" || { echo "(no queue directory yet)"; exit 0; }; find "$d"/ -maxdepth 1 -name '*.json' >/dev/null || exit 1; n=0; for f in "$d"/*.json; do test -e "$f" || break; n=$((n+1)); printf '=== %s\n' "${f##*/}"; cat "$f"; done; test "$n" -gt 0 || echo "(queue empty)"`
```

`test -e` selects the placeholder for absence and exits zero; the `find`
past it refuses when something that is not a directory stands there, which is
a failed read rather than an absence.

**Affects the harness package's prompt args too.** The shared arg naming the
queue is `PENDING_DIR`, not `PENDING_PATH`, and it renders the directory. A
consumer prompt still spelling `{{PENDING_PATH}}` renders that token
literally — the renderer leaves an unresolved key standing rather than
substituting an empty string, so the break reads back in the tick's own
prompt.

## 5. The queue on disk is an operator cutover

**Affects** every repository with a queue already on disk. No tick does this
for you: the state root is outside every phase's fence, so the split is a
commit you make by hand, in the same commit as §§ 1–4.

```sh
root="$(git rev-parse --show-toplevel)"
cd "$root/.flume/plan"
mkdir -p pending
# One file per entry, named for its tag. jq is one way; any splitter will do.
jq -c '.[]' pending.json | while read -r entry; do
  tag="$(printf '%s' "$entry" | jq -r .tag)"
  printf '%s' "$entry" | jq . > "pending/$tag.json"
done
# The placeholder keeps the directory in the tree once every entry has
# shipped: git holds no empty directory, and the pending gate fails an
# absent one.
touch pending/.gitkeep
git rm -q pending.json
git add pending
```

**The filename and the entry's `tag` must agree** — `<tag>.json`, exactly.
The parse refuses a disagreement naming both, because every tag-keyed lookup
the engine makes composes the file back from the tag.

A repository adopting for the first time gets this from `flume-harness init`,
which now seeds `.flume/plan/pending/.gitkeep` in place of the empty array.

For a consumer of the harness package, the legacy `plan/pending.json` stays
on the plan fence for exactly one release so a plan tick can `git rm` it if
you would rather the split land in a `plan:` commit than a hand-made one —
the same one-time allowance `plan/open-questions.md` took in
[`MIGRATING-0.17.md`](MIGRATING-0.17.md). It is retired by the maintainer
cutting the release after this page.

## 6. Plan state is one file per slice

**Affects** a consumer of the harness package: anything reading or writing
plan state, declaring a plan phase's fence through `planArtifacts`, or
rendering a plan prompt. Independent of §§ 1–5 — it may land in its own
commit.

Plan state was one page with four fields and three writers, one of which —
`derivedThrough` — the derive slice and the inbox drain both moved. Two hands
on one cursor is a fact whose owner is whichever tick wrote last, and two
slices stamping in one wave conflict over fields neither of them touched.
Each slice's state is now its own file, named for the slice that writes it:

| slice          | file                          | fields                      |
| -------------- | ----------------------------- | --------------------------- |
| `plan-derive`  | `plan/state/plan-derive.json` | `derivedThrough`            |
| `plan-sweep`   | `plan/state/plan-sweep.json`  | `sweptThrough`, `rotation`  |
| `plan-inbox`   | `plan/state/plan-inbox.json`  | `drainedRuns`               |

### The accessors take the slice

```diff
-import { PlanStateSchema, readPlanState, writePlanState } from "@dtmd/flume/harness";
-import type { PlanState, PlanStateWrite } from "@dtmd/flume/harness";
+import { PLAN_STATE_SCHEMAS, readPlanState, writePlanState } from "@dtmd/flume/harness";
+import type { PlanStateOf, PlanStateWriteOf } from "@dtmd/flume/harness";

-const state = readPlanState(stateRoot);
-writePlanState(stateRoot, { ...state, derivedThrough: sha });
+const state = readPlanState(stateRoot, "plan-derive");
+writePlanState(stateRoot, "plan-derive", { derivedThrough: sha });
```

`PLAN_STATE_SCHEMAS` is the table keyed by slice; `PlanStateOf<S>` and
`PlanStateWriteOf<S>` are that slice's read and write shapes. A slice's file
is its whole state, so a write carries that slice's fields and no sibling's —
spelling one is a type error rather than a field silently ignored.

Absence is per slice now: a slice whose own file was never written reads
`undefined` and opens over its whole declared corpus, whatever a sibling
holds.

### The fence and the prompt arg are per slice

`planStatePath` and `planArtifacts` both take the slice whose artifacts they
are naming:

```diff
-writablePaths: planArtifacts(stateRoot),
+writablePaths: planArtifacts(stateRoot, "plan-derive"),
```

That is what makes "no slice writes a cursor it does not own" a gate rather
than a paragraph: a phase fenced to its own state file has the commit
reverted if it stamps a sibling's.

`PLAN_STATE_PATH` leaves `SHARED_PROMPT_DATA_KEYS`, because the value is a
different file per slice. It is in `PLAN_SLICE_PROMPT_DATA_KEYS`, rendered by
`planSlicePromptArgs(slice, stateRoot, claimed)`:

```diff
 promptArgs: {
   ...sharedPromptArgs({ declaration, extension, stateRoot }),
+  ...planSlicePromptArgs(slice, stateRoot, ctx.claimed ?? []),
 },
```

A plan prompt still spelling `{{PLAN_STATE_PATH}}` under the shared args
alone renders that token literally (§ 4).

### The page on disk is an operator cutover

No tick does this for you, for the reason § 5 gives: the state root is
outside every phase's fence.

```sh
root="$(git rev-parse --show-toplevel)"
cd "$root/.flume/plan"
mkdir -p state
jq '{derivedThrough}'          state.json > state/plan-derive.json
jq '{sweptThrough, rotation}'  state.json > state/plan-sweep.json
jq 'if has("drainedRuns") then {drainedRuns} else {} end' \
                               state.json > state/plan-inbox.json
git rm -q state.json
git add state
```

Skipping it costs one tick per cursor rather than data: a state root left
unsplit reads as no state anywhere, so derive and sweep each bootstrap once
over their whole corpus and the inbox re-drains each lane's latest failing
run once.

The legacy `plan/state.json` rides the plan fence for exactly one release —
the same one-time allowance § 5 gives the legacy queue, and retired with it —
so a plan tick can `git rm` it if you would rather the split land in a
`plan:` commit.

## 7. The tick verdict is a directory, one file per phase

`<stateRoot>/tick-verdict.json` is now `<stateRoot>/tick-verdict/<phase>.json`
— one file per phase, written by `flume tick` and read back by `flume loop`'s
supervisor under the phase it named each child with.

Why: a supervisor run holds one child per awake phase at once, and every one
of them wrote to the same path. The last child to finish overwrote its
siblings' facts before the supervisor read them, and the loss was silent —
the supervisor read a well-formed verdict that simply belonged to another
phase. Above a `maxTicks` of 1 the run's shipped tags, errored-tick count and
agent spend were all short by however many children raced.

**Your `.gitignore` is the one thing to change.** The engine seeds its own
ignore set into `<stateRoot>/.gitignore` at every `loop` start, so that file
picks up the new entry on its own; a line you wrote yourself — in a
repository-root `.gitignore`, or one `flume-harness init` wrote for you
before this release — still names the old file and ignores nothing:

```diff
-.flume/tick-verdict.json
+.flume/tick-verdict/
```

The trailing slash is load-bearing: a bare `tick-verdict` line reads as a
file pattern, and the directory's contents stay untracked-visible.

The stale `tick-verdict.json` left on disk is inert — nothing reads it — and
`rm` is the whole cleanup. `tick-verdicts.jsonl` is untouched: it is still one
append-only history log for every phase, and `readTickVerdicts` /
`readLatestVerdictsSync` still serve it unchanged.

## 8. The default schedule is build first, and every live slice wakes

The package's declared phase order is now `[build, ...planSlices]`, the
sweep last of the slices, and the default `handoff` answers with every
slice whose window is live plus build whenever anything is pickable —
where before it named the first live slice on a ladder and build only when
no slice was.

Why: each phase is a worker now. `supervisorPolicy.maxTicks` says how many
run at once, and declared order is the priority when the budget is short.
At the engine default of one, that order *is* the schedule, so build now
outranks every plan slice: a queue with pickable work builds, and the drain
runs when build declines or when a refusal routes to it. Under the old
ladder the inbox ran between every wave.

**What changes for you.** Nothing in code; the schedule is the package's.
If your chain relied on a plan slice running after every build tick — a
drain you expected to fold notes before the next wave — that now happens
when build has nothing pickable, or on the next iteration once you raise
`maxTicks` above one and the drain runs beside build. A declared `handoff`
still replaces the wake set, and still runs beneath the two floors: the
per-entry refusal and the stop write after a contract-touching ship.

```ts
// .flume/declaration.ts — optional: run a build wave beside one plan slice
supervisor: { maxParallel: 2, maxTicks: 2 },
```

Two ticks at once means two agents plus a wave's width; the judge suites
serialize under the ship lock, so memory grows by the agents, not the
suites.

## 9. An unknown `--phase` exits 2

`flume tick --phase <name>` names the phase a child runs — the supervisor
uses it for every child it starts. A name the chain does not declare is
refused before any work at exit **2**, the usage class every verb shares,
where `tick` first shipped it at 1. `wake`, `sleep`, and `render` already
answered 2 for the same refusal.

```sh
grep -rn 'tick.*--phase' --include='*.sh' --include='*.yml' .   # any script reading the code
```

A script keying on exit 1 for this case reads 2 now; nothing else moves.
The supervisor never spawns a child for an undeclared phase — it reports an
orphaned baton flag itself — so the code is argv's alone.
