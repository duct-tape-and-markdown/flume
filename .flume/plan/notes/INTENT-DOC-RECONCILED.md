# Two more expired claims in INTENT.md, left unedited

Outside the three sites this entry's ruling named, so I did not widen the
commit. Both verified on disk this tick.

1. **A retired layer name, asserted twice.** `docs/INTENT.md:31` ("Specs,
   workshop notes, ADRs...") and `:41` ("Workshop -> specs -> plan -> code is
   the default") still name a `workshop` layer. `grep workshop
   .claude/rules/*.md .flume/PROTOCOL.md` returns nothing; `spec-plan-build.md`
   names spec / plan / inbox / notes / code. `:41` is the worse of the two: it
   states the default chain, and that is not the chain `.flume/chain.ts`
   builds (three plan slices + build).

2. **A fired sequencing predicate.** The quality-lenses section (`:67`) reads
   "arm after the v0.11 boundary line ships". `package.json` is 0.14.0, so the
   condition fired two lines back. The decision is still unexecuted — correctly
   untouched per the ruling — but its stated gate is observable-true, so the
   prose reads "not yet due" when it is due. That is the expired-narration lens
   firing on a live section. Wants a ruling (arm it, or restate the
   condition), not a build edit.
