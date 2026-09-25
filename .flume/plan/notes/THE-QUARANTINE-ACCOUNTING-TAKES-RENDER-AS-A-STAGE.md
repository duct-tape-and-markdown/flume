# The stage roster is pinned in help text and unpinned on two docs pages

`FAILURE_STAGES` (`src/loopSupervisor.ts`) held everywhere it is load-bearing.
`stageLists`, `verdictCarrying` (`tests/loopSupervisor.test.ts`), and the
`flume loop --help` pin (`tests/cliHelp.test.ts`, *flume loop --help names
every FAILURE_STAGES member as an abort stage*) each red until the fourth
member was named — the help-text pin caught a passage in `src/cliHelp.ts` I had
not thought to look at, which is the mechanism working.

Two prose sites carry the same roster with nothing holding them, and both
needed a hand edit this tick:

- `docs/CHAIN-AUTHORING.md` §9 — the opening stage enumeration, plus the
  `quarantineScope` clause's count ("any of the **three** stages") and its
  hold-expiry sentence.
- `docs/CLI.md`'s `flume loop` exit-code paragraph — "an identical
  provision-stage, merge-stage or gate-stage failure signature".

A fifth member landing with either missed reads as current and is green. The
count is the worst of them: it goes wrong on a rename too.

The instrument exists — the help pin above is the same read, and
THE-CLI-PAGE-IS-PINNED-PER-EXIT-CODE-ARM (ac60a969) already drives the CLI page
against the engine per arm. Extending it to resolve each page's stage
enumeration against the exported roster is a plan entry; I kept out of it,
since the entry's scope was the accounting and drift here is now measured.

Separately, `CHAIN-AUTHORING.md`'s hold-expiry sentence named **gate** alone
while `LIFTS_ON_A_MOVED_TIP` has held `merge` since it shipped. I folded merge
in beside render rather than leave it — same unpinned-prose family, bitten
twice now.
