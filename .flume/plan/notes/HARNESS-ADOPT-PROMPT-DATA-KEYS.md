# The package's data-key claim has no spec sentence

`spec/harness.md`, *The prompts and their discipline*, states one property of
the shipped prompts (the no-commit vocabulary comes from the engine). It does
not state the one this entry just made structural: **every value the package
substitutes is data**, so every phase the factory returns declares all of its
`promptArgs` keys in `promptDataKeys` and no package code touches the values.

`spec/prompt.md`, *The render pipeline*, owns the engine half — "a phase that
substitutes content it did not author declares those keys as data". The
package half (that this package always does, for every key) now lives only in
doc comments on `SHARED_PROMPT_DATA_KEYS`, `BUILD_PROMPT_DATA_KEYS` and
`SLICE_DATA_KEYS`, plus the agreement test in `tests/harnessChain.test.ts`.
The test pins it, so this is a spec-coverage gap, not an unheld property —
plan's call whether *The prompts and their discipline* should carry the
sentence.

Mechanism note for a future producer: the keys are the producers' return
types (`Record<SharedPromptArg, string>` etc.), so an undeclared key is a
typecheck failure at the object literal, not a test-only catch.
