# Migrating to 0.22.0

**This note covers `0.21.x` → `0.22.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.21.md`](MIGRATING-0.21.md), which walks
`0.20.x` → `0.21.0`. If your pin is below `0.21.0`, work that note first.

Nine breaks. Two of them live in your queue files rather than your code, and
the first must be fixed **before** you upgrade. The rest are at the
chain-authoring surface, and most chains hit only one or two. Then the
behavior changes worth knowing before the first run.

**Upgrade from a stopped loop.** Run `flume stop`, let the in-flight tick
finish, then do section 1, then upgrade and remove the stop flag. The
supervisor stays resident at its launch version, and this release changes the
shape of every queue entry and adds a second marker directory to the baton.

## 1. Strip `priority` from every queue file before upgrading

The entry core no longer has a `priority` field, and the core is strict: a
queue file that still carries the key is refused at the queue read, and the
tick exits 69. A run with more than one tick in flight (`maxTicks` above 1)
can start a build tick beside the plan slice that would have repaired the
file; the build tick exits 69 on the old key. 0.22 re-reads the queue before
it ends the run over that 69, so a repair that has landed by then spares the
run, but the tick is still lost and a repair that has not landed yet ends the
run. Stripping the key first avoids both. 0.21 reads a file without `priority` as priority 0, so the strip is safe
to make while you are still on 0.21.

**What to do.** From the repository root, with the loop stopped and still on
0.21, run this over your queue directory (`.flume/plan/pending` unless you
relocated the state root):

```sh
node -e 'const fs=require("fs"),path=require("path"),dir=process.argv[1];for(const f of fs.readdirSync(dir)){if(!f.endsWith(".json"))continue;const p=path.join(dir,f),e=JSON.parse(fs.readFileSync(p,"utf8"));if(!("priority" in e))continue;delete e.priority;fs.writeFileSync(p,JSON.stringify(e,null,2)+"\n");console.log("stripped "+f)}' .flume/plan/pending
```

It rewrites only the files that carry the key, prints each one, and leaves
every other field as it was (re-indented to two spaces). On Windows, run it
from Git Bash; `cmd` and PowerShell do not read the single quotes. Commit the
result: the queue is read from the committed tip, not the working tree. After
upgrading, `flume check` confirms the queue parses.

If you write your own plan prompts, remove any instruction to file a
`priority`, or every new entry will be refused. A prompt built on
`renderSchemaForPrompt` already states the new shape. To keep ordering by a
number of your own, declare it as a field in your chain's `entryExtension`
and sort by it in `Chain.order` — `docs/CHAIN-AUTHORING.md`, *Ordering the queue
(`Chain.order`)*, has the example — and you can keep the key instead of stripping it. Harness consumers
should strip it: the package orders by goals (section 10) and reads no
per-entry number.

## 2. Harness package: a `laneTests[]` line must name a declared CI lane

A `laneTests[]` line's `lane` is now checked against the lanes your
declaration's `ci` carries. A line naming any other lane is refused at the
queue read, the same way as section 1, and a declaration with no `ci` can carry
no `laneTests[]` line at all. A line naming a lane nothing reports would be
owed forever.

**What to do.** Before upgrading, search your queue for `laneTests` lines and
check each `lane` against your declaration's `ci` names. Fix the name, add the
lane to `ci`, or move the line's case into `tests[]` if the build host can run
it.

## 3. `Phase.shipped` returns the tags a span ships

`shipped` now returns `readonly string[]` — the tags that leave the queue,
drawn from the entry and its steps (`ShipContext.steps`) — instead of a
boolean. Undeclared still ships everything, and the harness package's own
`shipped` is already updated.

**What to do.** Translate the boolean:

```ts
// before
shipped: (ctx) => didFinish(ctx),
// after
shipped: (ctx) =>
  didFinish(ctx) ? [ctx.entry.tag, ...ctx.steps.map((s) => s.tag)] : [],
```

Naming a tag outside the span, or naming the entry without all of its steps,
is refused: nothing leaves the queue and the refusal is reported on the tick.

