# The sidecar fence does not compose with a self-modifying chain

The recipe shipped as documented, with two facts found while writing it that
plan may want as entries or questions.

**`chainLoadGate` breaks the recipe where both are wired.** That builtin
(`src/builtinGates.ts`) re-loads the just-committed chain with
`repoRoot: ctx.repoRoot` — the tick's worktree — so it imports the worktree's
`declaration.ts`, and a gitignored sidecar does not exist in a fresh checkout.
Every commit touching `chain.ts` would then revert on the missing sidecar
rather than on anything the commit did. The declaration has no way out: `setup`
carries `directories` plus a `restore` command (`harness/declaration.ts`), so it
can provision an install but cannot place a machine-local file in a provisioned
worktree. Documented as "these two do not compose" rather than papered over; if
a consumer wants both, the gap is the declaration's (a `setup` that carries
files, or the function-form `fence`).

**The declaration cannot see the resolved roots, so the read is keyed to
`import.meta.url`.** Only the function-form fields (`worktreesBase`, `runner`,
`resolver`, `handoff`, `ci.titles`) receive engine facts; `fence` is data. That
means the sidecar sits wherever `declaration.ts` does — the config dir, moved by
`FLUME_CONFIG_DIR` — while the state root moves by `FLUME_DIR`. The function-form
`fence` the page names as the surface to file is exactly that mismatch's fix, and
it is the declaration's surface, not `src/`: an engine-level chain already
computes `writablePaths` from `api.paths` in its factory.

No test or pin: the entry claims no engine behavior, and the page's existing
declaration-field pin and anchor pins already read the new section.
