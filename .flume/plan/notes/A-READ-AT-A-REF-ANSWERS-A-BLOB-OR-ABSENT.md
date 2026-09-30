# The at-ref read is a blob or nothing; the row decode is now shared

Shipped as specified. `readFileAtRef` (`src/git.ts`) lists with `ls-tree -z`,
reads the row's type and object id, and answers `null` for any non-blob row;
the content leg is `cat-file blob <oid>`. The `revParse` fold is gone — an
object id cannot move, so the one-tree property is structural. `treeRows`
decodes the row shape once for both readers; the `-z` rationale moved from
`listTreeBlobNames`'s header to that decode, which is the site that decides
on it.

Two things beyond the entry's letter, both deliberate:

1. **One extra guard.** The row taken is the one git printed *for exactly the
   pathspec asked for*. Without it, a pathspec ending in a separator lists the
   directory's *children* (measured: `ls-tree HEAD -- a/` prints `a/b`), and
   the first child being a blob would answer the read with that child's bytes
   — the same substituted verdict one level down. Exercised by the directory
   test, which reads `dir` and `dir/`.
2. **`cat-file blob`, not `show <oid>`.** The type rides the verb, so git
   refuses an object that is not a blob instead of printing a listing. Belt
   over the branch, not instead of it.

Downstream effect worth recording: `harness/citeResolver.ts` now gets `null`
for a `per` whose path is a directory, so its refusal names the **path** at
fault rather than the section — the half the entry said was misblamed.

No debt observed. Whole suite green (2181 passed), `pnpm tsc --noEmit` clean.
Both `tests[]` lines verified red on `HEAD`'s `src/git.ts` with the new tests
in place.
