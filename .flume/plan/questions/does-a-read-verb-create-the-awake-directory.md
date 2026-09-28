# Do `flume status` and `flume render` create `<flumeDir>/awake/`, or does a read verb create nothing?

From build note THE-SECOND-ROOT-EVIDENCE-IS-STATE-WRITTEN-NOT-PROBED, item 1.

Verified this tick: the `Baton` constructor mkdirs `<flumeDir>/awake/`
unconditionally (`src/Baton.ts:63`), and `flume status` constructs one purely to
read it (`src/cli.ts:451`). `flume render` inherits the same effect
(`docs/CLI.md:206`). So two verbs documented as observational write into a state
root before reading it, and a fresh clone's bay is dirtied by one `flume status`.

**Not spec silence — a ruling.** `spec/cli.md`, *Subcommand surface* states it
outright: status "mutates no baton flag and loads no agent; the one filesystem
effect is that constructing the baton creates `<flumeDir>/awake/` when absent".
It is ratified in four places — that sentence, the site comment
(`src/cli.ts:445`), `docs/CLI.md:206`, and a pin
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
   `readdirSync` (`src/Baton.ts:68`) safe, and the effect is stated at every
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
