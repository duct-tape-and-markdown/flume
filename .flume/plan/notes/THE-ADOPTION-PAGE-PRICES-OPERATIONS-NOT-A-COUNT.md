# One unpinned copy of the operation list survives the count deletion

The three counts are gone. The lead-in (`docs/CHAIN-AUTHORING.md:129`) now
points at `Runner`'s operations rather than re-listing them: the standing pin
(`tests/examples.test.ts`, "the adoption section names every operation Runner
declares") walks only the *What adoption costs* bullets, so a list spelled in
the lead-in would be a second copy no pin reads, stranding on a fourth
operation exactly as "three" did.

Left standing, for a later entry: `:180` still spells "over `run`,
`runAtBase` and `lanes`" three lines above the pinned bullets walking the same
set. A list, not a count, so this entry's acceptance ("each names the
operations instead") kept it -- but it is a restated copy beside its source
(`engineering.md`, *Derived state is computed*) and the pin's bullet regex
does not reach it. Either delete the inline list or widen the pin's reader.
