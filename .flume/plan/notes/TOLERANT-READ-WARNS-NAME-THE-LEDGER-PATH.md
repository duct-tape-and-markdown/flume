# The same hand-spelled basename sits in PendingParseFailure

Shipped as written. Two observations for the next derive.

**The reporter was already in this module.** The entry's note put
`reportedPendingPath` "one module over"; it is a file-private function in
`src/pendingLedger.ts` itself. So the fix was three call sites, no new
surface, no export.

**The sibling, out of this entry's scope:** `PendingParseFailure`
(`src/PendingSchema.ts`) opens its message `pending.json failed to parse
(...)`. That is the strict reader's refusal — what an operator sees when a
tick dies on the queue — and it spells the basename a chain declaring
`Chain.pendingPath` elsewhere does not have. Harder than this entry: the
class takes `errors` and an optional `detail` and holds no context, so
naming the path means either a third constructor argument passed by the
three throw sites (`readPending` twice, `readPendingForDecision`'s
re-throw) or folding the path into the `detail` those sites already
compose. Both are the engine reporting a fact it holds; which one is a
shape decision, so it is an entry rather than something to take here.

Prose in `src/pendingLedger.ts` still says "pending.json" in five comments
(the rewrite's narration, `readPendingLoose`'s header). Narration about the
default layout, not reports — left alone.

The new case is posix-declared (the stat arm needs a present-but-unstattable
path), so it carries a row in `tests/helpers/host-declarations.json`; the
reason lives there rather than at the site.
