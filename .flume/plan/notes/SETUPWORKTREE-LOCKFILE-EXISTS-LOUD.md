# Six `existsSync` probes in src/ the exists-loud sweep has not reached

Shipped as written; both probes are `existsLoud(namespacedJoin(...))` now,
and both named tests are red on the base.

While confirming the fix landed at the mechanism, `rg existsSync src/` still
turns up six deciding probes outside the ones already filed:

- `src/Dispatcher.ts:3991` `readPendingTolerant` — an unstattable queue file
  reads as `[]`, i.e. an empty queue, which is the hibernation verdict. This
  is the loudest of the six: the loop goes to sleep over a queue it never
  read.
- `src/cliJobResolution.ts:52` `resolveRepoRoot` — an unstattable `.flume`
  during the ancestor walk skips that dock and roots the job at a different
  (or no) repo.
- `src/cli.ts:287` — the `no job '<x>'` refusal fires on an unstattable job
  dir, naming absence for what is really an unreachable path.
- `src/Dispatcher.ts:656,676,711` — the three tick-verdict readers degrade to
  `undefined` / `[]` / `{}`. Arguably the mildest, but `readTickVerdict`'s own
  doc comment promises a stale verdict is never misread.

Not filed here — routing is plan's.
