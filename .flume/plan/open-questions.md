# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## 2026-05-15 — CHAIN-LOADER-MECHANISM (NEEDS AMENDMENT)

**What:** Spec §4 says ship compiled `dist/`, flip `bin/flume` to `exec node "$DIR/../dist/cli.js"`, and move `tsx` from `dependencies` to `devDependencies`. But every consumer's `.flume/chain.ts` is a TypeScript file, and `src/cli.ts:47` loads it via `await import(pathToFileURL(path).href)`. Plain Node cannot resolve `.ts` from `node_modules` (per `bin/flume`'s current header comment, `--experimental-strip-types` is rejected under `node_modules`). So **dist'd cli.js still needs a TS loader at runtime to load chain.ts**, contradicting the "tsx → devDependencies" line in §4.

**Why this is an architectural question, not a workaround:** the spec line is literally false as written. We can paper over it with an option below, but the user should pick which way the contract bends.

**Options:**

1. **Keep tsx in `dependencies`, invoke as a node loader.** `bin/flume` becomes `exec node --import tsx/esm "$DIR/../dist/cli.js"`. Smallest change, preserves "consumers author chain.ts in TS" UX. Spec §4's "tsx → devDependencies" reverts.

2. **Tsx-API dynamic import inside cli.js.** Replace the chain.ts `await import(...)` with `tsImport()` from `tsx/esm/api`. Same runtime cost as #1; tsx still a runtime dep; bin/flume can be plain `node dist/cli.js`. Slightly cleaner because the loader contract lives in code, not the bin shim.

3. **Require consumers to compile chain.ts.** Drop tsx entirely. Document `pnpm tsc -p .flume/tsconfig.json` as setup. Painful UX (chain.ts edits become two-step), but matches §4's "tsx → devDependencies" literally.

**Recommendation:** option **2** (Recommended) — tsx-API in cli.js. Keeps the consumer experience intact (chain.ts is a `.ts` file you edit and `flume tick`), keeps `bin/flume` trivial, and surfaces the load mechanism as code where it can be tested. §4 needs an amendment from "tsx moves to devDependencies" to "tsx remains a runtime dependency, used by cli.js to load `.flume/chain.ts`." If you'd rather option 1 or 3, the §4 wording flips accordingly.

This blocks `DIST-BUILD-CONFIG`, `PACKAGE-METADATA`, `BIN-FLUME-DIST`.

---

## 2026-05-15 — CHAIN-WRITABLE-PATHS-TSCONFIG-BUILD (NEEDS AMENDMENT)

**What:** Spec §4 mandates a new top-level `tsconfig.build.json`. Build phase's `writablePaths` in `.flume/chain.ts:147` lists `tsconfig.json` as an exact filename — so build cannot create `tsconfig.build.json`; the writable-paths gate would revert the commit.

**Options:**

1. **Amend chain.ts:** widen `"tsconfig.json"` to `"tsconfig*.json"` (or add `"tsconfig.build.json"` explicitly). One-line edit.

2. **Restructure spec:** fold the build-emit settings into root `tsconfig.json` directly. Rejected by the spec author already (§4 explicitly says `tsconfig.build.json` extends the dev/typecheck `tsconfig.json` — keeping the dev config strict-noEmit is intentional).

**Recommendation:** option **1** (Recommended). Trivial chain.ts amendment. `"tsconfig*.json"` is the more durable pattern (covers any future split). After the amendment lands in a `chore(flume):` commit, `DIST-BUILD-CONFIG` flips to `open` on the next plan tick.
