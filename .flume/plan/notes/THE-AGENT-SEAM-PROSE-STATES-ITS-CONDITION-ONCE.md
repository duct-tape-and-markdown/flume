# A third statement of the one-provider fact sits on the authoring page

The two era-scoped copies named in the entry are gone: `src/Agent.ts`'s
header now points at `{@link Agent}`, and the `Agent` interface's doc states
the fact once as its condition (a second implementation exists once another
CLI is adapted to the interface). `grep -niE "v0|pre-1.0|0\.x"` over `src/`
is empty; the other `currently` hits there describe live state, not an era.

Observed and deliberately left: `docs/CHAIN-AUTHORING.md:1481` ("The package
ships one implementation, `claudeCode()`, plus two decorators") states the
same count a third time. Left standing because it is the consumer surface
describing a shipped interface, which `engineering.md`, *Narration is the
ladder's bottom rung* carves out for exactly that — not a second copy of a
decision, and carrying no era and no revisit trigger. But nothing mechanical
holds it against the tree: adapting a second CLI reds no pin and that
sentence goes quietly wrong. If plan wants the count held at one home, the
page's sentence points at the seam and the number lives only there.
