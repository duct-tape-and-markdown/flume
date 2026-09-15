# A fourth name enumeration sits 45 lines above the one this entry shrank

Shipped as written: the `job new` bullet (docs/CHAIN-AUTHORING.md:132) now
points at `spec/jobs.md`, "Runtime ignores" and names no line.

Left standing, deliberately: **Harness-managed state**
(docs/CHAIN-AUTHORING.md:88-90) spells nine of the ten ignore entries plus
`plan/pending.json`. I read it as a different claim — *which names the
runtime spells itself, so you neither author nor move them*, with
`sessions/` called out as not among them — not a copy of the `.gitignore`
set: it carries `plan/pending.json`, never ignored, and omits
`node_modules/`, which is. So "names no runtime ignore line" reads as
scoped to the ignore claim, and I did not widen.

Worth a decision either way: if it *is* a fourth copy, no single spec
section owns the set it states, so it cannot shrink to one pointer — it
needs a spec-side home first, which is the human's lane, not an entry plan
can file against `docs/` alone.
