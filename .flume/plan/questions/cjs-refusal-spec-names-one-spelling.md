# `spec/chain.md` names one spelling of the CJS namespace query; the refusal matches both

`spec/chain.md`, *A broken chain fails loudly, at two layers* (line 157)
describes the second CJS-context shape as an `ERR_MODULE_NOT_FOUND` whose path
carries tsx's **percent-encoded** `?namespace=` query. Since
`CJS-REFUSAL-MATCHES-THE-LITERAL-NAMESPACE-QUERY` shipped,
`CJS_CONTEXT_NAMESPACE_QUERY` (`src/chainLoad.ts`) is
`/(?:\?|%3F)namespace(?:=|%3D)/i` — both spellings, which is what the 0.17.0
win32 report required.

So the sentence is now narrower than the behavior: spec and `src/` disagree,
and this one is the spec's side (the widening is the fix the win32 host
needed). It is the same narration/behavior gap that entry was filed for, one
layer up.

No fork worth costing — the proposed edit is one phrase, "percent-encoded" →
"in either spelling", with the "(an empirical two-shape family)" parenthetical
left as it reads. Filed rather than accepted as debt because `spec/` is the
human's surface and a build tick cannot reach it, and because a spec sentence
narrower than the guard it describes is what the next derive tick will read as
a missing case.

Filed from the build note on `CJS-REFUSAL-MATCHES-THE-LITERAL-NAMESPACE-QUERY`.
