# Ruling: delete the dead release cites; keep spec/*.md cites (human)

Closes *180 doc cites in src/ point at a spec corpus that no longer exists*.
Option B. A cite nothing can follow is narration below the bottom rung; git
carries provenance. Delete every `RELEASE-v0.N §M` / `v0.N §M` cite in
`src/` and `examples/`, keeping cites into `spec/*.md` and
`.claude/rules/*.md`; where a sentence loses its only justification, keep
the sentence if it is still true, else drop it. Promotion in the same pass:
`tests/retired-narration.test.ts` refuses any new cite matching that
grammar outside a declared-historical marker. Split by module if one entry
cannot land green in a tick.
