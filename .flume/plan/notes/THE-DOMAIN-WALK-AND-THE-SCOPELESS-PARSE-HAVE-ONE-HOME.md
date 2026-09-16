# The scopeless parse had a third copy, in spawnBudget.ts

Shipped as named, plus one file the entry did not list.
`tests/helpers/spawnBudget.ts` held a third `parse(path)` — the same
`createSourceFile` with the ScriptKind arm left off, which is what
`createSourceFile` infers anyway for the `.test.ts` paths it walks. Leaving it
would have homed a helper while a literal third spelling sat in a sibling, so
it adopts `parseScopeless` too. Behavior-identical; the lane's spawn suites
hold it.

Two effects worth knowing. `spawnCaps` gains `modulesUnder`'s `isDirectory`
refusal, which `spawnCapModules` lacked — an absent tree now reds as an absent
tree rather than as an ENOENT out of the walk. And its two refusal messages are
now the shared wording; both `tests/spawnCaps.test.ts` regexes still match, and
neither asserted the spawn-cap phrasing.

Not adopted: `hostDeclarations.ts`'s `createSourceFile`. It takes source
*text*, not a path, on purpose — the scan's own cover drives it over a fixture
— so it is a different shape, not a fourth copy.
