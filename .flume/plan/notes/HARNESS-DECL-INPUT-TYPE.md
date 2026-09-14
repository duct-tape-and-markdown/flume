# This repo's own declaration still annotates with the output type

`DeclarationInput` ships and `init`'s skeleton now carries `satisfies
DeclarationInput`, so every repo adopting from here on gets the tsc refusal.
This repo's `.flume/declaration.ts` predates that: it annotates
`export const declaration: Declaration`, the *parse output* side. That is
the wrong side for an authored literal — every defaulted field is required
there, which is why line 61 spells `scopeWritesToEntry: false` even though
the package's default is exactly that. The comment above it reads as a
declared choice; part of it is the type's demand.

Build cannot fix it: the fence admits nothing under `.flume/` but
`plan/notes/*.md`. It is a two-token interactive edit —
`type Declaration` -> `type DeclarationInput` in the `../harness/index.ts`
import, `: Declaration` -> `} satisfies DeclarationInput`, and
`scopeWritesToEntry` can then go or stay as a stated choice. Cheap to verify:
`.flume/chain.ts` is in tsconfig's `include`, so `pnpm tsc` already reads
that file every run.
