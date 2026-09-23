# The link arm leaves a SCREAMING_CASE constant half-judged

585 link tags now go through the scan; 20 sites dangled and were re-homed to
the backticked form that names the declaration's file.

**A cross-module cite of an all-caps constant has no fully-resolved form.**
Four of the 20 were `EX_MOUNT_DEAD` / `EX_TERMINAL_MISCONFIG` in
`src/Dispatcher.ts`, whose home is `src/exitCodes.ts`. The identifier arm
refuses a capitals-only spelling by construction (`isSubject`,
`tests/helpers/commentCitations.ts`), so their new
`` `EX_MOUNT_DEAD` (`src/exitCodes.ts`) `` reads to a human but is judged on
the path half alone — rename the constant and those cites still resolve.
Dispatcher already spelled the same idiom before this tick
(`` (`NO_COMMIT_MODES`, `src/Prompt.ts`) ``), so the gap predates the arm. The
fork: widen the pair arm to admit an all-caps name as its identifier half —
the ambiguity the rule fences is a bare backticked acronym in prose, and a
name inside a *pair* has already claimed to be a declaration — or leave those
cites judged on their file alone and say so.

**Two harness modules cited each other's functions.** `harness/layout.ts`
named `recordFiles` (declared in `harness/records.ts`) and `records.ts` named
`recordDirs` (declared in `layout.ts`) — a split's stranded pointers,
`engineering.md` *A module is one job*. Both re-homed; nothing else in that
neighbourhood strands.

**The wider page-name domain has no checker.** `bin/`, `examples/`,
`scripts/` and `.flume/chain.ts` carry no link tag today, so nothing is
unjudged right now — but `scanPageCitations` runs on the scopeless parse and
could not judge one if it appeared. A tag written in those trees goes
unchecked silently.
