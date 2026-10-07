# What pays for the spawn scan's scopeless name reach?

Fourth note on one shape. The drain's three-notes bar is met in count
(`.claude/rules/engineering.md`, *A module is one job*), but the remedy that bar
names — one entry stating the target shape — has no honest target here: both
directions on the table are posture calls, and one of them a plan body already
turned down. So the family comes here, which also stops it being re-noted a
fifth time.

## The shape

`reachingNames` (`tests/helpers/spawnBudget.ts`) propagates "reaches a spawn" and
"reaches a timer" through **names**, over a `parseScopeless` parse with no
checker behind it, so every declaration of a name in one file shares one
verdict. The module declares that over-approximation at its site and prices it:
"a name asserted on rather than handed to a runner … costs the file one declared
ceiling it never pays. A missed one costs the flake."

The price being paid is not the price declared. Measured, twice:

- `c6c3f776`-era: a roster case's `([name, make]) => …` parameter collided with
  an unrelated sibling's `make` binding and tripped the missing-budget revert —
  a whole build span, and build renamed the parameter to `construct`.
- 2026-10-07 (`A-MOUNT-DEAD-69-ABORTS-ONLY-WHILE-THE-MOUNT-IS-STILL-DEAD`): a
  `runTick` stub yielding on `setTimeout` made every `runTick` in
  `tests/loopSupervisor.test.ts` timer-reaching, so cases that spawn `git` to
  commit a queue read as spawn-then-sleep. Build renamed the two stubs
  (`runTickYieldingOnce`, `runTickHoldingTwo`). It recurs for any file pairing a
  spawning case with a timer-yielding stub of a shared name.

Three plan bodies accepted the same family as debt before this one: `26ee0476`
(the name-wide `git` propagation, 252 sites in one file), `7b08eb31`
(`SHELL_ENTRIES` is a hand list resolving no scopes), `c6c3f776` (the `make`
collision, accepted while its *under*-approximation half was filed as
`SPAWN-SCAN-NAME-MAP-KEEPS-EVERY-DECLARATION` and shipped at `952a5957`). That
fix widened the map to keep **every** declaration of a name on purpose, so the
collision above is now the declared design rather than a bug in it.

## Options

1. **Accept permanently, and put the convention where a test author meets it.**
   The scan's doc declares the trade but says nothing to the author who has to
   live with it; the rule an author needs is "a stub that yields on a timer does
   not share its name with the subject it stands in for". Cheapest, prose rung,
   no posture change — and it leaves the next collision costing a rename, just a
   knowing one.
2. **Make the finding name the colliding declaration.** `SpawnSite.awaitedTimer`
   names *the name* that reaches a timer, never which of its declarations did, so
   a build tick re-derives that by hand against a file that may hold three. A
   finding naming both lines turns a debugging pass into a read, and nothing
   about the scan's reach changes.
3. **Resolve the names and bound reach by scope** (`repoProgram` rather than
   `parseScopeless` for the `tests/` domain). What every note keeps asking for.
   `c6c3f776` turned it down as the complicated direction, and the reason stands:
   it narrows the scan against its own "a missed one costs the flake" posture,
   and `parseScopeless`'s tier is chosen for verdicts answerable from syntax
   alone. It is on the table only because the recurrence now has a measured
   price in build spans.

Whichever lands, it says so at the site, so a fifth note reads the answer
instead of re-deriving the question.
