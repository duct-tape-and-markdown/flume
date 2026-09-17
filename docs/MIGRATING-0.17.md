# Migrating to 0.17.0

**This note covers `0.16.x` → `0.17.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.16.md`](MIGRATING-0.16.md), which walks
`0.15.0` → `0.16.0`; before it, [`MIGRATING-0.15.md`](MIGRATING-0.15.md)
(`0.14.0` → `0.15.0`) and the notes behind it. If your pin is below `0.16.0`,
work those first and return here. The one item on the previous page that is
due whether or not you take this upgrade is its § 0, the `package.json`
beside your `chain.ts`, without which an ESM-only package stops loading under
`tsx` on node 22.23 and later.

From **0.16.x**. **Seven breaking changes, and four of them are the job
surface coming out.** Three are in the API, and the compiler catches every
one: one field off a result type (§ 5), one off `Chain` (§ 8), one off
`DispatcherOptions` (§ 9) — no type moves, and nothing is renamed. Two are
the command line, where nothing catches them for you: four `job` verbs and
two state-root selectors, each now an exit `2` (§§ 6–7) except the one env
half that fails silently. The last two touch neither: the on-disk format of
two files the engine writes to guard a running loop — so that break is
between *versions sharing a state root*, not between your chain and the
package — and, for a consumer of the harness package, where its plan slices
keep open questions.

**§§ 6–9 are one cut seen from four sides.** The engine partitions no state
below a checkout any more: it mints no per-effort state root, seeds none
from a chain declaration, removes none, offers no selector that retargets
one, and folds no per-effort level into a fanout branch or worktree path. A
repository running several efforts at once gives each one a checkout of its
own. Read § 6 first — the other three are what that leaves behind on the
chain, the dispatcher, and the command line.

Note that **a caret range on a `0.x` version pins the minor** — `^0.16.0`
resolves within `0.16.x` and will never pick up `0.17.0` on its own. Change
the pin explicitly.

## Which sections apply to you

```sh
grep -rn "loop\.pid\|tip-claims" --include='*.ts' --include='*.mjs' .    # § 2
ls "$(git rev-parse --show-toplevel)"/.flume/plan/open-questions.md       # § 3
grep -rn "readWorktreeRegistry\|WorktreeRegistry" --include='*.ts' .      # § 5
ls "$(git rev-parse --show-toplevel)"/.flume/jobs                         # § 6
grep -rn -e 'flume job' -e '--job' -e FLUME_JOB --exclude-dir=.git .      # §§ 6–7
grep -n "seedDir" .flume/chain.ts                                         # § 8
grep -rn "new Dispatcher" --include='*.ts' .                              # § 9
```

§ 1 applies to every consumer and has no symbol to grep for: it is about how
you take the upgrade, not about what your chain says. § 2 applies only to a
chain, script, or monitor that reads either guard file itself. § 3 applies to
a consumer of the harness package whose state root still carries the page —
adjust the path if your state root is not `.flume`. § 4 applies to every
consumer of that package and needs nothing done up front; read it if anything
you wrote reads a build tick's park. § 5 applies to a chain that asks the
engine which worktrees git registers.

§ 6 applies to anyone who ran a `job` verb or whose repository still carries
a `.flume/jobs/` tree; § 7 to any invocation, CI step, shell alias, unit
file, or Makefile that passes `--job` or exports `FLUME_JOB` — which is why
that grep is not scoped to `*.ts`, and why `FLUME_JOB` is the token worth
hunting hardest: it is the one that now does nothing rather than refusing.
§ 8 applies to a chain declaring `seedDir`. § 9 applies to an embedder
constructing a `Dispatcher` itself, and — with no symbol to grep for — to
anything of yours that spells a fanout branch or worktree path, which lose a
level; read it too if a 0.16 run left worktrees on disk. Your typecheck names
§§ 5, 8, and 9's call sites whether or not the greps do.

## 1. Stop every running loop before you upgrade a shared state root

