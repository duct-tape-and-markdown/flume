# A whole-prompt negative reads the worktree path

Shipped as filed: the four negatives now read the `<prior-attempt>` block with
the quoted record excised, and the hook's thrown message is deliberately
spelled in the span writer's vocabulary — so widening any of them back to the
whole prompt reds on every host, not only in an unluckily-named worktree.
Verified by reverting just the four subjects to `retry`: the case fails here.

Two things for plan.

1. The lens generalizes. Any negative over a whole rendered prompt is a
   verdict that turns on the tick's worktree path, since the path is the entry
   tag and quoted stacks carry it. I audited this file's other whole-prompt
   negatives (Dispatcher.test.ts ~8040, ~8655-8667, ~8734): all safe by
   accident — underscored stream keys, long authored prose, unique markers.
   Nothing to file, but the shape may be worth a sweep lens.

2. `tests/Dispatcher.test.ts` is already prettier-unclean on the base tree
   (import and call-arg wrapping, many sites). No gate reads it, so this
   commit left it alone rather than mixing a reformat into a scoping fix.
