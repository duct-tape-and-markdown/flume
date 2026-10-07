# Does `spec/chain.md`, *What a gate receives* name `steps`, and in which of its two bullets?

`steps` ships on `GateContext` and on `GateBatchSpan` (`src/Gate.ts:258`,
`:146`), travelling with `entry` — absent on a singleton, `[]` on an
undecomposed entry — and `docs/CHAIN-AUTHORING.md:979` carries its bullet.
The spec section does not: its `entry` bullet (`spec/chain.md:547`) names
the entry alone, and its `batch` bullet enumerates a span's fields as
"its `entry`, `baseSha`, `landedOnSha` and `touchedPaths`". The section's
lead says `GateContext` **is the whole input surface**, so the corpus and
`src/` disagree by one field on a surface the section claims completely.
Plan and build cannot touch `spec/`; the edit is the human's.

The existence half has no fork — the field is public gate surface and the
lead already claims totality. Two halves do:

- **Which bullets.** Both, or the `entry` bullet alone? The `batch` bullet
  exists to enumerate what a span restates per-span, and `steps` is one of
  them (`GateBatchSpan.steps`), so leaving it out of that list leaves the
  same incompleteness one level down.
- **Does the sentence state the pairing?** The field is absent exactly
  where `entry` is, and `src/Gate.ts:146` warrants it: the pair is one
  session's assignment, and a span naming the entry without its steps
  hands a path-judging gate a footprint narrower than the engine's fence.
  Stated in the spec, that becomes the rule a chain gate is written
  against. Left out, it stays a doc comment, and the type holds nothing —
  both fields are plain optional, so `{ steps }` with no `entry` typechecks.

Note the spelling the section already licenses: *"A `GateContext` field the
dispatcher always sets is required in the type"* with `stateRootRel` as "the
one genuinely absent case … a required key carrying that absence". `entry`
is a second genuinely-absent case spelled as a plain optional instead, and
`steps` inherits that spelling. If the pairing sentence lands, whether these
two stay optionals or become a discriminated pair is the type-level question
beneath it — and the cost of a union is bounded: `Partial<GateContext>`
fronts four test helpers (`tests/Gate.test.ts:33`,
`tests/builtinGates.test.ts:76`, `tests/Prompt.test.ts:418`,
`tests/paths.test.ts:795`), and `Partial<A | B>` breaks each one. Counted on
disk this tick; the note that filed this said seven.
