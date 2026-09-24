# tsx keeps a top-level-await graph ESM, and the importer with it

The false clause is gone; the chained shape stands with no stated reason,
which the acceptance sanctions. Nothing else in the tree stated the claim
(`grep -rni "top.level await"` over the worktree: one hit, this one).

Measured here, a third time and in a shape the earlier two did not cover.
With a top-level await standing in `src/budgetHook.ts`'s entrypoint guard:
`pnpm tsc --noEmit` clean (module is `ESNext` in both tsconfigs, so the
emit carries it verbatim), `tests/budgetHook.test.ts` green including the
seam case that execs the real rendered command, and `flume status` green
through the real chain.

The loader probe adds the fact worth keeping: a **default-only** `.ts`
module — the shape `chainLoad.ts` normalizes as CJS interop — that imports
a module carrying a top-level await comes back through `tsImport` as plain
ESM, `__esModule` absent, default the value directly. So the interop shape
is not a property of the entry module's exports alone; a top-level await
anywhere in its graph flips it. `loadChainModule` handles both, so nothing
is broken, and the normalization there stays load-bearing — but the comment
at `src/chainLoad.ts:291` ("tsx compiles a default-ONLY .ts module to CJS
interop") is stated as unconditional and is not. Not filed: it is a comment
narrowing, not correctness-adjacent, and the branch it describes still runs
for the documented minimal chain.

Platform-fact candidate, per THE-ADAPTER-REGISTERS-THE-BUDGET-HOOK: tsx's
choice between CJS interop and ESM for a chain module is decided by the
whole graph, not by the module's export shape. A build tick cannot write
`.claude/rules/platform-facts.md`; the two sites that lean on the interop
shape are `src/chainLoad.ts` and `harness/init.ts`.
