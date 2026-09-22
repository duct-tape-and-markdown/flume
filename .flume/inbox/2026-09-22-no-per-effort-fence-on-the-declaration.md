# No per-effort fence field on the declaration; LAYERS.md names one

Reported by a downstream consumer (developertools, DEV-9565) on 0.17.0.

`docs/LAYERS.md:73` names `jobs` — "a named fence and spec locus per unit
of work in one checkout" — as a declaration field; line 120 credits it too. `harness/declaration.ts` carries none:
`fence.build` is one list per checkout. The job cut made an effort a
checkout (`spec/jobs.md`, *The checkout is the unit of isolation*), so the
page states a field the cut retired, and the docs declaration pin reads
one direction only (schema ⊆ page), so it stayed green.

The consumer's need survives the cut: an autonomous run wants a fence per
ticket, and one committed `declaration.ts` serves every checkout. Their
bridge writes `.flume/effort.json` and the declaration reads it at chain
load, substituting `fence` and gate names — a sidecar standing in for a
field. Ask: either a declaration surface for per-checkout variation, or
`docs/` sanctioning the read-a-sidecar-at-load shape so consumers converge
(`engine-boundary.md`, *Surface, not prescription*: a shape every consumer
copies is a missing surface). The LAYERS claim is mechanical either way.
