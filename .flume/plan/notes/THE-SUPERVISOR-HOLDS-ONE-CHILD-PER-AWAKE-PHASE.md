# The verdict path is one file, and two children now share it

`<flumeDir>/tick-verdict.json` (`spec/loop.md`, *The tick verdict — one facts
artifact*) is a single path: each `flume tick` clears it at start and writes it
at end, and the supervisor reads it after each child exits. At `maxTicks` above
one, two children clear and write the same file, and the supervisor reads
whichever was last. The run's shipped tags, errored ticks, spend rows,
quarantine and abort streak all come off that read, so above a budget of one
they are lossy — not a crash, a silent undercount. The default is one, so
nothing regresses; **raising this repo's budget wants the verdict path keyed per
phase first**. `SIBLING-TICKS-TAKE-TURNS-AT-GIT` does not cover it — that entry
guards git, this is the fact channel. Not filed as a question: the shape looks
mechanical (per-phase filename, one reader), but it is spec's to say.

# Two behaviours changed that the entry did not name, both loud-or-nothing

1. An empty baton ends the run with **no child at all** (spec: "stops once no
   flag stands and no child is in flight"). `flume loop --max 0` therefore
   prints `hibernating after 0 tick(s)` where it printed `reached --max 0`;
   eight CLI cases asserted the old line.
2. Because of (1) a broken `chain.ts` over an empty baton had nothing left to
   report it — exit 0, "hibernating". So the supervisor now takes the CLI's own
   chain-load failure as a fact (`SuperviseLoopOptions.chainUnresolved`) and
   ends the run mount-dead before any child. Fixtures that ran `flume loop` with
   no `chain.ts` at all (five in `tests/cli.test.ts`, one in
   `tests/tip-claim.integration.test.ts`) were relying on `--max 0` to hide
   that; each now writes a chain.
   `docs/CHAIN-AUTHORING.md`'s "surfaces nothing new" paragraph retires with it.

The `maxTicks` declaration-validation cases went to `tests/Dispatcher.test.ts`,
beside the other `loadChainModule` refusals, not `tests/chain.test.ts`.
