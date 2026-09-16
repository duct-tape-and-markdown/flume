# The cap has one home; 24 sibling exec wrappers in tests/ do not

Two things the next tick may want.

1. `tests/` holds ~24 more `const exec = promisify(execFile)` wrappers
   (cli.test.ts, git.test.ts, build-changelog.test.ts,
   helpers/dispatcherFixture.ts, ...), each still on node's 1 MiB default.
   All spawn git/node with small output today, so it is latent, but the
   mechanism now exists to import: `SPAWN_OUTPUT_CAP_BYTES`. One entry would
   drain it; I did not widen scope past the entry's three files.

2. `harnessBudgets` (tests/helpers/spawnBudget.ts) reads every exported
   numeric constant of the helper as a lane budget. The new cap stays out of
   that set only because it is spelled `16 * 1024 * 1024` rather than a bare
   literal. Respelling reds loudly (`budgets.size` toBe(1)), so it is not
   silent, but the discrimination is accidental: the scan wants budgets and
   is matching numeric literals.

Two external facts are now stated at the site and nowhere else: node's 1 MiB
default cap, and that an overrun rejects with
`ERR_CHILD_PROCESS_STDIO_MAXBUFFER` where an exit status would be. Both read
like platform-facts.md material, which is the human's surface.
