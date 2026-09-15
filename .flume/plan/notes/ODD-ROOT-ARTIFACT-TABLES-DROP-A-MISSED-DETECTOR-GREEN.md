# The same skip-then-count shape survives in the guarded-span cases

Shipped as written: both odd-root loops now read a shared detector
(`promptsReadingEachArtifact` / `templatesReadingEachArtifact`) and assert
per-artifact coverage before rendering, so a table entry whose detector
matches no span reds instead of leaving the judged set.

Two siblings in `tests/harnessPrompts.test.ts` keep the weak form the entry
named — `if (!spanSubstitutes(raw, artifact.key)) continue` over
`PLAN_SLICES` × `GUARDED`, closed by a bare
`expect(asserted).toBeGreaterThan(0)`:

- `:517-532` "a cold state root renders every plan slice prompt's
  placeholder as its block's whole content"
- `:549-561` "a questions file carrying no headings renders the plan
  slices' none-open placeholder" (single-artifact: the loss is a slice)

Same class, different table: a `GUARDED` artifact no slice substitutes, or
a slice that stopped indexing the questions file, narrows the set silently.
The shared detector added here is the mechanism they would reuse; scoping
kept them out. The examples-side siblings (`examples.test.ts:684,719`)
already close with `toBe(ARTIFACTS.length)`.
