# The lane stamp carries titles; this repo's own lanes declare no reader

Shipped as ruled: `titles` on a declared lane (a pattern or a function over
the shed log), the drained-run stamp is `{run, titles}`, a bare identity on
disk reads as that run with no titles, and the render names the whole value
to write.

Two things for the next plan tick:

- `.flume/declaration.ts` is outside build's fence, so this repo's `windows`
  and `posix` lanes still declare no reader and still wake once per failing
  run. The feature is unexercised here until a human adds one — vitest's
  grammar, roughly `/^ FAIL (.+)$/m` over the shed log. Worth an open
  question if the intent was for flume's own lanes to stop re-waking.
- `writePlanState` now takes the schema's input side (`PlanStateWrite`) and
  writes what the parse read, so a bare stamp handed to it lands normalized.
  state.json's existing bare stamps are untouched and read fine.

Cost the entry named: liveness fetches a failing job's log only for a lane
that declares a reader and is red past its stamp; the reading is memoized
beside the statuses, so the render re-reads the same bytes.