**Affects** anyone who can have two flume versions running against one state
root (`<flumeDir>`, and `loop.pid` under it) or one git common dir (the tip
claims under `.git/flume/tip-claims/`). Two checkouts of one repo, one state
root reached from both a terminal and a CI runner, an in-place `pnpm up`
while a loop is mid-run.

**What changed.** Both guards now state two facts about their holder instead
of one:

```
12345
2026-09-16T10:11:12.345Z
```

The pid is on the first line, where every reader has always looked; the
instant the holder took the guard is on the second. `flume status` reads that
instant to bound the live run's agent spend, which it previously took from
`loop.pid`'s **mtime** — a filesystem property no writer contracts and that a
restore from backup, a state-root copy, or a stray `touch` moves under a
running loop.

**Why it breaks across versions.** A `0.16` reader takes the file *entire* and
numbers it. Over a two-line file that is `NaN`, which it reads as "no usable
pid" — the stale-lock reading — and a stale lock is **reclaimed silently**. So
a `0.16` `flume loop` or `flume tick` started against a state root a `0.17`
supervisor is holding does not refuse: it takes the lock out from under the
live run, and both write to the same root. The reverse direction is safe: a
`0.17` reader takes the first line, so a single-line lock written by `0.16`
still names its holder and still refuses.

**What to do.** Drain, then upgrade:

1. `flume status` in each checkout that shares the root — no
   `supervisor pid N live`, no `tip claimed by pid N`.
2. Upgrade **every** checkout and runner that can reach that state root or
   that `.git`, in one go. A half-upgraded fleet is the only configuration
   this break can bite.
3. Start the loop again.

A stale `loop.pid` or tip claim left over from `0.16` needs no cleanup: the
`0.17` reader takes its first line, finds the pid dead, and reclaims it the
way it always has.

**One cosmetic consequence, if you skip step 1 anyway.** A `0.17` `flume
status` over a lock a `0.16` supervisor is still holding finds no stated
instant, so it has no window to bound the run's spend by. It reports the
supervisor live as usual, withholds the `agent usage this run:` line, and
says why on stderr rather than totalling every previous run's spend into
this one's. The next run's lock states its instant and the line returns.

## 2. A chain that reads either guard file itself takes the first line

**Affects** a chain, hook, script, or shell monitor that opens `loop.pid` or a
tip-claim file directly. Nothing in the engine's API is involved, which is why
no compiler catches this.

Before — reads the file whole, and now yields `NaN`:

```ts
const pid = Number(readFileSync(join(flumeDir, "loop.pid"), "utf8").trim());
```

After — the pid is the first line:

```ts
const [first = ""] = readFileSync(join(flumeDir, "loop.pid"), "utf8").split("\n");
const pid = Number(first.trim());
```

In a shell, `head -n 1` where the whole file was read.

The same shape applies to the claim instant if you want it: the second line is
an ISO-8601 timestamp, and `Date.parse` of it is the instant the holder took
the guard. Treat it as optional — a file written before this version states no
second line, and a reader that refuses without one refuses a live holder.

**Prefer not reading either file at all.** What the engine knows about a run's
guards it reports: `flume status` prints supervisor liveness, the current
tip's claim and the live run's spend observationally and exits `0` whatever
the state, which is what makes it safe in a prompt or a watch loop
([`CLI.md`](CLI.md)).

## 3. Open questions are one file each under `plan/questions/`

**Affects** a consumer of the harness package (`@dtmd/flume/harness`) whose
state root carries `plan/open-questions.md`. Nothing in the engine is
involved, and a chain that does not use the package's plan slices keeps
whatever park file it declared.

**What changed.** An open question is a **file**, present while the question
is open and deleted when it is answered — the shape the inbox and note queues
already have. The three plan slices are shown that directory's listing where
they used to be shown headings grepped out of a single page, so no slice
reads a status out of a word any more, and two sessions opening two questions
write two files instead of conflicting on one.

