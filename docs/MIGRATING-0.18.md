# Migrating to 0.18.0

**This note covers `0.17.x` → `0.18.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.17.md`](MIGRATING-0.17.md), which walks
`0.16.x` → `0.17.0`; before it, [`MIGRATING-0.16.md`](MIGRATING-0.16.md)
(`0.15.0` → `0.16.0`) and the notes behind it. If your pin is below `0.17.0`,
work those first and return here. The item on the previous page that is due
whether or not you take this upgrade is
[clearing a pre-`0.17` worktree by hand](MIGRATING-0.17.md#10-a-worktree-is-stamped-with-the-state-root-that-provisioned-it)
— a tree provisioned before the state-root stamp carries none, so no startup
sweep will ever reach it and every start names it in a warning.

From **0.17.x**. **One breaking change, and it is in the API.** A field comes
off the `gate-revert` prior-attempt record — the engine's suspect-flake
marker — and the attribution it derived is now a gate's own declaration
(§ 1). No type moves and nothing is renamed: one field goes, one arrives on
the surface the gate returns. The compiler names a TypeScript read of the
retired field; a script reading the record's JSON off disk is the half
nothing catches.

**This page is the `0.18` line's census as it stands, not the cut's.** A
break landing on `0.18` after this one joins the page as it ships, and the
`### Breaking` section of the release's own entry in
[`CHANGELOG.md`](../CHANGELOG.md) is the complete list at the cut — read it
beside this page if `0.18.0` has been released by the time you arrive here.

Note that **a caret range on a `0.x` version pins the minor** — `^0.17.0`
resolves within `0.17.x` and will never pick up `0.18.0` on its own. Change
the pin explicitly.

## Which sections apply to you

```sh
grep -rn "suspectFlake" --include='*.ts' --include='*.js' --include='*.mjs' .  # § 1
grep -rn "failingFiles" --include='*.ts' .                                     # § 1
```

§ 1 applies twice over, and both greps are worth running. The first finds
every reader of the retired field: a `shouldRun` or `handoff` keying a retry
on it, a `refusesEntry` predicate reading the entry's own record, a dashboard
or script opening a file under `<flumeDir>/prior-attempts/`. The second finds
every gate of yours that fed the derivation — a gate naming `failingFiles`
kept its field, but the marker it used to earn is no longer computed from it,
so a chain that read one without declaring the other now reads nothing at
all. Your typecheck names every TypeScript site of the first grep whether or
not it matches; the JSON reader is what the grep is for.

## 1. `GateRevertAttempt.suspectFlake` is gone; a gate declares `blamesSpan: false`

**Affects** a chain that reads `suspectFlake` off a `gate-revert`
prior-attempt record, and every gate whose `failingFiles` was feeding that
marker. Nothing is renamed and nothing aliases the field: a TypeScript read
reds at the property, a JSON read finds the key simply absent.

**What changed.** The engine used to decide, on its own, whether a reverted
span could have caused the failure that reverted it. A gate naming
`failingFiles` got the record stamped `suspectFlake: true` whenever every
named file was disjoint from the span's own touched paths. That derivation is
gone, along with the field it produced. In its place the gate **states** the
attribution: `GateResult.blamesSpan: false` says "this failure is not the
gated span's", and the engine acts on the statement and infers nothing
(`spec/chain.md`, *What a gate returns*).

**Why it went, rather than being fixed.** Disjointness is not evidence. A
span's edits red a file they never touched the moment a pin reads the whole
tree — a citation scan, an export audit, a docs-against-code agreement case —
so the marker fired on real defects. And the case it was built for, a suite
already red at the span's base, usually names files the span *did* touch, so
it stayed silent exactly where it was wanted. A chain reading the field was
reading an opinion with no author.

**Before** — the gate named its files, and the engine turned the list into a
verdict:

```ts
// the gate: names what its runner blamed, and nothing more
return { ok: false, message: "suite red", failingFiles: report.failedFiles };
```

```ts
// the chain: holds a reverted entry back, unless the engine called the
// failure someone else's
refusesEntry: ({ priorAttempt: prior }) =>
  prior?.mode === "gate-revert" && !prior.suspectFlake,
```

**After** — the gate declares the attribution, and the retry reads the
declaration:

```ts
// the gate: the files it blamed, plus whether it blames the span at all
const base = await suiteAtBase(ctx); // whatever your runner can actually tell you
return {
  ok: false,
  message: "suite red",
  failingFiles: report.failedFiles,
  ...(base.red ? { verdict: "base-red", blamesSpan: false as const } : {}),
};
```

```ts
// the chain: the gate's own statement, off the record verbatim
refusesEntry: ({ priorAttempt: prior }) =>
  prior?.mode === "gate-revert" && prior.blamesSpan !== false,
```

The same two fields read the same way wherever a record reaches you — off
`EntryRefusalContext.priorAttempt` as above, off the map a `shouldRun` or
`handoff` is handed as `TickContext.priorAttempts`, or off the tick verdict's
gate row, which carries both beside the gate's `message`.

**Compare against `false`, never for truth — and this is where a mechanical
port goes wrong.** The retired field's meaningful value was the truthy one;
the new field's is the falsy one. It is typed `false` alone, because `true`
would say only what absence already says. So `!prior.suspectFlake` becomes
`prior.blamesSpan !== false` and not `!prior.blamesSpan`, which is true of
every ordinary revert; `prior.suspectFlake` becomes
`prior.blamesSpan === false` and not `prior.blamesSpan`, which is never true
at all. The same trap sits on the writing side: a
`...(result.blamesSpan ? { … } : {})` spread copied from the field beside it
drops exactly the declaration it meant to carry.

**What the declaration does.** The engine withholds the **entry-scoped half**
of the stage failure: no tag on the failure and no quarantine key, so a
run-scoped quarantine cannot hold an entry for a wall it was told the entry
did not build. That puts a fanout entry's disowned revert in the class a
singleton phase's own gate revert has always been in. What it does *not*
change: the commit is still reverted — a span that cannot be judged must not
land — and the failed tick still counts against the consecutive-failure
backstop (`spec/loop.md`, *Prior-outcome feedback to the retrying tick*).

**The record carries the gate's two statements now.** `blamesSpan` rides the
`gate-revert` record and the tick verdict's gate row verbatim, and beside it
so does `failingFiles`, which reached the verdict row before this release but
never the record. Both are copies, and the engine adds nothing to either:
what the gate blamed, and whether it blamed the span, are the gate's own
words, read back by a `shouldRun` or a `handoff` without re-parsing the prose
beside them.

**If your gates come from the harness package** (`@dtmd/flume/harness`), one
of them declares the new field for you. Its judge gate already reported a
suite red at the span's base as `verdict: "base-red"`; it now returns
`blamesSpan: false` beside that verdict. The visible consequence is that such
a revert no longer quarantines the entry — the entry returns to the queue
where the base failure, not the entry, is what a later tick has to clear —
while the revert and the failure count stand as before. Nothing to do; the
declaration is what the marker was reaching for.

**What to do.**

1. Run both greps above and the typecheck. Every read of the retired field is
   a site; a gate naming `failingFiles` is a site of the second kind.
2. Replace each read with `blamesSpan === false`, minding the comparison.
3. Decide, per gate, whether it can honestly disown a failure — a suite red
   before the span landed, a resource the span never touched refusing — and
   declare `blamesSpan: false` only there. Attribution is now something you
   assert, so a gate that cannot tell asserts nothing.
4. If no gate of yours can tell, delete the reading branch outright. With
   nothing declaring the field, no record carries it, every revert blames the
   span, and that is the behavior an absent marker always described.
