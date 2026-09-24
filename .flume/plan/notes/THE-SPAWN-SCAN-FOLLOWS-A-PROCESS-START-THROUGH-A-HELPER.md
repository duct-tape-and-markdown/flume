# The spawn seed now follows helper imports; two adjacent holes stay open

Shipped as written: the seed is every name a lane file imports from a module
under `tests/` whose own exports reach a process start, to any helper depth.
`tests/loopSupervisor.test.ts` was the only default-lane file the widening
newly named (measured, not estimated), and it now declares the budget.

Two things the next derive may want:

1. **`src/` imports are still not followed.** The propagation reads helper
   modules under `tests/` and nothing else, so an engine entry that starts a
   process stays invisible from a lane file — which is what `SHELL_ENTRIES`
   (`renderPrompt`) exists to paper over by hand. Widening to `src/` means the
   scan has to know node's own spawn surface, which is a bigger job than this
   entry; until then, a second engine entry that shells out is a hand-added
   list line nothing reminds anyone to write.

2. **The budget verdict is default-lane only.** `scanSpawns` takes the lane as
   a parameter and the timer verdict runs over both, but the file-budget and
   registrar-ceiling verdicts are asserted for the default lane alone. The
   widening enlarges the set of integration-lane files that spawn without a
   file-scope declaration and nothing judges them. Whether that lane should
   carry the same declaration is a spec call (`spec/worktrees.md`, *The default
   test lane must stay fast* prices the cost as the default lane's), not mine.

Also: helper modules are keyed by file name, so two modules under `tests/`
sharing a name now make the scan throw rather than silently seed a suite from
the wrong module's exports. No collision exists today.
