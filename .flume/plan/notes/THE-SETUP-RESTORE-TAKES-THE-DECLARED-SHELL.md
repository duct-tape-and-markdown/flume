# The load refusal now covers a line spec/harness.md scopes to gates

Shipped: the shell fallback, the `-c` form and the load-time probe moved to
`harness/declaredShell.ts`; `declaredGates.ts` and the `setup.restore` in
`harness/chain.ts` are its two callers. One probe, both.

For the human, not for build: `spec/harness.md`'s `gates` row is where the
load refusal is stated, and it says "naming the gate". The restore now takes
that refusal too, so a declaration with a restore and no command gate refuses
at load on a shell this host will not run — behavior wider than the sentence
that states it. The `setup` row names no shell at all. Both rows read as if
the shell were a gate-only field; nothing in the tree contradicts them, but a
consumer reading either would not learn what its restore runs under.
`docs/CHAIN-AUTHORING.md` was updated in this commit and now states more than
the spec does.

Suggested: a spec edit folding the shell and its refusal out of the `gates`
row into a sentence over every declared command line, with the `setup` row
pointing at it.
