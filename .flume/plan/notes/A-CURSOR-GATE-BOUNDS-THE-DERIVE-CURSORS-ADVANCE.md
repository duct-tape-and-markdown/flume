# The cursor gate needed an engine surface for ancestry

`harness/gates.ts` had no way to ask git whether one sha reaches another, so
the gate landed with `isAncestor` added to `FlumeApi.git` (`src/flumeApi.ts`)
beside `readFileAtRef`/`statusRecords`. It was already exported from
`src/git.ts` and already run on the engine's own tip-verify leg; this only
hands the fact out. Engine surface change, so worth plan knowing.

Two consequences:

1. The package's discipline gates are now five, not four. Prose saying "four"
   was updated in `harness/gates.ts`, `harness/declaration.ts` and the two
   ordering tests. `docs/CHAIN-AUTHORING.md` still lists "the `per` / records
   / clean-tree gates" - already illustrative (it omits the pending gate), so
   left alone. Flagging in case plan wants it exhaustive.
2. The gate selects plan commits by the touched path, never by phase name, so
   build skips for free. The leading-run half of the bound stays judgement,
   out of the gate, per the entry note.

A cursor naming a sha the repo does not hold throws out of `merge-base`
rather than reading as "not an ancestor": telling a bad revision from a
broken repo would mean reading git's English.
