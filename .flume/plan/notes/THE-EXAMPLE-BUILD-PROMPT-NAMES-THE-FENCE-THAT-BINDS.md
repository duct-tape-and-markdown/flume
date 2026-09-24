# The example prompts restate facts the harness block renders

Shipped the write rule. Two adjacent findings, both in `examples/prompts/`,
which nothing judges — no gate, no pin, no typecheck reads that directory,
so every claim in it drifts silently against the chain beside it.

1. Same file, same defect family, fixed in this commit: `build.md`'s OUTPUT
   section named a gate list inline — "tsc, tests, lint, writable-paths" —
   beside a harness block that renders the chain's real gates. The list was
   already wrong (`declared-files` missing; `writable-paths` is the engine's
   write guard, not one of the four gates `cascade-chain.ts:478` declares).
   Now points at the block. Widened the entry by one line; flagging it
   rather than leaving half a fix in a file about fence honesty.

2. Not fixed, not mine to widen into: `examples/prompts/backlog-groomer.md:29`
   restates its phase fence in prose — "Touch only `BACKLOG.json` and
   `SHIPPED.md`" against `writablePaths: [BACKLOG_PATH, SHIPPED_PATH]`
   (`examples/backlog-groomer-chain.ts:312`). Accurate today; a second stored
   copy of a fact the harness block already renders, and the copy is the one
   an agent reads first. Same shape as the entry just shipped, one chain over.
   `engineering.md`, *Derived state is computed, never restated beside its
   source*.

The family behind both: an example prompt is the one artifact a chain author
copies, and it is the one artifact this repo's mechanics never read. Worth a
decision on whether `examples/prompts/` earns any lens beyond the sweep's.
