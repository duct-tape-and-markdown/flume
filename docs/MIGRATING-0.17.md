# Migrating to 0.17.0

**This note covers `0.16.x` → `0.17.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.16.md`](MIGRATING-0.16.md), which walks
`0.15.0` → `0.16.0`; before it, [`MIGRATING-0.15.md`](MIGRATING-0.15.md)
(`0.14.0` → `0.15.0`) and the notes behind it. If your pin is below `0.16.0`,
work those first and return here. The one item on the previous page that is
due whether or not you take this upgrade is its § 0, the `package.json`
beside your `chain.ts`, without which an ESM-only package stops loading under
`tsx` on node 22.23 and later.

From **0.16.x**. **One breaking change, and it is not in the API.** No type
moves, no field is renamed, and a chain that compiles against `0.16` compiles
against `0.17` untouched. What changed is the on-disk format of two files the
engine writes to guard a running loop — so the break is between *versions
sharing a state root*, not between your chain and the package.

Note that **a caret range on a `0.x` version pins the minor** — `^0.16.0`
resolves within `0.16.x` and will never pick up `0.17.0` on its own. Change
the pin explicitly.

## Which sections apply to you

```sh
grep -rn "loop\.pid\|tip-claims" --include='*.ts' --include='*.mjs' .   # § 2
```

§ 1 applies to every consumer and has no symbol to grep for: it is about how
you take the upgrade, not about what your chain says. § 2 applies only to a
chain, script, or monitor that reads either guard file itself.

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
