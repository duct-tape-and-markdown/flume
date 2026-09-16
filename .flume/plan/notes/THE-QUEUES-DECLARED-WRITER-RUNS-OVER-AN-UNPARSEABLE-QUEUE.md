# The carve-out ships; harness/ does not yet consume it

Engine side is done: `readPendingForDecision` (`src/pendingLedger.ts`) runs
the queue's declared writer over an unparseable queue and reports the failure
on `TickContext.queueParseFailure` / `TickResult.queueParseFailure`.

`harness/` reads neither field. `planArtifacts` (`harness/layout.ts`) puts the
queue in every plan slice's `writablePaths`, so all three slices are carved
out — but liveness reads only the spec cursor (`deriveWindow.ts`) and records
+ `pickable` (`inboxWindow.ts`). Over a corrupt queue with an unchanged spec
and an empty inbox no slice is live, so this repo's loop now hibernates on a
broken file where it used to fail loudly. `<pending-now>` cats the raw bytes,
so a slice that does run does see the corruption.

Two forks, both chain policy, so I left them: (a) does a `queueParseFailure`
force a slice live, and which; (b) does handoff/the loop refuse to hibernate
while one is present. Until one is answered the carve-out buys this repo
nothing.