## 4. Ticks load only the repository's Claude Code settings

The `claudeCode` adapter now passes `--setting-sources project`, so a tick
reads only the settings, instructions, rules and hooks the repository carries.
Before, a tick also read the operator's own (user-level) settings, which meant
two hosts could run differently off the same commit. A settings file a
declared `budget` composes still applies.

**What to do.** Move anything a tick needs out of your user-level settings and
into the repository's `.claude/`. If you need the old behavior, opt in:

```ts
claudeCode({ inheritUserSettings: true /* … */ });
```

Harness consumers set the same key per phase on the declaration's `agents` row.

## 5. Globs that open with `!` or hold `{a,b}` are refused at load

flume's matcher understands `*` and `**` only. A leading `!` and a brace set
`{a,b}` are literal characters to it, so a glob spelled that way matched only
a path containing those characters — never what its author meant. Chain load
now refuses them in a phase's `writablePaths` and `entryChannelPaths` and in
`supervisorPolicy.partitionIgnore`, naming the glob. The harness declaration
refuses them in every glob list it reads (`fence`, `channelPaths`,
`specLocus`, the sweep lists), naming the field and the index.

**What to do.** Spell the set out, one glob per branch:

```ts
// before
partitionIgnore: ["{pnpm-lock.yaml,package.json}"],
// after
partitionIgnore: ["pnpm-lock.yaml", "package.json"],
```

There is no negation form: list the paths you mean to admit instead.

## 6. Footprint helpers take the queue

A `work` entry's footprint is now its own `files` plus its steps', and only
the whole queue can say what its steps are. `touchedPaths` (on the package root
and on `api`) takes `(listing, entry)`, and `PartitionOptions` for
`partitionByFileOverlap` requires a `listing`.

**What to do.** Pass the queue you already hold:

```ts
// before
api.touchedPaths(entry);
api.partitionByFileOverlap(entries, { maxParallel, ignore });
// after
api.touchedPaths(queue, entry);
api.partitionByFileOverlap(entries, { maxParallel, ignore, listing: queue });
```

## 7. Harness package: `entryExtension` takes a context, and two field names are taken

`entryExtension(consumer, lanes)` is now
`entryExtension(consumer, { lanes, ci })`, typed `ExtensionContext`; `ci` is
what `laneTests[]` lines are checked against (section 2). The package also
declares two new entry fields, `rank` (section 10) and `interface`, and a
consumer `entryFields` declaring either name is refused at load with
`EntryFieldRemovalError`.

**What to do.** Only code calling `entryExtension` directly changes — the
package's own factory already passes both:

```ts
// before
entryExtension(myFields, runner.lanes);
// after
entryExtension(myFields, { lanes: runner.lanes, ci: declaration.ci });
```

Rename a consumer field called `rank` or `interface`.

## 8. `Gate` and `AgentResult` are unions

`Gate` is now `SingleSpanGate | BatchingGate`, keyed on a `batches` flag, so a
merge can hand several entries to the gates that say they can read them
(section 11). A gate written as before is a `SingleSpanGate` and needs no
change. `AgentResult` now states how the process ended: `{ exitCode }`, or
`{ exitCode: null, signal }` for a signal kill. An agent returning a plain exit
code needs no change.

Two type-level patterns stop compiling:

- **A wrapper that spreads a built-in shell gate** (`shellGate`, `tscGate`,
  `vitestGate`, `eslintGate`) and replaces `run` with one typed over
  `GateContext`. The built-ins now declare `batches: true`, and the spread
  carries the claim onto a `run` that cannot honor it.
- **An `interface` that `extends AgentResult`.** An interface cannot extend a
  union.

**What to do.** In the wrapper, declare that it reads one entry:

```ts
const wrapped: Gate = { ...vitestGate, batches: false, run: (ctx: GateContext) => /* … */ };
```

For `AgentResult`, use a type intersection:
`type MyResult = AgentResult & { extra: string }`.

## 9. Harness package: filing bands are gone

