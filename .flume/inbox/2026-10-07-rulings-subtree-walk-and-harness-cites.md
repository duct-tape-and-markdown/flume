# Rulings: the subtree walk moves to the engine; harness comments may cite this repo's pages

Answers two questions (operator, interactive session, 2026-10-07). No spec
edit for either.

**`does-the-engine-report-a-subtrees-depth-and-order-or-does-the-package-walk-it`
— engine walks, caller orders.** The engine exports a walk of a subtree
answering each entry with its depth, the sibling order supplied by the
caller's comparator (mechanism with an injection point, `engine-boundary.md`,
*Capability vs convention*); `descendantsOf` becomes one call of it, and
`harness/goals.ts`'s own walk retires. The goal predicate (`kind === "group"`
with no `parent`), spelled in `src/queueGoals.ts`, `harness/goals.ts` and
`harness/gates.ts`, becomes one engine export. Per `engineering.md`, *A fact
the engine holds is reported, never rediscovered*.

**`may-the-harness-packages-comments-cite-this-repos-rule-pages` — (c), leave
them.** A comment citing a rule page for the shape of its own code is this
repo's authors' prose, which `engineering.md`, *Narration is the ladder's
bottom rung* leaves with its authors; consumers read the `.d.ts` hover text
and `docs/`. The posture-sweep pin stays, covering the one page that held
package mechanics. If its vacuity half loses its last *Standing lenses*
cite, its subject becomes the declared posture pages, not that page.
