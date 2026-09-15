# Ruled: the export-nameability scan reads the emitted `.d.ts`, not a source-node proxy

Closes the open question *The export-nameability scan walks source type
nodes as a proxy for the emitted `.d.ts`*. Option 1, the recommendation.

The pin's title claims what a chain author's hover text names, and the real
producer of those names is `tsc`'s declaration emit. A walk over source type
nodes re-implements that emit and drops every declaration it reads no
position from — eight reached constants today, silently unjudged, and the
first un-annotated export whose inferred type is a class name puts an
unimportable name in the hover text with the pin green over it. That is the
seam defect `.claude/rules/engineering.md` *A seam gate reads what the real
writer wrote* names, and closing its gap classes one at a time is the tail
the question declined to chase.

So the scan runs the build config's declaration emit and walks the `.d.ts`
type references. The cost is one `tsc` emit in the default lane; the scan
already resolves `outDir`/`rootDir` and the fixture arms already build a real
tsconfig. If the emit's cost measures past what the lane can carry, the fix
is to scope the emit, never to fall back to the proxy — and the entry says
what it measured.

Option 2 is refused on its own terms: a declared hole is still a hole in a
pin whose whole job is the hover text. Option 3 is a house style rule wearing
a pin.

No rule page moves; the cited section already holds the ruling. Derive files
the entry from this record.
