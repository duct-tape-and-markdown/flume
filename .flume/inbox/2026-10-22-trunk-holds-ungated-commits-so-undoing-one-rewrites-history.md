# Trunk holds a commit before it is judged, so undoing it rewinds a branch others have already copied (operator report, class — upstream suspect)

**Kind.** The merge picks a span onto trunk first and judges it there; a red
`afterMerge` gate, or a red batch, then **rewinds** trunk — `reset --keep`
to the pre-pick tip (`src/mergeSpan.ts`; `spec/worktrees.md`, *Per-entry
`afterMerge` revert isolation* and *Batched merges*). For the gate window,
trunk names a commit that may cease to exist. Anything that copies the
branch in that window holds history trunk later drops.

**Members.**
- Operator report: a rewound trunk breaks any copy of the branch made
  earlier.
- The primary checkout *is* trunk: an operator's push, a CI trigger, an
  editor, or `flume exclusive -- git push` landing in the window publishes a
  commit the rewind then removes — recoverable only by force-push, which
  this repo forbids.
- Inside the engine, to verify: the ship lock spans pick, gates and ledger
  commit, but provisioning takes only the worktree lock
  (`spec/loop.md`, *The ship lock and the worktree lock*). A slot refill or
  sibling tick provisioned during a gate window branches from the ungated
  tip; if that pick is rewound, the new span's base is no ancestor of trunk
  and its passing work is refused (`tip-moved`/`dropped-work`) — the same
  shape as the report, made by the engine against itself.
- **The machinery that exists only because trunk can hold an ungated
  commit:** the merge marker and its exit-78 refusal (`spec/loop.md`,
  *Crash equals stop*: "the picked commit may sit on trunk ungated with its
  entry still open"), `resetKeepTo` and its bystander refusal, the
  foreign-tip guard before every rewind (`checkMergedTipUnmoved`), the
  `afterMerge-revert-refused` fate, and several wave-wall causes
  (`2026-10-22-one-spans-merge-throw-walls-every-sibling.md`).

**Upstream suspect — never considered, not rejected.** Nothing in `spec/`
or `docs/` weighs the alternative: build and judge the merge off trunk — the
pick onto a candidate at the current tip, in a tree of its own — and move
trunk **only by fast-forward to a judged tip**. Trunk then never names an
ungated commit, a red costs discarding the candidate, and nothing is ever
rewound. The list above is what it would delete (tenet: subtraction first;
`collaboration.md`, *Complexity is a signal*).

**Cost, for the human.** `afterMerge` gates would run in a candidate tree
rather than the primary checkout, so that tree needs provisioning (the
install the worktree ruling already makes uniform); fast-forwarding the
primary checkout must keep bystander work safe (`merge --ff-only` refuses
as `--keep` does); and a gate that reads the primary checkout's path
changes cwd. Ruling wanted on the direction before any entry is cut
against the current shape.
