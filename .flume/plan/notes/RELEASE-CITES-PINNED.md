# Bare `§N` survives the grammar; docs/ still carries cites

Two residues the pin does not reach:

1. **`src/Agent.ts:501`** — "(the dispatcher's §6 clean-exit record)": a bare
   `§N` with no version token nearby, so `RELEASE_CITE_RE` never flags it,
   yet it points at the same deleted corpus. Two more sat in the declared
   example files ("(§§2-4)", "see §6") and were cut with the rest. Every
   other bare `§` in `src/` is live — quoted test titles, `MIGRATING-0.10.md`
   cites — so widening the needle to bare `§` would delete working
   references. The lens wants a different shape, not a looser regex.

2. **`docs/`** — the 2026-09-11 ruling put it out of scope, and five pages
   still carry the grammar: `CLI.md`, `CASCADE-DRY-RUN.md`,
   `CHAIN-AUTHORING.md`, `PRD-dock-collapse.md`, and `MIGRATING-0.10.md`
   (that last legitimately — a migration guide shows the shape you leave).
   Once those are cut, adding a root to `CITE_SCANNED_ROOTS` is the whole
   cost. `README.md` is already clean.
