# The chain `flume-harness init` writes cannot load on node 22 under a CommonJS manifest (pilot report from a win32 consumer on node 22, relayed by the operator)

Reproduced here from nothing against the published 0.16.0: `npm init`-shaped
manifest (no `type`), `npx flume-harness init`, `npx flume status` — on
node 22 the chain fails to load (`Cannot find module …/dist/harness/index.js
?namespace=…`; the pilot saw `./declaration.js` on win32, same root), on
node 24 it loads. `tsx` loads `chain.ts` as CommonJS when no manifest says
ESM, and the package is ESM-only. A `.flume/tsconfig.json` does not fix it;
`"type": "module"` on the consumer manifest does, and so does a nested
`.flume/package.json` with only that field — measured on both nodes.

Ruled at `spec/harness.md` *Adoption and upgrade*: init writes the nested
manifest (the consumer's own files are untouched), and the install smoke
runs init over `npm init`'s manifest and loads the chain it wrote, so both
lanes hold it on node 22. Also ruled: `init --help` answers usage, exit 0.
