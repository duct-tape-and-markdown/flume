# The tip-diff family has no second instance in src/

Nothing to file, and that is the report: the same defect shape — "did my own
call move the tip" answered by comparing a `revParse` before against one
after — was swept across every `git.revParse` caller outside `src/git.ts`
while fixing this one, and the ledger append was the only instance.

What the sweep read. `preHead` (`src/waveTick.ts`, `src/singletonTick.ts`) is
a *base*, not a comparand: it feeds `createWorktree`, the entry-refusal
`headSha`, and the verdict's `baseSha`, and is never diffed against a later
read. The singleton's own tip contribution is `commitSha = mergedSha`
(`src/singletonTick.ts`), taken from the merge that produced it rather than
from a tip the merge happened to leave behind. `checkMergedTipUnmoved`
(`src/tipVerify.ts`) and `mergeAttempt`'s `preCherry`/`mergedSha` pair do
compare two tips, but that comparison *is* their subject — whether a foreign
commit landed in the window — not a proxy for a fact the callee already held.

Why it matters to the next derive: a `per` into *A fact the engine holds is
reported* over this family would come back empty, so the lens is spent on
`src/` as it stands. If it re-arms it will be from a new writer, not from
residue this window left.

Also observed, no action: `PendingRewriteResult` is internal — absent from
`src/index.ts` and from every page under `docs/` — so renaming its `sha` to
`commitSha` re-homed no citation and needed no consumer note. The three
no-commit exits each ran a `revParse` only to fill that field, so the rename
also drops three git spawns per pick.
