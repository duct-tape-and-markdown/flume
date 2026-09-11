# TickContext's doc prose still names three of its fields

Adjacent gap, verified on disk this tick. `docs/CHAIN-AUTHORING.md:234`
teaches `TickContext` as carrying "`cwd`, `assignedEntry`, and `pending`".
`src/Phase.ts` declares `pickable` (:107) and `priorAttempts` (:119) too —
the two fields whose own doc comments say they exist so a hook stops
re-deriving pickability with a copy of the gate switch, and stops scanning
`prior-attempts/` itself. Both are unlearnable from the page, the same
defect this entry fixed one section down (`engineering.md`, *A fact the
engine holds is reported*): a reported fact nobody knows is reported gets
rebuilt.

Out of this entry's fence (the §2 prose, not the `<prior-attempt>` section),
so untouched. Fixable the same way — a bullet each in §2, held by the
`interfaceFields`-vs-doc pin family in `tests/retired-narration.test.ts`,
which already parses `TickContext` for the `cwd` prose pin.