0.21 filed each entry at its source's priority band, and a `filing band` gate
held each plan slice to its band. Both are removed, along with the band
clauses in the slice prompts. Where an entry came from no longer orders it.

**What to do.** Nothing in code. If a downstream report needs to be served
first, file a goal for it (section 10) — that is now the only lever.

## 10. The order is computed, and goals carry the only rank

With `priority` gone, the queue's order is computed:

- **Engine default** (no `Chain.order`): oldest filing first, then tag. An
  entry's filing time is the first commit that added its file, so renaming a
  tag no longer moves it. A chain that wants another policy declares
  `Chain.order`; it is handed the whole queue, the `blockedBy` graph, filing
  times and the entries in flight, and must return the same entries reordered.
- **Harness package**: work under an operator's goal first, in the goals' rank
  order, together with everything that work is `blockedBy`; then the work with
  the longest chain waiting behind it; then oldest filing; then tag.

A goal is a root `group` entry carrying a `rank` (a whole number, lowest
first). Only `plan-inbox` files or re-ranks one, and only from a record: the
`goal rank` gate reverts any other commit that adds or moves a rank, or puts
one anywhere but a root group. `plan-derive` files `work` (and `step`)
entries beneath goals. A goal leaves the queue with its last descendant.

**What to do.** To steer the loop, drop a record into your inbox directory
stating the goal, what is waiting on it, and its rank among the goals
standing, and commit it — a record counts once committed. For example:

```md
# Goal: the export API ships

**Goal, rank 1.** What waits on it: the 2.0 integration. The section it
serves: `spec/api.md`, *Export*.
```

Re-rank the same way: a record that names the goal and its new rank. A queue
with no goals is served oldest-filing-first, as before.

## 11. Behavior changes a consumer notices first

- **`flume hold <phase>` is the lasting off-switch; `sleep` is not.**
  `sleep` clears the awake flag, and the next handoff can wake the phase again.
  `hold` clears the flag *and* writes `<state root>/held/<phase>`, and while it
  stands no handoff wakes the phase and neither the supervisor nor a bare
  `flume tick` runs it. `flume tick --phase <name>` still runs it by hand;
  `flume wake <phase>` lifts the hold. A run whose every awake phase is held
  ends with `all-held`.
- **Every run records how it ended.** `<state root>/run-end.json` holds the
  reason (`hibernation`, `stop-flag`, `tick-budget`, `abort-threshold`,
  `signal`, `all-held`, and the walls), the signal or exit code where one
  applies, and the time. `flume status` prints it as `last run end: …`. A run
  killed with no chance to clean up records nothing, and status says so beside
  the stale `loop.pid`.
- **A closed terminal ends a run cleanly.** `SIGHUP` (and `SIGBREAK` on Windows)
  now tear the run down like Ctrl-C, releasing the loop lock and tip claim,
  instead of killing the supervisor and leaving both behind.
- **`flume exclusive -- <command>`** runs a command holding the ship lock —
  the safe moment to land a hand fix or a merged remote change on trunk while
  the loop runs — and exits with the command's own code.
- **`flume status` has more rows:** held phases, the last run end, one row per
  standing goal, and a final `flow:` row (median filing-to-ship time, longest
  current wait, failed merges per ship). A script reading status line by line
  should expect them.
- **Salvaged files end in `.reverted`.** A file saved from a reverted commit
  under `<state root>/prior-attempts/<key>.reverted/` now carries the suffix
  on its own name too, so test runners no longer collect it. Drop the suffix to
  recover the file.
- **The state root's `.gitignore` gains `held/` and `run-end.json`.** `flume
  loop` appends them on its first start; commit the change.
- **Batched merges are opt-in.** `supervisorPolicy.mergeBatch` (harness:
  `supervisor.mergeBatch`) defaults to 1, the serial behavior. Above 1, a phase
  batches only where every `afterMerge` gate declares `batches: true`.
- **`gatedTip`** on the tick verdict and `TickResult` names the trunk tip the
  tick's last ship left after every gate passed. A step that delivers trunk
  elsewhere should read it rather than inferring the tip from commit subjects.
