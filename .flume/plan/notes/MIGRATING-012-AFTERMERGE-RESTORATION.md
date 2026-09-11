# "Restoration of v0's" is unsupported by git; examples/ still teaches afterCommit

Two things the ruling's premise turned up.

1. The ruling says afterMerge is "where v0 put correctness gates before
   afterCommit became the documented placement." Git says otherwise:
   `examples/cascade-chain.ts` shipped tsc/vitest/eslint at `afterCommit` from
   init (fa0a770), and the dogfood chain only moved vitest to `afterMerge` at
   5f2ae5e (0.10 line, §7a). What *is* true since v0.1 is the gate point's
   meaning — `src/Gate.ts` has defined `afterMerge` as the merged-tree check
   throughout. I wrote the line on that claim, not the restoration one, so the
   guide states nothing history contradicts while still telling an unmoved
   chain it is compliant.

2. `examples/cascade-chain.ts` still places every gate at `afterCommit`
   (:109 and the tsc/vitest/eslint builtins on `build.gates`), with a comment
   at :153 reading "an afterMerge failure (none here...)". The living
   reference teaches the placement `spec/chain.md` *Gate placement* and §1
   both argue against. Consumer-facing; not filed.
