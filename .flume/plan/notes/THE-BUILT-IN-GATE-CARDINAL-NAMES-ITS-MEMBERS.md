# The built-ins list omits `chainLoadGate` entirely

Pinning the bullet forced an enumeration of every runtime export of
`src/builtinGates.ts`: shellGate, tscGate, vitestGate, eslintGate,
chainLoadGate, pendingGate, writablePathsGate. `flume` (`src/flumeApi.ts`)
hands a chain author all seven.

`docs/CHAIN-AUTHORING.md` names six. `chainLoadGate` gets zero hits on the
whole page, not just an absent bullet under "Use the built-ins first" — so a
chain rewriting its own `chain.ts` can only find the gate through hover text.
Out of scope here (this entry was the `shellGate` claim); a bullet would want
its own pin.

The new pin covers every export of the module by name, so it reds when a gate
is added and nobody classifies it — but it says nothing about whether the page
lists one. The nearest inventory pin, `tests/harnessGates.test.ts`'s
discipline-set case, reads the package's gates, not this module.
