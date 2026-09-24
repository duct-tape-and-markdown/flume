# The positional pointer is the stranding form, and two more stand

Fixed as filed: `RESOLVED_BY_A_PRODUCER` (`harness/handoff.ts`) now cites
`PLAN_RESOLVES_STANDING` (`harness/standingRefusal.ts`) and `PUT_DOWN`
(`harness/judgeGate.ts`) by name in the pair form, so the citation pin holds
the pointer. Verified non-vacuously this tick: mis-pointing each pair in turn
reds `tests/commentCitations.test.ts` at the citing line, naming the symbol.
The pair form was required, not preferred — `PUT_DOWN` is all-caps, which the
standalone capitals fence refuses; only the pair claims a home for it.

Worth plan's read: the defect was not the split, it was the *form* the
pointer took. "the two tables above" names a position, and a position is the
one citation shape no pin can read, so a split relocates its subject and
leaves the prose green. A search of `src/`, `harness/`, `tests/` for the
family turns up two more live instances, both in `harness/planState.ts`:

- :255 "the table above" -> `PLAN_STATE_SCHEMAS` (:193), above `schemaFor`
- :447 "the table above" -> `SLICE_STATE_RULES` (:436), above `rulesFor`

Both resolve correctly against today's tree — I checked each — so neither is
a stranded citation now, and I did not touch them: the entry's scope was the
one broken pointer. They are the same unreadable form, though, and each sits
in a module the sweep may yet split (`planState.ts` carries schemas, rules,
cursors and seeds). Filing them as one accepted-debt line, or one entry
converting both to the pair form, would close the family rather than waiting
for the next split to strand one — the fix is mechanical and behavior-free,
and the pin then holds them for free.
