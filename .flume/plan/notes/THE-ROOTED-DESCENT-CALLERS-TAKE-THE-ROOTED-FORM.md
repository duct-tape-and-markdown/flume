# A narration cite can go stale while every token in it still resolves

Shipped as written: `src/mergingMarkers.ts` and `PriorAttemptStore.readAll`
now take `isDirectoryOrAbsentUnder` for the state-root-to-one-directory
descent; the keyspace fan (`src/priorAttempts.ts`) keeps the list form, and
both doc blocks plus `STORE_SUBJECT`'s name which probe walks which rungs.

Observed, worth a lens: the third site the entry named,
`tests/examples.test.ts`, was already stale before this tick.
`examples/cascade-chain.ts` reads `api.isDirectoryOrAbsentUnder`, but the
describe block's doc still said the slice "now reads the engine's own descent
off `api.isDirectoryOrAbsent`". Both spellings are live exports, so the
citation pin resolved the token and stayed green while the sentence named the
wrong sibling. That is the general shape: **a cite into a family of near-named
exports survives a caller moving between them**, because the pin reads the
token and never the claim. The sweep's expired-narration lens is the only
thing that catches it, and only if the neighborhood read includes the
consumer the doc describes — here the doc lives in `tests/`, the caller in
`examples/`, so neither module's own neighborhood holds both.

Not filed as a finding — one instance, and the fix rode this entry. If a
second caller-moved-within-a-family drift turns up, the family is worth a
lens of its own rather than a per-site fix.

Prettier: `src/priorAttempts.ts` and `tests/examples.test.ts` both fail
`prettier --check` on the pre-change tree as well as after. No gate reads it,
so I left the pre-existing warnings alone rather than sweep formatting into a
behavior-free commit.
