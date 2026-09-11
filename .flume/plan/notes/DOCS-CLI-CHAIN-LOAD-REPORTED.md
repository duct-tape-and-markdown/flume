# The observational chain load also supplies the queue path; two spec sections omit it

`loadChainForObservation` (`src/cliChainLoad.ts`) reports two costs on a failed
load: the withheld friction/capability lines *and* the pending count falling
back to the default queue path (`resolvePendingPath`, `src/paths.ts`, reached
with `chain?.pendingPath` at `src/cli.ts:365` and `src/cliJobVerbs.ts:44`).

Both spec sections name only the first. `spec/cli.md`, *`flume status` owes
exactly this* item 5 states the count reads `<flumeDir>/plan/pending.json`
flat, never mentioning `Chain.pendingPath`; `spec/jobs.md`, *`flume job
status`* says the load "withholds the friction counts" and stops. So a chain
declaring a non-default `pendingPath` makes the degraded count read a different
file than the healthy one, and no spec line says so — the doc now does, ahead
of the spec.

Second site: `docs/CLI.md`'s `flume job status` paragraph asserted "no chain
load" outright and listed no friction column. Fixed here under this entry's
"job status if it repeats the claim" clause, but it was the stronger defect —
worth a lens for doc prose that denies a load the code takes.
