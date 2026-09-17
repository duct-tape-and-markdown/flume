# The refusal rides under a declared handoff too

`defaultRefusesEntry` (`harness/handoff.ts`) is wired as `Chain.refusesEntry`
unconditionally in the factory, because the declaration carries no per-entry
knob. So a consumer that declares its own `handoff` for build still gets the
package's refusal beneath it: the ladder is replaceable per phase, the
predicate under it is not.

`spec/harness.md`, *The default `handoff`*, states both under one heading and
says a consumer "overrides the handoff by declaration, not by copying it" —
which reads as covering the refusal too. Two forks:

1. Intended — the refusal is the package's floor, and the section says so.
2. A gap — the declaration grows a per-entry override beside `handoff`.

Shipped as (1): the declaration schema is a surface I would not widen from a
build tick. Nothing observable is wrong either way today — no consumer in
this tree declares a handoff — so the section can settle it without code.
