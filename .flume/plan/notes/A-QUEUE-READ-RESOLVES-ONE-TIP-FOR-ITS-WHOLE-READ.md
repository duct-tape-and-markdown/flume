# One tip landed at the composer, not at each caller

The fold sits in `readQueueAtRef` (`src/pendingLedger.ts`), not in
`readQueueFiles` as the entry predicted. `readQueueAtRef` is the function that
*composes* the listing with the per-file reads, so resolving there covers every
caller at once — the decide-reads through `readQueueFiles`, `readGatedQueue`'s
gate reads, and the two direct test callers — instead of buying atomicity for
one of them and leaving the export's own comment false for the rest. Nothing in
`readQueueFiles` changed; it still hands `HEAD`.

`readFileAtRef` (`src/git.ts`) now `revParse`s the ref it is handed before
either leg. Cost: one extra `rev-parse` per call, an identity resolve for the
callers that already pass a sha (`harness/gates.ts` ×5,
`src/priorAttempts.ts`) — a spawn each, parallel, unmeasured but small. If a
later rotation wants it back, the cheaper shape is `ls-tree -z`'s object id fed
to `cat-file blob`: immutable by construction, no resolution at all, at the cost
of a non-blob row needing a verdict this change does not have to invent.

Two consequences worth a plan read:

- The `?? ""` in `readQueueAtRef` is no longer a race arm. At a fixed sha a
  listed blob cannot vanish, so a `null` there is now a name that did not
  compose or an object git will not produce. Still refused by the parse; the
  comment says so. Not dead (the parse is the defence), but its reachability is
  now repo corruption, not concurrency.
- Beyond the entry's `tests[]` line, `tests/git.test.ts` gained a pin that both
  of `readFileAtRef`'s legs name one resolved sha, read off `execArgsLog`. It
  reds on the pre-fix tree too; it is not in `pins[]`, so nothing judges it.

The straddle case needed a partial `vi.mock("../src/git.ts")` in
`tests/pendingLedger.test.ts` (the `tests/worktrees.test.ts` shape) to commit a
real sibling ship between the two legs; passthrough for every other case there.
