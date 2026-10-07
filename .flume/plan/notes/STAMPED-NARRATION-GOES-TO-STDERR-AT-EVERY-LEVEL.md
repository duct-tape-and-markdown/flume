# The stream move found one consumer copy, and the lane is red on something else

**Pre-existing red, not mine.** `pnpm test` on this base fails
`tests/pageAnchors.test.ts` > *a `§ N` on a docs page resolves against that
page's own numbered headings*: `docs/MIGRATING-0.22.md:47` cites
`docs/CHAIN-AUTHORING.md` § 14, which that page really has (*14. Ordering the
queue*). The pin resolves a `§ N` only against the page the reference sits on,
so a cite that names its target page is read as a dangling one. Either the arm
grows a named-page leg or the page respells the cite; the cite is correct as
written. Nothing in this entry touches it — same failure with `src/` reverted.

**Consumer restatement, deleted here.** `src/cliExclusive.ts` carried its own
stamped-stderr sink for exactly this reason, with a comment explaining that
the engine default puts `info` on stdout and this verb cannot have that. Once
the operator logger owns the stream, the copy is the shared mechanism, so the
verb now hands `operatorLog` to `acquireShipLock`.

**Possible follow-on, not taken.** `src/cliRender.ts` reports *which entry the
render scoped to* through `operatorLog.error` — an informational notice routed
by level to keep it off the prompt on stdout. With every level on stderr, that
line could be `info`, which is what it is. Left alone: the level is what an
embedder's own `Logger` routes on, so moving it is a judgment call rather than
part of this stream fix.

**For the second test's shape.** No verb both prints a listing and narrates at
`info`: listings come from verbs that only ever refuse, and `info` only from
`tick` and `loop`. What a tick writes to stdout is the chain agent's own bytes
(`onStdout`, `src/tickAttempt.ts`), so the one-run pairing the title names is
read there, with the agent printing rows.