**What to do.** Give each question still open in the page its own file under
`<stateRoot>/plan/questions/`, named for the question it asks, and delete the
page in the same commit. A plan tick can do it: the slice fence still admits
the old page for exactly that commit, and while the page is on disk the
questions block names it rather than reporting nothing open, so the migration
cannot be passed over silently. Nothing needs creating up front — a state
root with no directory reads as nothing open, and the first question opened
creates it.

**The allowance is temporary.** The fence line that lets a plan commit delete
the page is retired in the release after this one. A page still on disk then
is a file no plan phase can touch, and the questions it holds are invisible
to every slice.

## 4. A build tick parks by writing under `plan/notes/parked/`

**Affects** a consumer of the harness package (`@dtmd/flume/harness`). The
engine is not involved: `shipped` is a chain-side predicate either way
([`CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md)).

**What changed.** A park used to be read off the *shape* of a build commit —
the entry's note at `plan/notes/<TAG>.md` and no other path. It is now read
off **where** the note sits: a tick that cannot ship its entry writes
`plan/notes/parked/<TAG>.md`, and that path in the commit is the park,
whatever else the commit touched. A note at `plan/notes/<TAG>.md` is an
observation for the next plan tick, and its entry leaves the queue as
shipped.

Two behaviors follow. A refusal that could not help leaving a file behind —
a half-finished edit, a test it had to touch to reach the wall — is still a
refusal, where before it shipped the entry with the work undone. And a tick
with something to tell plan and nothing to refuse no longer has to strip its
commit to say so.

**What to do.** Nothing up front. The package's build fence and entry
channel admit both directories, the build prompt names both paths, the
records gate admits either under the tick's own tag, and the drain lists a
park with every other record. Two things are worth checking: anything of
yours that reads `plan/notes/` — an ignore rule, a dashboard, a script —
sees a `parked/` subdirectory in it now; and a note left on disk by a park
taken before the upgrade sits at `plan/notes/<TAG>.md`, where the drain now
reads it as an observation. Its entry is still in the queue — a park keeps
it there and nothing re-picks it out — so the only cost is a misread kind
at the drain. Move such a note down a directory before the next plan tick,
or say what it was in that tick's commit body.

## 5. `readWorktreeRegistry` reports a map of worktrees, not a set of paths

**Affects** a chain that calls `api.git.readWorktreeRegistry` or names the
`WorktreeRegistry` type — most often one reclaiming a per-worktree resource a
killed tick never released
([`CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md)). The compiler catches every call
site; nothing fails silently.

Before:

```ts
if (registry.paths.has(resolve(worktreePath))) continue; // still live
```

After:

```ts
if (registry.worktrees.has(resolve(worktreePath))) continue; // still live
```

**What changed.** The read branch is now `{ read: true, worktrees }`, a
`ReadonlyMap` keyed by the same absolute, resolved paths the set held — so
membership is still `has`, and `[...registry.paths]` becomes
`[...registry.worktrees.keys()]`. Each value is the branch that worktree is
checked out on, in the short form `git branch -D` takes, and `undefined` for
a detached checkout. The failure branch, `{ read: false, reason }`, is
untouched.

**Why.** The startup sweep used to delete `flume/**` branches by name, which
is not the same set as the residue it removed: two checkouts of one
repository sweep against one shared ref namespace, so a name match reached a
live branch the sweep never provisioned. The sweep now reaps exactly the
branches the directories it removed were checked out on, and that pairing is
git's own fact — reported here rather than left for each caller to rebuild
from a ref glob.

## 6. The four `job` verbs are gone — an effort is a checkout

**Affects** any script, alias, CI step, or runbook that invokes `flume job`,
and any repository still carrying the `.flume/jobs/<name>/` state roots those
verbs created. Nothing in the engine's API is involved, which is why no
compiler catches this; nothing on disk is touched by the upgrade either.

**What changed.** `job` is an ordinary unknown command:

```sh
flume job run alpha
# unknown command: job
# Run `flume --help` for usage.                                     (exit 2)
```

