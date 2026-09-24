# Does vitest's missing `import.meta.resolve` get a platform-facts section?

**Page:** `.claude/rules/platform-facts.md` — the page's own preamble asks for a
source, a consequence and what to do instead. Plan cannot write it, and neither
can build: `.claude/rules/**` is the human's lane
(`.claude/rules/spec-plan-build.md`). So the fact sits nowhere until someone
rules on it.

## What was measured, this drain

- Under vitest 2.1.9's SSR transform, `typeof import.meta.resolve` is
  `"undefined"` — run as a one-case suite against a scratch root, printed from
  the test body.
- Under plain node 22.21 ESM the same expression is `"function"`; the API has
  been stable since node 20.6.

So a `src/` module that resolves a dependency's path through
`import.meta.resolve` typechecks, runs correctly under `flume`, and throws under
the suite — the one lane that would have caught it is the lane that breaks.

## What the tree already does about it

`src/budgetHook.ts` resolves the tsx loader through
`createRequire(import.meta.url).resolve("tsx")` when rendering the hook command.
That is the workaround, and nothing at the site or on any page says why it is
not the one-liner — the next module needing a loader path reaches for
`import.meta.resolve` and learns this again.

## The fork

- **(a) Home it.** One section on `platform-facts.md`: the absence, the node
  contrast, `createRequire(import.meta.url).resolve` as what to do instead, and
  the expiry — the fact leaves when a vitest transform ships `import.meta.resolve`
  and the workaround's cite goes stale. The page's frontmatter already scopes
  `src/**` and `tests/**`, so the fact reaches the modules that would trip on it.
- **(b) Leave it.** Cheapest today; it costs a debugging session the next time a
  module wants a resolved dependency path, which is what the page exists to
  stop.
- **(c) Pin it instead.** A suite case asserting the absence. It would red the
  day vitest fixes it, which is a fact expiring rather than a defect — the shape
  the page takes external facts in rather than the suite.

**What I would do:** (a). It is the same shape as the two vitest facts the page
already carries (the JSON reporter's success over a non-zero exit, chai's
40-character truncation), both measured on this vitest and both homed there.
