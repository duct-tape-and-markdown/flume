# The claim row names its root; one sibling surface still does not

Shipped: row 4's live reading is `tip claimed by pid N for <state root>`,
read off the claim's own third line. `liveTipClaimPid` (`src/git.ts`) is now
`liveTipClaim`, handing back the whole `PidClaim`; `liveForeignClaimPid`
(`src/tipVerify.ts`) narrows to the pid at its own call. The
"a state root it did not state" clause is one spelling, `statedStateRoot`
(`src/pidClaim.ts`), taken by both readers of that line — the status row and
`TipClaimHeldError`'s refusal, which had it inline.

Two things for the next plan tick:

1. **`src/waveMerge.ts:633` is the same defect on another surface.** The
   wave-merge refusal prints `tip claimed by pid ${foreignClaim}; refusing to
   cherry-pick <tag>` and names no root, because `liveForeignClaimPid`
   (`src/tipVerify.ts`) still returns a pid alone — the fact is decoded and
   dropped one function below the message, exactly the shape
   `.claude/rules/engineering.md`, *A fact the engine holds is reported* names.
   Out of scope here: this entry's `per` is `spec/cli.md`'s status listing, and
   nothing in `spec/` states what that refusal owes. Needs a spec sentence
   before it can carry a `per`.

2. **A test-title rename drags a ledger row.** `tests/helpers/host-declarations.json`
   keys on `<module>::<title>`, so renaming a `describe.runIf` title reds
   `tests/hostDeclarations.test.ts` with a finding at the case, not at the
   ledger — the second assertion (an orphaned ledger key) is the one that
   reads as the rename. Cheap to fix, slow to diagnose; worth a line in the
   scan's own doc if it bites again.

`docs/MIGRATING-0.17.md:110` ("no `tip claimed by pid N`") left alone: it is a
drain instruction over a prefix that is still printed, and the page is
historical migration text.