A job was a second state root under one checkout — `.flume/jobs/<name>/`,
tracked in the working tree, on whatever branch the operator was on. Two
efforts sharing a checkout share its tip, and the tip claim serializes them
whatever their files are called, so the partition bought separate files and
no separate execution. The engine now mints no state root beneath a
checkout, seeds none, and removes none.

Before, and what stands in for it:

| `0.16` | `0.17` |
| --- | --- |
| `flume job new <name>` — load the chain, copy its `seedDir` into `.flume/jobs/<name>/`, merge the runtime ignores into that dir's `.gitignore`, pin `core.longpaths` (win32), baseline-commit the result | `git worktree add` a checkout, whose tree carries its own `.flume/`. The seed copy is § 8; the ignore merge happens at every `loop` start already; `core.longpaths` is repo-local and the engine pins it before every worktree it adds, so a repository that has run one fanout wave on win32 already carries it |
| `flume job run <name> [--max N]` | `flume loop [--max N]` in that checkout |
| `flume job status` — one line per job dir | `flume status` in each checkout (plus `flume friction` for its friction count) |
| `flume job rm <name>` — `git rm -r` the dir and commit the removal | `git worktree remove` the checkout, then `git branch -D` its branch once you are done with the history |

So, before:

```sh
flume job new alpha
flume job run alpha --max 20
flume job status
flume job rm alpha
```

After — every step is git's or yours, and none is the engine's:

```sh
git worktree add -b alpha-wip ../repo-alpha
cd ../repo-alpha
flume loop --max 20
flume status
cd - && git worktree remove ../repo-alpha && git branch -D alpha-wip
```

**What to do with a `.flume/jobs/` tree you already have.** The upgrade
deletes nothing, and a job dir is an ordinary state root — `FLUME_DIR`
pointed at one keeps it running exactly as it ran (§ 7), which is the
zero-work option and the one to take if a queue is mid-flight. To finish the
move, give the effort a checkout and let its own `.flume/` carry the queue.
When an effort is done, `git rm -r .flume/jobs/<name>` — the engine removes
no state root, so nothing else will.

The history a job produced is untouched by any of this: the commits it caused
are on whatever branch it ran on, and integrating or discarding them is an
ordinary git operation.

## 7. `--job` and `FLUME_JOB` select nothing; `FLUME_DIR` is the only relocator

**Affects** every invocation that passes `--job <name>` and every environment
that exports `FLUME_JOB` — including one that only ever used the selector to
reach a state root, and never ran a `job` verb.

**What changed.** `--job <name>` was extracted from argv wherever it appeared
and resolved the state root to `<repoRoot>/.flume/jobs/<name>`; `FLUME_JOB`
was its env half; an explicit `FLUME_DIR` standing beside either was a usage
error; and the resolved name was written back into the environment so
loop-spawned tick children inherited it. All of that is gone. `FLUME_DIR`
alone moves the state root, `FLUME_CONFIG_DIR` alone moves the chain and
prompts dir, and the write-back set is those two plus the
`FLUME_DIR_RESOLVED_FOR` provenance stamp ([`CLI.md`](CLI.md), *State-root
and config-dir resolution*).

**How each half fails.** The flag refuses, in the two positions it could be
typed:

```sh
flume --job alpha status     # unknown command: --job                (exit 2)
flume tick --job alpha       # usage: flume tick                     (exit 2)
```

Leading, it is an unknown command; trailing, it is the verb's own
stray-positional refusal. Neither silently resolves a root, and the
`FLUME_DIR`-beside-`--job` conflict that used to exit `2` cannot arise — if
a wrapper of yours caught that exit code, it now has nothing to catch.

**`FLUME_JOB` is the quiet one.** It is now a string the resolution neither
reads nor writes, so a runner that exports it gets the *default* state root
with no error at all, and a loop-spawned tick child no longer inherits the
name. A CI step whose only mention of jobs was `FLUME_JOB=nightly` starts
writing into `<repoRoot>/.flume` the first time it runs under `0.17`. Grep
for it before you upgrade, not after.

Before:

```sh
flume --job alpha status
FLUME_JOB=alpha flume loop --max 20
```

