# The roster is five; the spec section names six

`FAILURE_STAGES` (`src/loopSupervisor.ts`) now carries `platform`. The spec
section this entry cited also names a sixth, **ship** — a thrown `shipped`
hook, landed at 1ab2f1d9 — and nothing in `src/` holds it: no `shipFailures`
list on `TickVerdict`, no roster member, no streak. The supervisor does read
the throw (`mergeOutcomes` with `threw` set, `loopSupervisor.ts`'s `errored`
fold) into `erroredTicks` and the summary, so the fact is on the verdict and
merely absent from the accounting: a `shipped` hook that throws identically
every tick runs to `--max` today, and its entry is never quarantined. That
is the same gap this entry closed for `platform`, one stage over, and it
wants the same pair of commits (verdict record, then roster). Out of scope
here — the entry named platform and the acceptance named five.

Two roster sites this tick had to widen were not in `entry.files`, and are
worth knowing about for the ship entry's prediction: `src/Phase.ts` (three
lists in the shipped `Chain.supervisorPolicy` hover) and `src/entryKey.ts`
(the `observedFiles` divergence names which stages leave a footprint).
`src/cliVerdict.ts` was a fourth. The roster scan in
`tests/docComments.test.ts` finds all of them mechanically — run it first and
let it enumerate the sites rather than predicting them.

One shape the sweep may want: `LIFTS_ON_A_MOVED_TIP` and the quarantine leg
now each exclude `platform` for the same reason (no tag), stated twice in
prose at two sites. The type carries it — `PlatformFailure` declares no
`tag`, so the `if (!f.tag) continue` skip is by construction — but the
declared-subset prose is a second copy the scan requires, not one the
compiler holds. Accepted as debt, not filed.
