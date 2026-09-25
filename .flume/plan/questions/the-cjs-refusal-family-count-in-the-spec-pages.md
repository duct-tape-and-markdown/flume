# Two spec pages still call the CJS-context family two shapes; `src/` matches four

Both pages describe the same predicate and both are now behind it. Neither is
plan's to edit, so this is a ruling for you.

**Where they stand today**

- `spec/chain.md`, *A broken chain fails loudly, at two layers* (the "A
  CJS-context host is refused, not relayed" bullet, `:161`-`:165`) — names the import-outside-module shape and
  the `?namespace=` shape, correctly notes the query reaches the message in
  either spelling, and then calls the whole thing "an empirical two-shape
  family".
- `spec/cli.md`, *A CJS-context host is refused, never relayed* (`:268`-`:271`) —
  "Two empirical shapes are known", and names only the **percent-encoded**
  `?namespace=` spelling. The literal spelling shipped at 0.17.0 and this page
  never caught up, so it is one clause behind `spec/chain.md` as well as behind
  `src/`.

**What the predicate matches.** `isCjsContextLoadFailure` (`src/chainLoad.ts:244`)
has four arms, and the class doc above it (`:186`) already enumerates them as
"four, each empirical, none inferred":

1. `Cannot use import statement outside a module` (tsx 4.21's CJS-fallback parse).
2. `ERR_MODULE_NOT_FOUND` carrying `?namespace=` in either spelling (tsx 4.23).
3. A top-level await **in the chain itself** — esbuild's `TransformError`, keyed
   on the `cjs` output format.
4. A top-level await **in a module the chain imports** — `ERR_REQUIRE_ASYNC_MODULE`.

Arms 3 and 4 landed at dd805e66 with a case each under
`tests/Dispatcher.test.ts`, one per position, because the two positions are
refused by different machinery (`.claude/rules/platform-facts.md`, *tsx decides
a module's interop shape from the nearest `package.json` `type`*).

**The fork.** Per CLAUDE.md, a section that no longer matches `src/` is a defect
in one of them:

- **(a) Widen both pages to four.** Recommended. Each arm is empirically
  measured, shipped, and carries its own test; narrowing the code would drop
  refusals that reproduce on real hosts. `spec/cli.md` also wants the
  percent-encoded-only clause replaced with "in either spelling", matching
  `spec/chain.md`.
- **(b) Narrow `src/` to two.** Costs the two await refusals — a CJS-context host
  whose chain graph carries a top-level await goes back to relaying a raw
  loader stack, which is the defect both sections open by naming.
- **(c) Stop counting.** Drop the "two-shape"/"Two empirical shapes are known"
  phrasing for "the loader-failure signature family, enumerated at
  `CjsContextLoadError`" and let the class doc be the roster. Cheapest to keep
  true, at the cost of a reader having to open `src/` for the list.

Nothing in `src/` contradicts either page beyond the count and the cli page's
spelling clause, so (a) and (c) are both one edit per page.

Drained from build note `THE-CJS-CONTEXT-REFUSAL-READS-THE-AWAIT-SHAPES`.
