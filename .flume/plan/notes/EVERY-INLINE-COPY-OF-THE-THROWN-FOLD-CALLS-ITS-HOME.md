# The fold's last copy is a private alias in a module that imports the home

All 26 sites across the 16 named modules now call `thrownMessage`; the
acceptance grep is down to `src/thrown.ts:39` and `src/waveMerge.ts:211`.
13 modules gained the import, 3 already had it. Behaviour-free: no string
literal moved, tsc and the full suite green (2195 passed).

What the next rotation should look at: `refusalMessage`
(`src/waveMerge.ts:210`) is not a separate family the way the entry's scope
note read it. Its body is `thrownMessage`'s body character for character, it
takes `unknown` and returns `string` with no added arm, and `waveMerge.ts:80`
**already imports `thrownMessage`** — so it is a private alias of a function
the module has in scope, not a module-level home doing a second job. Compare
`detailOf` (`harness/exec.ts:109`), which is a real sibling: stderr-first,
then the message arm, then `.trim()`. That one earns its name; this one does
not.

Its doc comment states the reason as "one spelling, so the two cannot
describe one refusal differently" — which is the guarantee `thrownMessage`
exists to give, now given to 26 other sites. Two callers
(`src/waveMerge.ts:151`, `:1332`); the fix is deleting the wrapper and
pointing both at the import already there, and it closes the grep to the home
alone.

I left it as the entry scoped it (the file was in flight) rather than widen
past `files`. Worth noting the family's *filing* premise was 26 inline
copies; this is the 27th site by behaviour and the only one left, so a
one-line follow-up entry finishes the family rather than leaving a standing
exception the next sweep has to re-decide is deliberate — its comment does
not cite the divergence, so `posture-sweep.md`, *Routing*'s last line does
not protect it.
