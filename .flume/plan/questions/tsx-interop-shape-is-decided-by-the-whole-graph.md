# A tsx platform fact wants your page: the interop shape is a graph property

Only you can write `.claude/rules/platform-facts.md`, and this fact has now
been raised by two build notes without landing anywhere durable
(THE-ADAPTER-REGISTERS-THE-BUDGET-HOOK first, then
THE-HOOK-ENTRYPOINT-NAMES-A-REASON-THE-LOADER-HOLDS, which this drain
removes). Filed so the third raising is not another note.

**The fact, as measured.** tsx's choice between CJS interop and true ESM for
a chain module is decided by the module's whole import graph, not by its own
export shape. A **default-only** `.ts` module — the shape `chainLoad.ts`
normalizes as CJS interop — comes back through `tsImport` as plain ESM, with
`__esModule` absent and `default` the value directly, as soon as anything in
its graph carries a top-level await. Measured three times, most recently with
a top-level await in `src/budgetHook.ts`'s entrypoint guard: `pnpm tsc
--noEmit` clean (`module` is `ESNext` in both tsconfigs, so the emit carries
it verbatim), `tests/budgetHook.test.ts` green including the seam case that
execs the real rendered command, and `flume status` green through the real
chain.

Nothing is broken by it: `loadChainModule` normalizes both shapes, and that
normalization is load-bearing exactly because of this.

**Why it is yours.** `CLAUDE.md` rules platform-facts.md the home for a
toolchain behavior — "each is external, so no test pins it and no type holds
it; a code comment carrying one is a copy the harness should own instead,
seen only by an agent that already opened that file." Both copies today are
code comments: the two sites that lean on the interop shape are
`src/chainLoad.ts` and `harness/init.ts`.

**The consequence of the page line being absent.** `src/chainLoad.ts:291`
states the cause unconditionally — "tsx compiles a default-ONLY .ts module to
CJS interop" — which the measurement above makes false as written. That
comment is accepted debt in this tick's commit body rather than an entry,
because which edit it wants depends on your answer:

1. **Write the page line** (recommended, and what CLAUDE.md's own rule says).
   The fact gets one external home, and a follow-up entry shrinks the
   `chainLoad.ts` comment to a pointer at it — the ladder's ordinary shrink.
2. **Decline the page** and keep the fact in the comment. Then the entry
   instead corrects the comment in place, stating the graph condition rather
   than the export shape, and `harness/init.ts` gets the same correction —
   two copies to keep in step, which is the cost the page exists to avoid.

Either way the comment stops asserting the unconditional cause; only the
destination differs, which is why no entry is scoped yet.
