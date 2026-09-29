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
   the reverted commit touched" — and
   THE-REVERT-SNAPSHOT-COVERS-THE-SPAN-IT-DIGESTS has since **shipped**
   (`5a499e00`), widening the snapshot to the span on the strength of that
   section's *guarantee* ("recovery must never require reading session logs").
   → "the span the tick added" in both, or rule the snapshot head-only, which
   is now a revert of shipped code rather than a dropped entry.

   **And one boundary the guarantee does not state either way.** Measured on
   git 2.43.0: `git diff --name-only base head` compares the two end trees, so
   a path an earlier commit in the span created and a later one deleted is
   named by *neither* side and never reaches the listing — and it has no
   post-image at `head` to read, so it is unrecoverable however the listing is
   taken (`git log --name-only base..head` names it and still offers nothing).
   `--diff-filter=d` therefore only ever drops paths the base already held. So
   what ships is "every file the span's **head still holds**", not "every file
   the span touched". → if the ruling widens the sentence to the span, say
   which of those two it means; the fact itself is asked separately at
   `does-the-range-diff-sees-two-trees-fact-get-a-platform-facts-section.md`.

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
