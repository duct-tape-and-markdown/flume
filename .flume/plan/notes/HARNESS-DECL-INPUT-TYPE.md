# Parked: shipped at 3447751, with one live debt build cannot reach

Every file this entry names already carries the work on this base.
`DeclarationInput` is exported (`harness/declaration.ts:354`,
`harness/index.ts`), the skeleton closes with `} satisfies DeclarationInput`
(`harness/init.ts:209`), and the `tests[]` line passes verbatim in
`tests/harnessInit.test.ts` — ran green this tick. Nothing is left to build,
and any re-implementation would be a test that cannot fail on the base.

Still open: this repo's own `.flume/declaration.ts` annotates
`export const declaration: Declaration` — the parse *output* side, where
every defaulted field is required, which is why it spells
`scopeWritesToEntry: false` under a comment that reads as a declared choice.
Build's fence admits nothing under `.flume/` but `plan/notes/*.md`, so this
needs an interactive two-token edit: `type Declaration` ->
`type DeclarationInput` in the `../harness/index.ts` import, and
`: Declaration` -> `} satisfies DeclarationInput`. Cheap to verify —
`.flume/chain.ts` is in tsconfig's `include`, so `pnpm tsc` already reads it.