After — the same state root, named outright:

```sh
JOB="$(git rev-parse --show-toplevel)/.flume/jobs/alpha"
FLUME_DIR="$JOB" flume status
FLUME_DIR="$JOB" flume loop --max 20
```

That keeps an existing job dir running verbatim; § 6 is the shape to move to.
Give `FLUME_DIR` an absolute path as above — a set-but-relative value
resolves against the current working directory, not the repository root.

## 8. `Chain.seedDir` is off the chain surface

**Affects** a chain declaring `seedDir`. The compiler catches it: a factory
returning a chain literal that names the field reds at the return, since
`Chain` no longer declares it.

`seedDir` named a `configDir`-relative directory that `flume job new` copied
into each new job dir, verbatim and skip-existing. With no verb minting a
state root (§ 6), the field had no reader.

Before:

```ts
export default (api: FlumeApi): ChainModule => ({
  chain: {
    phases: [plan, build],
    seedDir: "job-seed",
    friction: "friction",
  },
});
```

After — drop the field; nothing else on `Chain` moves. `friction` and
`pendingPath`, whose doc comments used to describe themselves as the same
idiom as `seedDir`, are untouched and keep resolving against the resolved
state root exactly as before:

```ts
export default (api: FlumeApi): ChainModule => ({
  chain: {
    phases: [plan, build],
    friction: "friction",
  },
});
```

The directory the field named is now ordinary files. Nothing deletes it, and
seeding a fresh checkout's state root from it is a copy you run:

```sh
cp -rn .flume/job-seed/. ../repo-alpha/.flume/   # what `job new` did, by hand
```

`-n` is the skip-existing half of what the verb promised: a stub added to the
template reaches a checkout that lacks it, and a file already worked on is
never clobbered.

## 9. `DispatcherOptions.namespace` is gone; a fanout branch and worktree lose a level

**Affects** an embedder that constructs a `Dispatcher` itself and passes
`namespace` — the compiler catches that one — and, with no symbol to grep
for, anything of yours that spells a fanout branch or worktree path: a
cleanup script, a branch-protection pattern, a CI ref filter, a dashboard.

**What changed.** `namespace` folded a name — the CLI resolved it from
`FLUME_JOB` (§ 7) — into every fanout branch and every worktree path, and
into the level the startup sweep read and a gate's base checkout planted at.

| | `0.16` with a namespace set | `0.17` |
| --- | --- | --- |
| fanout branch | `flume/<namespace>/<slug>` | `flume/<slug>` |
| worktree path | `<base>/<namespace>/<dirName>` | `<base>/<dirName>` |

Before:

```ts
const dispatcher = new Dispatcher({ repoRoot, configDir, agent, namespace: jobName });
```

After:

```ts
const dispatcher = new Dispatcher({ repoRoot, configDir, agent });
```

Nothing replaces it. Two efforts are two checkouts, each with its own state
root and so its own worktree base, so identical tag slugs in two efforts
already address two directories; the level bought nothing, and under a base
an operator deliberately *shares* between checkouts it only moved the
collision one directory down.

**If you share one `FLUME_WORKTREES_DIR` between checkouts**, that collision
is now at the surface: the tick whose path is already occupied is refused by
`createWorktree`'s registry judgment, naming the path, rather than removing
an occupant git disclaims. Give each checkout its own base — the default,
`<flumeDir>/worktrees/`, already is one.

**A `0.16` run's worktrees are residue the `0.17` sweep will not reach.** The
startup sweep reads the *top-level* entries of its base and removes the ones
git registers as worktrees of this repository. A namespaced tree sits one
level down, so the sweep sees only `<base>/<namespace>/` — a plain directory
git calls no worktree of anything — and leaves the subtree standing, along
with the branches those trees hold. Clear it once, before or after the
upgrade:

```sh
git worktree list                                  # what git still registers
git worktree remove <base>/<namespace>/<dirName>   # per surviving tree
git worktree prune
git branch -D flume/<namespace>/<slug>             # per branch they held
```
