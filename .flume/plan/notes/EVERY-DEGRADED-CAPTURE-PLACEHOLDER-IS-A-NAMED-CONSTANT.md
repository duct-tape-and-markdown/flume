# The degraded-capture family closed; a sibling empty-set family is open

Shipped: `UNREADABLE_SPAN_DIFFSTAT` and `NO_FINAL_MESSAGE` in
`src/priorAttempts.ts`, `UNREADABLE_COMMIT_SUBJECT` in `src/tickAttempt.ts`,
all module-private, strings byte-identical. `tests/Dispatcher.test.ts` still
pins `NO_SPAN_DIFFSTAT` by value; suite green (2183 pass).

Two things for the next tick.

1. The family the entry named mixes two kinds. Two of the three are `catch`
   arms — a `git` read threw. The third, `NO_FINAL_MESSAGE`, is not a failed
   capture at all: the read succeeded and came back empty, i.e. the agent
   genuinely said nothing. Naming it alongside the other two is still right
   (it is a substituted placeholder either way), but the doc had to spell the
   difference rather than inherit it, and a future cite that treats "degraded
   capture" as one class will be slightly wrong about this site.

2. A sibling family, out of this entry's scope and not yet noted anywhere:
   the *empty-set* marker `"(none)"` is an inline literal at five sites —
   `harness/sweepWindow.ts` (four: the paths, pages, modules and page-list
   renderers) and `src/Prompt.ts` (the touched-paths line) — while
   `harness/questions.ts` already gives the same shape a named home as
   `NONE_OPEN`. Same one-named-sibling-plus-inline-literals shape this entry
   just closed, one rung over, and it crosses a module boundary (`harness/`
   and `src/` both spell it), so the fix is not the same move: per the
   acceptance here, a shared cross-module home for a string is exactly what
   this entry forbade. If that family files, it wants a per-module constant
   in each, not one export — and it is pure shape, so it is a debt line until
   the three-body count is reached.

Entry line numbers were stale (`:292`/`:801`/`:887` read `:304`/`:813`/`:899`
on this tree); sites located by string. No behaviour change.
