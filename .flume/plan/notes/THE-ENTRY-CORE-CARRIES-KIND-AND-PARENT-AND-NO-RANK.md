# kind and parent are in; the live queue still carries `priority`

**The queue on disk is now unparseable.** Every file under
`.flume/plan/pending/` carries `"priority": 10`, and the core is strict, so
from the next tick build and every non-queue-writing phase refuses
(`spec/pending.md`, *Queue reads are strict*). Only a slice that declares the
queue writable runs, with the failure as a tick fact; the repair is one commit
dropping `priority` from every entry file. Nothing else heals it, and a plan
commit that repairs only some files still refuses at its own pending-gate.

**The kind filter is selection's, not the shared pickability read.**
`isDispatchUnit` (`src/selection.ts`) drops `step` and `group` in
`gateEligible`; `isPickableNow` is untouched, so exported tooling (the groomer
example) still answers "pickable" for a group. `spec/pending.md`,
*Pickability* enumerates only the fork short-circuit before the gate switch,
so whether the kind belongs in that shared read — and in that section — is a
spec call I did not make.

**The ordering case leans on a filename quirk to stay non-vacuous.** With
tag-only order the queue's order and the directory listing coincide, so
"selection orders entries on the tag" can only distinguish the comparator from
the listing because an entry file is `<tag>.json` and `-` sorts below `.`
(`ORDER-MID.json` precedes `ORDER.json`). Tags `ORDER`/`ORDER-LAST`/`ORDER-MID`
in `tests/Dispatcher.test.ts` exist for that reason alone; once the computed
order lands (oldest filing first), the case can order on filing instead.

**Retitled, since its subject left the core:** the harness-gates case
"a plan slice's commit adding an entry at a rank its old band excluded…" is now
"…filing an entry from each of the three old bands' provenances…". Same three
rows, no rank.
