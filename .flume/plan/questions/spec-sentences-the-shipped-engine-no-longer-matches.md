# Six spec sentences the shipped engine has outgrown — which way does each go?

Six build notes drained this tick each ended at one `spec/` sentence narrower
than, or silent on, what the tree now does. Each is a one-line ruling, and none
is an autonomous phase's to make; filed as one page so they read in one pass.
Every item was verified against the tree this tick.

1. **`spec/chain.md`, *The chain is a plugin, not a consumer*** types
   `DispatcherOptions.chainLoader?: () => Promise<ChainModule>`; it is now
   `() => Promise<LoadedChain>`, because the load evaluates
   `Chain.worktreesBase` and reports the resolved base beside the module. The
   resolved base was deliberately *not* put on `ChainModule`, since the same
   bullet enumerates that type as a factory's return and a factory-filled field
   would be silently dropped by the load. → retype the loader bullet, or rule
   the base onto `ChainModule` and accept that.

2. **`spec/cli.md`, *A log line carries the instant it was written*** scopes the
   stamp to "the CLI's supervisor and its tick children". Four refusals now
   reached before the verb branch stamp `status`, `log`, `check`, `render` and
   `friction` too (bay discovery, the bay/root disagreement, state-root
   resolution, an obstructed root). → widen to every line the CLI writes as
   narration, or name the pre-verb refusals as the exception it already
   tolerates.

3. **`spec/loop.md`, *Prior-outcome feedback to the retrying tick*** calls the
   gate-revert digest "a `git show --stat` digest of the reverted commit"; the
   engine digests the span (`base..head`). **`spec/worktrees.md`, *Reverted
   prose survives the reset*** has the same wording — "every non-deleted file
   the reverted commit touched" — and this tick filed
   THE-REVERT-SNAPSHOT-COVERS-THE-SPAN-IT-DIGESTS to widen the snapshot to the
   span on the strength of that section's *guarantee* ("recovery must never
   require reading session logs"). → "the span the tick added" in both, or rule
   the snapshot head-only, which retires that entry.

4. **`spec/pending.md`, *Queue reads are strict*** lists the strict reads as
   "the singleton and fanout decide-reads and the wave-end rewrite read". A wave
   takes the fanout decide-read twice — once opening, once per freed slot — and
   the two differ in consequence: the opening one refuses before any agent ran,
   the refill one refuses with spans already on trunk. → name the refill read,
   or state that one read has two consequences and leave the count at three.

5. **`spec/harness.md`, *The gates the discipline needs*** enumerates five gates
   plus the merged-tree claim check; the package now ships a sixth, `filing
   band` (every added entry's `priority` against `harness/filingBands.ts`). →
   add the sentence, or rule the band gate outside that roster's scope.

6. **No section enumerates `MergeOutcome`'s kinds.** `spec/chain.md` elides
   them, `spec/loop.md`'s verdict section names the pair but not the kinds, so
   the roster lives only in the doc comment over the type — and `wave-walled`
   joined it with no spec sentence to answer to. → roster the kinds in `spec/`,
   or rule the union's roster the type's own, so a new kind needs no cite.
