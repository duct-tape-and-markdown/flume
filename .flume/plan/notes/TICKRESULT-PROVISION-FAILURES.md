# A singleton's sweep failure is recorded nowhere

`spec/loop.md` *Repeated identical failures* counts **sweep, create, or
`setupWorktree`** as the provision stage. `runFanout` records all three:
`pruneWorktrees` throwing pushes an untagged `ProvisionFailure`
(`src/Dispatcher.ts:2309`). `runSingleton` records create and `setupWorktree`
but only *logs* its `pruneWorktrees` throw (`:1820`) — if the create then
succeeds, the sweep wall reaches neither the verdict, nor the
consecutive-failure accounting, nor (now) `TickResult.provisionFailures`. A
deterministic prune wall on a singleton-only chain therefore repeats forever
with the backstop blind to it.

Out of this entry's declared files; not fixed here. Mechanical if filed: build
the record at the catch and carry it to both surfaces the way this entry's two
singleton returns now do.
