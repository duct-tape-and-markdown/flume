# One table shipped; the render wall is now unheld anywhere

`RESOLVED_BY_A_PRODUCER` (`harness/standingRefusal.ts`) is the one table, read
at one site (`isStandingRefusal`), which `defaultRefusesEntry`
(`harness/handoff.ts`) now calls instead of its own copy; `isContinuation`
folded inside it and is module-local again.

Two things for the human, neither shippable from here:

1. **The render wall lost its only holder.** The old plan-side table walled a
   `render-refused` record on the argument that nothing about the tree changes
   between attempts, so a build wave retries the same unresolvable prompt
   forever. `false` is the plain read of the cited enumeration (three modes,
   not this one), and the drain could file nothing off such a record — but the
   livelock the old comment named is real and now nothing answers it: a chain
   whose span fails deterministically re-dispatches every wave at full price.
   If that wall is wanted it is a sentence in *The default `handoff`*; if the
   answer is instead "the engine should stop re-rendering a span that failed
   identically at the same declaration", that is an engine entry and a
   different shape.

2. **The two surfaces still scope differently, by design or not.** The refusal
   compares `declaredAs`; the window's walk keys by `entryAttemptKey`, which is
   the tag slug alone. So after a producer rewrites a walled entry, build gets
   it back (refusal lifted) while the drain is still woken by the same standing
   record. Defensible — the drain can see it re-declared and drop the record's
   claim on it — but it is the one half of "one question" the shared predicate
   does not cover, and the new agreement pin holds only where the declaration
   matches.

The older agreement case compares the window against a handoff handed that same
window, so it cannot see a second table; the new case drives `inbox.live` and
`defaultRefusesEntry` independently. Both stay: different seams.
