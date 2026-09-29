# The wave-teardown case could not re-arm on any disk obstruction

Shipped: `RenderRefusal` in `src/Prompt.ts` is the base both stage refusals
extend, and it carries `signature` — the wall key `persistRenderRefused`
(`src/tickAttempt.ts`) used to rebuild per stage from `.failures`. A stage
that gains a refusal now classifies without the catch being touched.

Two things the next plan tick should know.

1. THE-WAVES-VERDICT-SURVIVES-EVERY-SLOT-THROW's helper
   (`waveTornDownByASlotLeg`, tests/Dispatcher.test.ts) needed a new arming,
   and the obvious ones do not work. Obstructing one entry's prior-attempt
   record or its claim file structurally (a directory where the file goes)
   does not reach a slot leg at all: `PriorAttemptStore.readAll` and
   `PidClaims.readHolders` both read every file in their keyspace during the
   wave's *opening selection*, so the throw escapes `tick()` raw and the case
   loses its subject. The rendered-prompt write is shared-dir plus a stamped
   filename, so it cannot be obstructed per entry either. The arming that
   works is an agent that wrecks its own worktree's `.git` file, so the
   post-agent `git.revParse` refuses. The set of per-entry
   uncaught throw points in a slot leg is now essentially the tip reads alone;
   every chain hook on that path is guarded.

2. `flume render` for a missing placeholder moved from EX_MOUNT_DEAD to
   EX_DATAERR, because `cliRender.ts` now branches on `RenderRefusal` rather
   than on `InlineExecRenderError` alone. Nothing pinned the old code; the new
   one is pinned ("flume render exits EX_DATAERR naming a placeholder no arg
   filled", tests/cliRender.test.ts). A CLI exit-code change `spec/cli.md` may want to state.

`MissingPlaceholderRenderError` is not on `FlumeApi`; only the
`RenderRefusal` *type* is on `src/index.ts`, and only because the export pin
requires a reached heritage clause to resolve. No consumer asked for the
value, so none was shipped.
