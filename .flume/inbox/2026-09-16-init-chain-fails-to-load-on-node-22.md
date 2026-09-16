# A CommonJS-scoped chain cannot load the package on node 22.23; init writes one (pilot report from a win32 consumer on node 22, relayed by the operator)

Measured here against the published 0.16.0, three chain shapes × node
22.20 / 22.23 / 24 (`.claude/rules/platform-facts.md`, *A CommonJS-scoped
`chain.ts` stops loading the ESM-only package at node 22.23*):

- the chain `flume-harness init` writes fails on every node 22 with no
  `"type": "module"` in scope (the pilot's `./declaration.js`), loads on 24;
- a hand-written chain with a runtime import from the package loads on
  22.20 and **dies on 22.23** — the pilot's working bay broke on a node patch
  upgrade, and every existing consumer in that shape is one upgrade away;
- a nested `.flume/package.json` of `{ "type": "module" }` fixes all of it
  on every node; a tsconfig does not.

Ruled at `spec/harness.md` *Adoption and upgrade*: init writes the nested
manifest; the install smoke runs init over `npm init`'s manifest and loads
the chain it wrote; `init --help` answers usage; the migration note leads
with the manifest step for existing consumers. This wants a 0.16.1.
