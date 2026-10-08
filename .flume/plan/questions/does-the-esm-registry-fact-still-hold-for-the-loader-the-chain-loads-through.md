# Does the ESM-registry fact still hold for the loader `chain.ts` loads through?

Measured while sweeping `src/loopSupervisor.ts`. Yours: the fact is on
`platform-facts.md` and restated on `spec/loop.md`, both human-held.

## The page's claim

*Node's ESM registry is keyed by resolved URL and cannot be evicted*: "No
content-hash query string, `tsx`/`tsImport` namespace, or loader
re-registration evicts it."

## Measured — tsx 4.21 on node 22.20.0, 22.23.2 and 24.21.0 alike

A `mod.ts` importing a `dep.ts`, re-read after rewriting the dep:

- plain `import(url)` twice over a rewritten file — **pinned**. Clause holds.
- plain `import(url + "?bust=1")` — **re-read**, new value.
- `tsImport(url, …)` twice, dependency rewritten — **re-read**; dependency or
  entry broken between calls — **throws** `TransformError`.

So one clause of three holds, and the one governing `chain.ts` does not:
`tsImport` re-reads the entry *and its dependency subgraph* on every call.

## On the tree

`loadChainModule` (`src/chainLoad.ts`) loads through `tsImport`, and its doc
comment states the opposite as the design rationale: "In-process this returns a
*pinned* evaluation". `spec/loop.md`'s *Exit codes* paragraph and
`src/loopSupervisor.ts:485` lean on the same sentence.

`resolveChain` (`src/loopSupervisor.ts:528`) depends on the **opposite**: the
mount-dead re-read's chain leg is a second in-process `loadChainModule` and
decides nothing unless that load sees disk. It does. Two `src/` sites disagree
about one platform property, and nothing pins either.

## The fork

1. **Correct the page** — scope the pin to plain `import()` of a bare path;
   `src/chainLoad.ts` keeps its process-boundary conclusion on its real
   reasons (fresh state, crash isolation), `spec/loop.md` follows.
2. **Keep the page, refuse the chain leg** as evidence that is not durable
   (`engine-boundary.md`, *Told, not inferred*) — a chain-class 69 aborts
   unconditionally.

The measurement supports 1. A page edit, so it is yours.
