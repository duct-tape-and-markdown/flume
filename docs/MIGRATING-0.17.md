# Migrating to 0.17.0

**This note covers `0.16.x` → `0.17.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.16.md`](MIGRATING-0.16.md), which walks
`0.15.0` → `0.16.0`; before it, [`MIGRATING-0.15.md`](MIGRATING-0.15.md)
(`0.14.0` → `0.15.0`) and the notes behind it. If your pin is below `0.16.0`,
work those first and return here. The one item on the previous page that is
due whether or not you take this upgrade is its § 0, the `package.json`
beside your `chain.ts`, without which an ESM-only package stops loading under
`tsx` on node 22.23 and later.

From **0.16.x**. **Two breaking changes, and neither is in the API.** No type
moves, no field is renamed, and a chain that compiles against `0.16` compiles
against `0.17` untouched. What changed is the on-disk format of two files the
engine writes to guard a running loop — so that break is between *versions
sharing a state root*, not between your chain and the package — and, for a
consumer of the harness package, where its plan slices keep open questions.

Note that **a caret range on a `0.x` version pins the minor** — `^0.16.0`
resolves within `0.16.x` and will never pick up `0.17.0` on its own. Change
the pin explicitly.

## Which sections apply to you

```sh
grep -rn "loop\.pid\|tip-claims" --include='*.ts' --include='*.mjs' .   # § 2
ls "$(git rev-parse --show-toplevel)"/.flume/plan/open-questions.md       # § 3
```

§ 1 applies to every consumer and has no symbol to grep for: it is about how
you take the upgrade, not about what your chain says. § 2 applies only to a
chain, script, or monitor that reads either guard file itself. § 3 applies to
a consumer of the harness package whose state root still carries the page —
adjust the path if your state root is not `.flume`. § 4 applies to every
consumer of that package and needs nothing done up front; read it if anything
you wrote reads a build tick's park.

## 1. Stop every running loop before you upgrade a shared state root

**Affects** anyone who can have two flume versions running against one state
root (`<flumeDir>`, and `loop.pid` under it) or one git common dir (the tip
claims under `.git/flume/tip-claims/`). Two checkouts of one repo, a job dock
shared between a terminal and a CI runner, an in-place `pnpm up` while a loop
is mid-run.

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
