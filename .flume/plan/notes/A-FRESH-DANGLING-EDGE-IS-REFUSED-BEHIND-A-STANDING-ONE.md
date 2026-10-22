# The pair key is pinned, and the mutation named only the new case

Shipped the standing-edge case the entry asked for: base carries
`STANDING-WAITER -> LONG-SHIPPED` dangling, the span adds
`FRESH-WAITER -> LONG-SHIPPED`, and the gate refuses naming one line,
`FRESH-WAITER` alone.

Measured the widening the entry predicted. With `edgeKey` narrowed to
`edge.blocker`, `tests/harnessGates.test.ts` reports **1 failed, 67 passed** —
the one failure is the case this commit wrote. So every other standing-edge
case was green under both readings, exactly as the entry's notes said, and the
pair key had no check before this commit.

Observation for the next derive: the gate's `edgeKey` doc comment states the
pair-is-the-unit reasoning in prose ("a set keyed on the blocker alone could
not tell a new edge from one standing beside it"). That prose now has its pin,
so by `engineering.md`, *Narration is the ladder's bottom rung* it is a
candidate to shrink to a pointer at the pinning title. I left it standing —
the comment is also the only place the *why* of the `\u0000` separator lives,
and shrinking engine prose is a call for a derive entry, not a test-only tick.
