# The refusal stops at the symbol the page names

The async `realpath` (`node:fs`, `node:fs/promises`) carries the same
JS-vs-`.native` split, but the page states the fact for the sync form alone
(`.claude/rules/platform-facts.md`, *`realpathSync` keeps the `\\?\` prefix
only where nothing resolved*). So the scan's `nativeOnly` flag is set on
`realpathSync` only, and a composed path at a bare async `realpath` is
admitted. Declared at the site (`PATH_CONTRACTS`,
`tests/helpers/namespacedFsScan.ts`); widening it is one flag in that map
once the page says so.

Not live: no `src/` or `harness/` module imports the async form today. But
the first that does ships green over code that throws on win32, and the
scan's whole job is that this cannot happen where a behavior test cannot
look. Widening the page is the human's call, not a build tick's.

Also: the four realpath fixtures in `tests/namespacedFsPaths.test.ts`
collapsed to two. Once both JS-form spellings were re-spelled `.native` to
keep their axes decidable, each was byte-identical to its `NATIVE_` sibling.
