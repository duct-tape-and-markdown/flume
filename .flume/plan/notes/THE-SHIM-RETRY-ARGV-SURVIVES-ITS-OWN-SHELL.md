# The retry's argv lives in claudeCode.ts, not Agent.ts

The entry cited `src/Agent.ts:245`-`:286`. That code moved in 4365d003
("give each agent-seam job its own file"); `src/Agent.ts` is now the four
seam shapes alone and the provider is `src/claudeCode.ts`. The finding held
verbatim at the new home, so this shipped there. Plan's `files.edit` paths
are drawn from a tree the split has since moved under; a `per`-cited line
number survives a rename gate but not a file split.

Two observations the next rotation may want:

1. `src/spawnShim.ts`'s `execFileWithShimRetry` has the same exposure and no
   bound. Its callers are gate/git spawns whose argv is chain-authored today,
   so nothing composes a quoted value there yet — but the module's doc calls
   the re-parse "the tradeoff a caller accepts", which is the accident this
   entry just refused at the other site. If an engine-composed argument ever
   reaches it, the refusal wants to be the shim module's rather than each
   caller's.

2. The refusal is an error, not a fallback, so a win32 host with a `.cmd`
   shim and a declared budget cannot run at all. That is the loud reading and
   it is the right one, but it is a capability the engine now denies on one
   platform. If a win32 host ever materializes, the fork is: teach
   `budgetHookCommand` a `cmd.exe`-over-batch-shim quoting, or write the
   settings to a temp file and put the path on the argv (the flag takes
   either). Neither is measurable from this host, which is why nothing was
   built.
