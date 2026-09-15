# Retired release-corpus cites: what the cut left behind

Three residues this entry did not cover.

1. `scripts/smoke-install.mjs:191` justified `--no-save` by the v0.7 §10
   engine↔pin handshake — a mechanism v0.9 removed from the tree (no
   `handshake` hit survives outside that comment). The rationale died with
   the cite; the comment now states only the live reason. Same class may sit
   elsewhere: a cite whose *claim* is retired, not just its number.

2. Bare release-line references carry no `§` and so fell outside the
   acceptance: "selection is identical to v0.2", "preserves v0.2
   pickability" (tests/), "the v0.6.1 dogfood symptom" (src/git.ts:21).
   Era-scoped prose, `engineering.md` *Prefer the condition to the era*.

3. `docs/` still carries ~90 numbered cites. `CHAIN-AUTHORING.md`'s are
   self-references to its own sections (live); `docs/surveys/consumer-chains/*`,
   `PRD-dock-collapse.md` and `README.md` carry dead RELEASE-v0.N ones.

Unrelated: the whole integration lane run (`pnpm test:integration`) fails
loop-process-boundary's tip-claim test on contention; reproduced on the base
tree. The file passes alone. Pre-existing, not this entry.
