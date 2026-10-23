# Does a `declaration.ts` ship its value as the module's default export?

`spec/harness.md`, *What a consumer declares* opens with:

> One declaration module beside the consumer's state root — `declaration.ts`,
> a TypeScript module, because some of its fields are values with behavior …

It names the file and the field table and stops there. It does not say how the
package gets the value out of the module. Two readers now disagree, and both
ship:

- **`chain.ts` reads a named export.** The hop `flume-harness init` writes is
  `import { declaration } from "./declaration.js"`, handed to
  `harnessChain({ api, declaration })`. The package never loads the module
  itself on this path — the consumer's own `chain.ts` does the import.
- **The `rails` gate reads the default export.** It loads
  `<configDir>/declaration.ts` through `api.loadModuleDefault`, which answers
  `ns.default` and nothing else, then parses it. A module with no default
  export answers `undefined`, the parse throws, and the gate refuses: *"the
  declaration <sha> holds does not load as one, so the rails it states cannot
  be read."*

The skeleton init writes carries both (`export const declaration` *and*
`export default declaration`), and this repository's `.flume/declaration.ts`
lacked the default until the rails gate landed. So the convention holds today
by what init happened to emit, not by anything stated.

**The failure is loud, not silent.** A consumer whose declaration has no
default export gets a red gate on the first build commit that touches the
file — not a wrong rails verdict. So nothing is at risk; what is wrong is that
the requirement is discoverable only by tripping it, and the error message
names the parse rather than the missing export.

`docs/CHAIN-AUTHORING.md` is no better: its row reads "`<stateRoot>/declaration.ts`,
one module exporting one object".

## Options

1. **State the default export in the spec row, and keep both exports.** One
   clause in *What a consumer declares*: the module's default export is the
   declaration, and a consumer's `chain.ts` may import it under any name it
   likes. The named export in the skeleton stays as the ergonomic import.
   Cost: the file carries two spellings of one value, which reads as
   redundancy to anyone who does not know the gate is the second reader.
2. **Make the package read one export, and state that one.** Have the hop
   `init` writes use the default too (`import declaration from "./declaration.js"`),
   drop the named export from the skeleton, and state the default export in the
   row. One convention, one reader's worth of surface. Cost: a breaking change
   for every consumer whose `declaration.ts` exports only the name — loud at
   their next declaration edit, same refusal as today.
3. **Have the gate accept either.** `loadModuleDefault` answers the default; a
   sibling that falls back to a sole named export would accept both shapes.
   Cost: a second loader convention the engine invents and the spec would then
   have to state in full ("default, or the only export"), which is more surface
   than either option above, for a case that already fails loudly.

**Recommendation: 1.** It is one sentence against a working tree, it breaks no
consumer, and it is honest about what is actually true — the declaration file
has two readers with two needs, and the package's own skeleton already serves
both. Option 2 is the cleaner end state and is worth taking at a version that
is already breaking something in this area; option 3 spends engine surface to
avoid a refusal that is doing its job.

Either way the row is the human's to write: the package now depends on a
convention the corpus states nowhere, and filling that from a plan tick would
be the agent authoring spec.
