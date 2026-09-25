# The two spec pages still say the family has two shapes

`isCjsContextLoadFailure` now matches four. `spec/chain.md`, *A broken chain
fails loudly, at two layers* calls it "an empirical two-shape family"; `spec/cli.md`, *A
CJS-context host is refused, never relayed* says "Two empirical shapes are
known" and names only the percent-encoded `?namespace=` spelling (the
literal one shipped at 0.17.0 and the page never caught up). Both are the
human's to widen; nothing in `src/` contradicts them beyond the count.

Correction to this entry's `notes`: `ERR_REQUIRE_ASYNC_MODULE` does
reproduce, and the platform-facts section's two-position reading is exactly
right. The prior tick measured it under `node --import tsx`, where the
loader is registered process-wide and the dependency's await reaches
esbuild first. Under the suite's `tsImport`-only registration the positions
separate as the page says. Measured this tick, tsx 4.21, node 22:

- `type: "commonjs"` + await in `chain.ts` -> `TransformError`, `"cjs"
  output format`.
- no `type` + `import "./dep.ts"` whose dep awaits -> `ERR_REQUIRE_ASYNC_MODULE`.
- `type: "commonjs"` + any static import in `chain.ts` -> the pre-existing
  import-outside-module arm fires before the dependency is transformed, so
  the dependency position is unobservable under that spelling.
- `type: "module"` + the same dep graph -> loads clean (the control case).

That third row is why the two await cases use different manifests; a reader
who "normalizes" them to one spelling will silently re-test one arm twice.

Debt, not filed: the message a `TransformError` carries reaches the
operator only inside the refusal's parenthetical debugging detail, so the
file holding the await is findable but not headlined. Fine while the fix is
one field in one manifest; worth revisiting if the family grows a shape
whose fix is not `"type": "module"`.
