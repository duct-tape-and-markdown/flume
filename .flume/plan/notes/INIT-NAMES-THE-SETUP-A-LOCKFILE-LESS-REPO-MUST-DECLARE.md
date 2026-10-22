# init's provisioning report, and the page that restates it

Shipped as a report, not a refusal: `HarnessInitResult.provisioning`
(`harness/init.ts`), read in the preflight off `installPlan`, rendered as a
`provision` line by `harness/cli.ts`.

Two things the next plan tick should know.

**The lockfile-less arm fires for the ordinary npm/pnpm adopter too.** A repo
is lockfile-less until its first install, and init runs before it — the
`npm init -y` fixture the install smoke adopts over is exactly that shape. So
the honest message names both fixes (declare `setup`, or let the install the
closing line tells you to run write a lockfile), the way the chain-load
refusal in `harness/provisioning.ts` names both. A line that said only
"declare `setup`" would be wrong for most adopters. Init cannot narrow this
further: it has no way to know which manager the consumer will run, and
probing after the install is not init's turn.

**`docs/CLI.md` § `flume-harness init` now restates the report, and nothing
pins it.** I extended that section's step 2 and its sample output beside the
entry's named `docs/CHAIN-AUTHORING.md` edit, because CLI.md is the page that
page points at as "the copy to trust" for this verb. But the init report
labels (`wrote`, `cursors`, `ignores`, `depends`, and now `provision`) are
pinned nowhere — unlike the exit-code rows in `tests/cliHelp.test.ts`, which
read the real deriver. So CLI.md's rendering of the verb is prose that can
drift from `harness/cli.ts` silently, and it already carries a stale-looking
`@dtmd/flume@^0.15.0` in that sample. Candidate entry: an agreement pin
driving the real `flume-harness init` over a fixture repo and reading the
labels CLI.md's sample block names (`engineering.md`, *A seam gate reads what
the real writer wrote*). I did not file it myself — it is a new case over a
page the entry only touched in passing.
