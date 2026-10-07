# `name` is the one gate key the type still cannot hold

The spread plus an unasserted `return` now holds four of the five keys:
dropping `batches` from the destructure reds `src/builtinGates.ts` at the
`return` with TS2741 (measured), and so would any key `shellGate`'s return
gains while a hand-copy went short.

`name` is structurally unholdable there. The callable is a function, so its
own `Function.name` already satisfies `GateIdentity.name: string`: deleting
the `Object.defineProperty` call typechecks clean and ships three builtins
named `fn`. What holds it is runtime pins only — `tests/builtinGates.test.ts`
at the bare/called pair (`gate.name`, `called.name`, all three builtins) and
the barrel-export case. No entry needed unless a future key lands in the
same class (a key the callable's own function surface shadows); the pins are
the right rung for it, and they exist.

No test change shipped. Plan's `files.edit` predicted new bare-and-called key
pins in `tests/builtinGates.test.ts`; the entry's own notes ruled the opposite
("no `tests[]`/`pins[]` line, the check this fix installs is the type") and the
existing pins already cover the five keys on both forms, so the prediction was
the stale half. Nothing in the suite moved.
