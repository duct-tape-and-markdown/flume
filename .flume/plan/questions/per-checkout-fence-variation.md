# A consumer wants a fence per ticket; one committed declaration serves every checkout

Reported by a downstream consumer (developertools, DEV-9565) on 0.17.0,
alongside the `docs/LAYERS.md` claim now queued as
`LAYERS-NAMES-NO-RETIRED-DECLARATION-FIELD`.

`spec/jobs.md`, *The checkout is the unit of isolation* settled the axis: one
state root per checkout, the engine partitions nothing below it, and an effort
is a checkout the operator mints. That ruling is sound and I am not asking to
reopen it. The consumer's need survives it anyway, one level up: an autonomous
run wants **a different `fence.build` per ticket**, and `declaration.ts` is
one committed file every checkout of the repo shares.

Their bridge writes `.flume/effort.json` and has `declaration.ts` read it at
chain load, substituting `fence` and gate names. That is a sidecar standing in
for a declaration surface, and `.claude/rules/engine-boundary.md`, *Surface,
not prescription* names the detector exactly: "A block that appears unchanged
in every consumer's chain is a missing surface, not a chain concern."

One data point is not "every consumer" — but this repo's own chain would want
it the moment two efforts run here, so the second implementation is not
hypothetical.

## Options

1. **Sanction the sidecar in `docs/`.** `declaration.ts` is already a
   TypeScript module whose fields may be values with behavior; reading a
   gitignored file at load is within what it can do today. Write the shape up
   in `docs/CHAIN-AUTHORING.md` so consumers converge on one spelling instead
   of each inventing it. Zero engine change; leaves every consumer carrying
   the same block, which is the thing the rule calls a missing surface.
2. **A declaration surface for per-checkout variation.** `fence` (and gate
   names) become a function of resolved facts the engine already holds, the
   way `worktreesBase` is a function over the roots. The engine supplies the
   facts, the consumer supplies the value — capability, not convention. Needs
   a decision on *which* fact identifies the checkout: the worktree path, a
   declared name, an env var the engine passes through.
3. **Decline.** The fence is per-repository by design; a consumer wanting a
   per-ticket fence forks its declaration per checkout and lives with the
   merge. Honest, and it makes `declaration.ts` uncommittable for them.

I'd take 2, with the identifying fact being the resolved roots the declaration
already receives — it is the same shape `worktreesBase` took last week, so
there is precedent for the surface rather than a new concept. But "which fact
names a checkout" is a design decision I should not make silently, and 1 is
genuinely cheaper if this stays one consumer's need.

Filed from
`.flume/inbox/2026-09-22-no-per-effort-fence-on-the-declaration.md`.
