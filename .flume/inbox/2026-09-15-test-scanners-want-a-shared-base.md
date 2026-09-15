# Three AST scanners in `tests/helpers/` share a base nothing offers, and three vocabularies

Filed from a structural review at 57bd960, under
`.claude/rules/engineering.md` *A module is one job* (the helper and
vocabulary bullets). `exportGraph.ts` (762), `commentCitations.ts` (672),
`spawnBudget.ts` (667) are not three copies of one thing — they sit at
different tiers of the compiler API on purpose (a declaration emit plus a
second program; one checker-backed program reading trivia; a scopeless
`createSourceFile`, declared at `spawnBudget.ts:458–461`). What they share is
small and duplicated byte-for-byte, and what they do not share is
vocabulary.

**Byte-identical helpers.** `parseConfig`: `exportGraph.ts:125–139` ==
`commentCitations.ts:139–153`. `relPath`: `exportGraph.ts:264–265` ==
`commentCitations.ts:136–137`; `spawnBudget.ts:604` inlines the same
`relative(REPO_ROOT, path).split(sep).join("/")`, as does
`tests/stubRunner.test.ts:73`. The domain-program block
(`ts.createProgram({ rootNames, options })` + `getTypeChecker()`):
`exportGraph.ts:361–365` == `commentCitations.ts:573–577`. The identifier
walk (`ts.isIdentifier → getSymbolAtLocation → forEachChild`):
`exportGraph.ts:700–714` and `commentCitations.ts:611–620`. About 80–100
lines, ~5% of the three — small, and exactly what a fourth scanner would copy
again because nothing offers it.

**Three vocabularies for one concept.** Site: `ExportSite { module, name,
line }`, `CitationSite { module, line, text }`, `SpawnSite { file, line,
title, kind, budget, awaitedTimer }`. Request: `ExportScanRequest` and
`CitationScanRequest` are request objects; `scanLaneSpawnSites(lane, dir?)`
bakes `REPO_ROOT` (`:36`), the harness path (`:38`) and a relative dynamic
import of `vitest.config.ts` (`:258`) into module constants. Verdict:
`ExportScan` and `CitationScan` partition into `scanned` + named findings
with a `format*` helper; `spawnBudget` returns a flat row with `null` fields
and leaves partitioning and formatting to the test
(`subprocessHelper.test.ts:444–470`).

**Four spellings of "every `.ts` under a directory".** `spawnBudget.ts:344–356`
(`laneFiles`), `tests/stubRunner.test.ts:64–78` (`suiteFiles`),
`tests/subprocessHelper.test.ts:333–340`, `tests/PendingSchema.test.ts:27`.
Two of these are regex corpus scans living inside test files — scanners never
given a helper at all.

Target: `tests/helpers/repoProgram.ts` exporting `parseConfig`, `relPath`,
`programFor(root, config) → { program, checker, sources }`,
`sourcesUnder(program, trees)`, `eachIdentifierSymbol(sf, checker, cb)`, and
`walkFiles(dir, suffix)`; `exportGraph` and `commentCitations` become
visitors over its result, `spawnBudget` takes `root` from it. One `Site {
file, line }` base with a per-scan payload; every `scan*` takes `{ root, …
}`; every scan returns `{ scanned, findings }` and exports one
`formatSite`. The comment density (32–44% of each helper) drops with it: each
tick wrote a self-contained essay where a visitor over a shared base wants a
paragraph.

Checked and not found: comment-range extraction and vitest-registrar
detection each exist once; the emit-program host is unique to `exportGraph`
and the right shape; no consumer of any scanner outside its own test file,
so the sprawl has cost nothing yet and becomes a tax at the fourth scan.
