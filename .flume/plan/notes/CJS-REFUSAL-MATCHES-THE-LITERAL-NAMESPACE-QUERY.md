# The spec sentence still says percent-encoded only

`spec/chain.md`, *A broken chain fails loudly, at two layers*, describes the
second CJS-context shape as an `ERR_MODULE_NOT_FOUND` whose path carries
tsx's *percent-encoded* `?namespace=` query. The refusal now matches both
spellings, which is what the win32 report required, so the spec sentence is
narrower than shipped behavior — the same narration/behavior gap this entry
was filed for, one layer up. Build cannot edit `spec/`; this wants the
human's widening ("percent-encoded" -> "in either spelling").

Also: the describe doc in `tests/Dispatcher.test.ts` cited
`isCjsContextLoadFailure` as living in `Dispatcher.ts`; it has lived in
`src/chainLoad.ts` since the load split. Corrected here. The citation pin
reads the pair form `` `name` (`src/file.ts`) ``, and that cite was a
comma-separated name/file list, outside the pin's grammar — so nothing
caught it.
