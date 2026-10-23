# Does the `tsImport` platform fact separate the re-transform from the re-evaluation?

`.claude/rules/platform-facts.md`, *A plain `import()` is pinned; `tsImport`
re-reads* states:

> `tsx`'s `tsImport` is not: it re-reads the entry and its dependency subgraph
> from disk on every call, and a module broken between two calls throws
> `TransformError` rather than returning the earlier evaluation.

Two behaviors are fused there, and they do not have the same scope.

**Measured, tsx 4.21 under node 24.21, two fixtures differing only in the
nearest `package.json`** (re-measured this tick, independently of the build
tick that first reported it):

| manifest | second `tsImport` of a path rewritten between calls | a module broken between calls |
| --- | --- | --- |
| `"type": "module"` | answers the new bytes (`"A"` -> `"B"`) | throws, transform error |
| CJS context (no `type`) | answers the **first evaluation** (`"A"` -> `"A"`) | throws, transform error |

So the transform re-runs on every call under both manifests — the page's
stated consequence holds everywhere, and nothing that leans on it is wrong.
What does not hold everywhere is the premise as worded: under a CJS-context
manifest the module object is the one the process already built, and no query
on the URL busts it. A reader taking "re-reads … on every call" as
"re-evaluates" gets the wrong answer for half the manifests, and that is
exactly the reading a doc comment in `src/chainLoad.ts` carried until
`72e22a74` corrected it.

That comment now states the conditional measurement inline and cites this page
for the unconditional half — a measured external fact living in a code
comment, which `CLAUDE.md` calls "a copy the harness should own instead, seen
only by an agent that already opened that file."

## Options

1. **Split the premise in the page; the comment shrinks to a pointer.** Two
   sentences where there is one: the transform re-runs on every call, so a
   module broken between two calls always throws; whether the module is
   *re-evaluated* follows the nearest manifest's `type` — plain ESM re-reads,
   a CJS context answers the prior evaluation. `src/chainLoad.ts` then cites
   the page instead of restating the measurement
   (`engineering.md`, *Narration is the ladder's bottom rung*).
2. **Leave the page and keep the measurement at the one site that needs it.**
   Only one caller in the tree cares which answer a second load gives, and it
   already states it correctly. Cost: the page stays wrong for the next reader
   who needs the distinction, and this repository has now paid for that reading
   once.
3. **Narrow the page's claim to the shape the package supports.** The package
   supports `"type": "module"` only (`CjsContextLoadError` refuses the other),
   so state the ESM row and drop the CJS one. Cost: the CJS answer is what the
   corrected comment measured and the reason it was corrected; dropping it
   invites the same mistake back.

**Recommendation: 1.** The distinction is the whole reason the comment was
wrong, the page's own posture is "cite the source, state the consequence", and
the second sentence is as cheap as the first. It also lets the `src/` comment
shrink, which is the rung the fact belongs on.

The page is `.claude/rules/`, so this is a human's edit either way; the shrink
at `src/chainLoad.ts` is a build entry that waits on the ruling.
