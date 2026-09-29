# Do `flume status` and `flume render` create `<flumeDir>/awake/`, or does a read verb create nothing?

From build note THE-SECOND-ROOT-EVIDENCE-IS-STATE-WRITTEN-NOT-PROBED, item 1.

Verified this tick: the `Baton` constructor mkdirs `<flumeDir>/awake/`
unconditionally (`src/Baton.ts:87`), and `flume status` constructs one purely to
read it (`src/cli.ts:439`). `flume render` inherits the same effect
(`docs/CLI.md:221`). So two verbs documented as observational write into a state
root before reading it, and a fresh clone's bay is dirtied by one `flume status`.

**Not spec silence — a ruling.** `spec/cli.md`, *Subcommand surface* states it
outright: status "mutates no baton flag and loads no agent; the one filesystem
effect is that constructing the baton creates `<flumeDir>/awake/` when absent".
It is ratified in four places — that sentence, the site comment
(`src/cli.ts:433`), `docs/CLI.md:221`, and a pin
(`tests/Baton.test.ts:260`, "constructor creates `<flumeDir>/awake` when neither
exists"). No entry can carry a `per` cite against a sentence that states the
opposite, so the spec moves first or nothing moves.

**What it has already cost.** The second-root refusal could not key on a runtime
directory's presence, because `flume status` manufactures one; it was rebuilt on
`holdsState` (`src/cliStateDirs.ts:106`), which answers false for an empty
directory. That was one shipped entry's whole scope. Every later reader that
wants "has this checkout been used" pays the same tax or walks into the trap.

Three forks:

1. **Leave it.** The constructor's mkdir is what makes `awake()`'s
   `readdirSync` (`src/Baton.ts:92`) safe, and the effect is stated at every
   surface that shows it. Cost: the tax above, permanently, and a read verb that
   fails on a read-only state root for a directory it did not need.
2. **Move the mkdir to `wake()`.** One line down: `wake()` is the only method
   that must have the directory (`sleep` already tolerates absence, `isAwake`
   and `token` already read ENOENT as absent and declare it), so `awake()` gains
   the same ENOENT arm its two siblings state and every reader becomes read-only
   for free. This is the simple one and the one I lean to: no new constructor
   arm, no second `Baton` shape, and the absent reading is the module's declared
   idiom rather than a new silent degradation — every other stat failure still
   throws (`engineering.md`, *Loud or nothing*). Retires the constructor pin and
   moves the spec sentence plus its three copies.
3. **A construct-for-read path.** `Baton` gains an explicit read-only
   constructor or factory, and the writing verbs keep today's behavior. Costs a
   second shape of one class for a distinction (2) makes disappear, which reads
   as the complicated solution (`collaboration.md`, *Complexity is a signal*).

What I will not choose for you: whether the effect goes at all, and — if it does
— whether `flume status` should distinguish an absent `awake/` from an empty one
at the surface. Both print `hibernating` today, and `spec/cli.md`, *`flume status`
owes exactly this* is exhaustive by construction, so that row is yours too.

## Fork 2 costs three more sites than it names — re-measured on disk

Amended from build note THE-STARTUP-SWEEP-PROVES-ITS-BASE-ABSENT, which read
the same three methods from the other end and asked that this question be
answered before an entry is scoped off them. It is the same subject, so it is
folded here rather than filed beside it.

Fork 2's parenthesis — "`sleep` already tolerates absence, `isAwake` and
`token` already read ENOENT as absent and declare it" — reads those arms as
pre-existing tolerance the move can lean on. They are the opposite: each is
sound **only because** the constructor already proved `<flumeDir>/awake` is a
directory. Verified this tick:

- `isAwake` (`src/Baton.ts:106`) takes bare `existsLoud`, whose own doc
  (`src/fsProbe.ts`) sends a caller whose silent arm needs a *proven* absence
  to `existsLoudUnder` instead.
- `token` (`src/Baton.ts:119`) keys its `undefined` off the leaf's own
  `ENOENT`.
- `sleep` (`src/Baton.ts:156`) keys the same errno off the `rmSync` — the
  split spelled as a removal no-op.

None of the three can be reached over an obstructed `awake/` today: the
constructor's `mkdirUnderStateRoot` (`src/Baton.ts:87`) refuses that root as
`StateRootWriteError` on every host and for every uid, and the status site
comment (`src/cli.ts:433`) already says so. That is why the family *an absence
arm whose proof lives at a distance, unnamed at the site* is accepted debt
rather than a queue entry (plan commit 39d8bcaa).

**Move the mkdir and the proof goes with it.** Each of the three then keys a
silent arm off an unproven ancestor, which is a live host split
(`.claude/rules/platform-facts.md`, *win32 reports a path through a
non-directory as not found*): a plain file at `<flumeDir>/awake` answers "no
flag stands" on win32 and throws on posix, so a phase reads as asleep over an
obstructed state root — the tick that never runs which `wake`'s own comment
already cites `.claude/rules/engineering.md`, *The fix lands at the mechanism*
for. So fork 2 is four sites, not one: `existsLoudUnder` at `isAwake` and at
`token`, `isDirectoryOrAbsentUnder` before `sleep`'s removal, and the `awake()`
readdir arm the fork already names. Still small — but it is not "one line
down", and those three descents are the whole of what keeps the silence
honest.

**So this question also decides the debt's fix.** Under fork 1 or 3 the proof
stays real and naming it at each site is the entire remedy, which keeps the
family debt. Under fork 2 the three arms need real descents and the fix is
code — an entry with a `per` into *Loud or nothing*, filed after the ruling.
Nothing is scoped off those three sites until this is answered.
